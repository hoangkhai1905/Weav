import { generateKeyPairSync, sign, KeyObject } from 'node:crypto';

export function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const jwks = JSON.stringify({
    keys: [
      {
        ...publicKey.export({ format: 'jwk' }),
        kid: 'test-kid',
        alg: 'RS256',
        use: 'sig',
      },
    ],
  });
  return { privateKey, jwks };
}

export function signJwt(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {
    alg: 'RS256',
    kid: 'test-kid',
    typ: 'JWT',
  },
): string {
  const b64 = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${b64(header)}.${b64(claims)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}
