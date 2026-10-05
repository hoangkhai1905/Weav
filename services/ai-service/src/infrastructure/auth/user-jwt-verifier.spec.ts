import { randomUUID } from 'node:crypto';
import { signJwt, testKeys } from '../../../test/support/jwt';
import { UserJwtVerifier } from './user-jwt-verifier';
import { ServiceJwtVerifier } from './service-jwt-verifier';

const keys = testKeys();
const other = testKeys();
const nowS = Math.floor(Date.now() / 1000);
const config = {
  jwksUri: 'http://identity/.well-known/jwks.json',
  issuer: 'weav-identity',
  audience: 'weav-api',
  clockSkewSeconds: 30,
};
const userId = randomUUID();
const claims = (extra: Record<string, unknown> = {}) => ({
  sub: userId,
  sid: randomUUID(),
  jti: randomUUID(),
  iss: 'weav-identity',
  aud: 'weav-api',
  iat: nowS,
  nbf: nowS,
  exp: nowS + 900,
  token_use: 'access',
  system_role: 'USER',
  user_status: 'ACTIVE',
  ...extra,
});
const bearer = (
  c: Record<string, unknown>,
  header?: Record<string, unknown>,
  key = keys.privateKey,
) => `Bearer ${signJwt(key, c, header)}`;

function verifier(jwks = keys.jwks, status = 200) {
  let fetches = 0;
  const fetchImpl = (async () => {
    fetches++;
    return new Response(jwks, { status });
  }) as unknown as typeof fetch;
  return { v: new UserJwtVerifier(config, fetchImpl), fetches: () => fetches };
}

describe('UserJwtVerifier', () => {
  it('accepts a valid identity access token and caches the JWKS', async () => {
    const { v, fetches } = verifier();
    await expect(v.verify(bearer(claims()))).resolves.toEqual({ userId });
    await v.verify(bearer(claims()));
    expect(fetches()).toBe(1);
  });

  it.each([
    ['wrong issuer', claims({ iss: 'evil' })],
    ['wrong audience', claims({ aud: 'weav-ai' })],
    [
      'expired',
      claims({ iat: nowS - 3600, nbf: nowS - 3600, exp: nowS - 1800 }),
    ],
    [
      'not yet valid',
      claims({ nbf: nowS + 600, iat: nowS + 600, exp: nowS + 900 }),
    ],
    ['refresh token', claims({ token_use: 'refresh' })],
    ['inactive user', claims({ user_status: 'BLOCKED' })],
    ['unknown role', claims({ system_role: 'ROOT' })],
    ['sub not a uuid', claims({ sub: 'admin' })],
    ['missing sid', claims({ sid: undefined })],
  ])('rejects %s', async (_name, c) => {
    await expect(verifier().v.verify(bearer(c))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects wrong algorithm, unknown kid, foreign signature and malformed headers', async () => {
    const { v } = verifier();
    for (const auth of [
      bearer(claims(), { alg: 'none', kid: 'test-kid' }),
      bearer(claims(), { alg: 'HS256', kid: 'test-kid' }),
      bearer(claims(), { alg: 'RS256', kid: 'unknown' }),
      bearer(claims(), { alg: 'RS256' }),
      bearer(claims(), undefined, other.privateKey),
      'Bearer not.a.jwt',
      'Basic abc',
      undefined,
    ])
      await expect(v.verify(auth)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
  });

  it('fails closed when the JWKS is unreachable and does not refetch within the cooldown', async () => {
    const { v, fetches } = verifier('', 503);
    await expect(v.verify(bearer(claims()))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(v.verify(bearer(claims()))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(fetches()).toBe(1);
  });

  it('ignores a JWKS whose content-length exceeds 64 KiB and reports check() false', async () => {
    const fetchImpl = (() =>
      Promise.resolve(
        new Response(keys.jwks, { headers: { 'content-length': '70000' } }),
      )) as unknown as typeof fetch;
    const v = new UserJwtVerifier(config, fetchImpl);
    await expect(v.check()).resolves.toBe(false);
    await expect(v.verify(bearer(claims()))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('check() is true for a reachable JWKS with an RSA key', async () => {
    await expect(verifier().v.check()).resolves.toBe(true);
    await expect(verifier('{}').v.check()).resolves.toBe(false);
  });

  it('rejects a workflow-service service JWT, and the service verifier rejects a user token', async () => {
    const service = bearer({
      iss: 'weav-workflow',
      aud: 'weav-ai',
      scope: 'ai:summarize',
      workspace_id: randomUUID(),
      request_id: randomUUID(),
      mode: 'execution',
      iat: nowS,
      exp: nowS + 60,
    });
    await expect(verifier().v.verify(service)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(() =>
      ServiceJwtVerifier.fromJwks(keys.jwks).verify(bearer(claims())),
    ).toThrow();
  });
});
