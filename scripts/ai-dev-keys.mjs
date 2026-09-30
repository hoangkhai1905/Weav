import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const dir = 'tmp/service-keys';
mkdirSync(dir, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
writeFileSync(`${dir}/workflow-service.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
writeFileSync(`${dir}/workflow-service.jwks.json`,
  JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'workflow-dev-1', alg: 'RS256', use: 'sig' }] }));
console.log(`wrote ${dir}/workflow-service.pem and ${dir}/workflow-service.jwks.json`);
