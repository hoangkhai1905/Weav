import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// RS256 access-token signing key for identity-service (ID-6). Private key only lives here; verifiers read the JWKS endpoint.
// Idempotent: keeps an existing key unless --force. Prints paths and kid only, never key material.
const dir = 'tmp/service-keys/identity';
const priv = `${dir}/identity-access.pem`;
const pub = `${dir}/identity-access.pub.pem`;
const kid = process.env.JWT_SIGNING_KEY_ID || 'identity-dev-1';

if (existsSync(priv) && !process.argv.includes('--force')) {
  console.log(`kept existing ${priv} (use --force to regenerate); kid=${kid}`);
} else {
  mkdirSync(dir, { recursive: true });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(`wrote ${priv} and ${pub}; kid=${kid}`);
}
