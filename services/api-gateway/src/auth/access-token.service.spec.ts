import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type JWK,
  type CryptoKey,
} from 'jose';
import { AccessTokenService } from './access-token.service';

describe('AccessTokenService real signatures', () => {
  const secret = randomBytes(48).toString('hex');
  const now = 1_800_000_000;
  const principal = {
    sub: randomUUID(),
    sid: randomUUID(),
    jti: randomUUID(),
    system_role: 'USER',
    user_status: 'ACTIVE',
  };
  const claims = () => ({
    ...principal,
    iss: 'issuer',
    aud: ['audience'],
    token_use: 'access',
    iat: now - 60,
    nbf: now - 60,
    exp: now + 60,
  });
  const sign = (
    payload: Record<string, unknown>,
    algorithm = 'HS256',
    key = secret,
  ) => {
    const input = [{ alg: algorithm, typ: 'JWT' }, payload]
      .map((value) => Buffer.from(JSON.stringify(value)).toString('base64url'))
      .join('.');
    return `${input}.${createHmac(
      algorithm === 'HS384' ? 'sha384' : 'sha256',
      key,
    )
      .update(input)
      .digest('base64url')}`;
  };
  let service: AccessTokenService;
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(now * 1000);
    service = new AccessTokenService(
      new ConfigService({
        gateway: {
          jwt: {
            accessSecret: secret,
            issuer: 'issuer',
            audience: 'audience',
            clockSkewSeconds: 30,
          },
        },
      }),
    );
  });
  afterEach(() => jest.restoreAllMocks());
  it('returns only verified principal claims', async () => {
    await expect(service.verify(sign(claims()))).resolves.toEqual(principal);
  });
  it.each([
    'sub',
    'sid',
    'jti',
    'iat',
    'nbf',
    'exp',
    'system_role',
    'user_status',
    'token_use',
    'iss',
    'aud',
  ])('rejects missing %s', async (claim) => {
    const payload: Record<string, unknown> = claims();
    delete payload[claim];
    await expect(service.verify(sign(payload))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it.each([
    ['sub', 'invalid'],
    ['sid', 123],
    ['jti', '1-1-1-1-1'],
    ['iat', '1800000000'],
    ['nbf', null],
    ['exp', '1800000060'],
    ['iat', now + 31],
    ['nbf', now + 31],
    ['exp', now - 30],
    ['system_role', 'OWNER'],
    ['user_status', 'DISABLED'],
    ['user_status', 'UNKNOWN'],
    ['token_use', 'refresh'],
    ['iss', 'wrong'],
    ['aud', ['wrong']],
  ])('rejects invalid %s=%s', async (claim, value) => {
    await expect(
      service.verify(sign({ ...claims(), [claim]: value })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it.each(['iat', 'nbf'])(
    'requires exp strictly greater than %s',
    async (claim) => {
      for (const value of [now + 20, now + 21]) {
        await expect(
          service.verify(sign({ ...claims(), exp: now + 20, [claim]: value })),
        ).rejects.toBeInstanceOf(UnauthorizedException);
      }
    },
  );
  it.each(['iat', 'nbf'])(
    'accepts %s at the future skew boundary',
    async (claim) => {
      await expect(
        service.verify(sign({ ...claims(), [claim]: now + 30 })),
      ).resolves.toEqual(principal);
    },
  );
  it('accepts expiry just inside skew', async () => {
    await expect(
      service.verify(sign({ ...claims(), exp: now - 29 })),
    ).resolves.toEqual(principal);
  });
  it.each(['HS384', 'none', 'RS256'])(
    'rejects algorithm %s',
    async (algorithm) => {
      await expect(
        service.verify(sign(claims(), algorithm)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );
  it('rejects another key and opaque refresh credentials', async () => {
    await expect(
      service.verify(sign(claims(), 'HS256', randomBytes(48).toString('hex'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.verify(randomBytes(32).toString('base64url')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AccessTokenService RS256 via JWKS', () => {
  const secret = randomBytes(48).toString('hex');
  const kid = 'test-key';
  let server: Server;
  let jwksUri: string;
  let privateKey: CryptoKey;
  let publicJwk: JWK;
  let service: AccessTokenService;
  const build = (uri: string) =>
    new AccessTokenService(
      new ConfigService({
        gateway: {
          jwt: {
            accessSecret: secret,
            issuer: 'issuer',
            audience: 'audience',
            clockSkewSeconds: 30,
            jwksUri: uri,
          },
        },
      }),
    );
  const claims = (status = 'ACTIVE') => ({
    sid: randomUUID(),
    jti: randomUUID(),
    system_role: 'USER',
    user_status: status,
    token_use: 'access',
  });
  const sub = randomUUID();
  const rs256 = (payload: object, header: object = { alg: 'RS256', kid }) =>
    new SignJWT({ ...payload })
      .setProtectedHeader(header as { alg: string })
      .setSubject(sub)
      .setIssuer('issuer')
      .setAudience('audience')
      .setIssuedAt()
      .setNotBefore('0s')
      .setExpirationTime('5m')
      .sign(privateKey);

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = { ...(await exportJWK(pair.publicKey)), kid, alg: 'RS256' };
    server = createServer((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    jwksUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`;
  });
  afterAll(() => new Promise((resolve) => server.close(resolve)));
  beforeEach(() => {
    service = build(jwksUri);
  });

  it('accepts RS256 with a known kid and keeps the claim checks', async () => {
    await expect(service.verify(await rs256(claims()))).resolves.toMatchObject({
      sub,
      user_status: 'ACTIVE',
    });
    await expect(
      service.verify(await rs256(claims('DISABLED'))),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects an unknown kid', async () => {
    await expect(
      service.verify(await rs256(claims(), { alg: 'RS256', kid: 'other' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects HS256 signed with the RSA public key as the HMAC secret', async () => {
    const forged = await new SignJWT({ ...claims() })
      .setProtectedHeader({ alg: 'HS256', kid })
      .setSubject(sub)
      .setIssuer('issuer')
      .setAudience('audience')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(JSON.stringify(publicJwk)));
    await expect(service.verify(forged)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('rejects alg none', async () => {
    const part = (v: object) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    const token = `${part({ alg: 'none' })}.${part({ ...claims(), sub, iss: 'issuer', aud: 'audience', exp: Date.now() / 1000 + 60 })}.`;
    await expect(service.verify(token)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
  it('returns 401 when the JWKS is unreachable and HS256 still works', async () => {
    const down = build('http://127.0.0.1:1/jwks');
    await expect(down.verify(await rs256(claims()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const hs = await new SignJWT({ ...claims() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer('issuer')
      .setAudience('audience')
      .setIssuedAt()
      .setNotBefore('0s')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
    await expect(down.verify(hs)).resolves.toMatchObject({ sub });
  });
});
