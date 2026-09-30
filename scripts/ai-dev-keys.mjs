import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// Separate folders so Compose mounts only the public JWKS into ai-service and only the private key into workflow-service.
const dir = 'tmp/service-keys';
mkdirSync(`${dir}/private`, { recursive: true });
mkdirSync(`${dir}/public`, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(`${dir}/private/workflow-service.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
writeFileSync(`${dir}/public/workflow-service.jwks.json`,
  JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'workflow-dev-1', alg: 'RS256', use: 'sig' }] }));
console.log(`wrote ${dir}/private/workflow-service.pem and ${dir}/public/workflow-service.jwks.json`);
