import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

// Separate folders so Compose mounts only the public JWKS into ai-service/ocr-service and only a service's own private key into that service.
// Existing key files are never overwritten, so keys already in use stay valid on re-run.
const dir = 'tmp/service-keys';

function writePair(privatePath, publicPath, kid) {
  if (existsSync(privatePath) && existsSync(publicPath)) {
    console.log(`skipped ${privatePath} and ${publicPath} (already exist)`);
    return;
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  writeFileSync(publicPath,
    JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' }] }));
  console.log(`wrote ${privatePath} and ${publicPath}`);
}

mkdirSync(`${dir}/private`, { recursive: true });
mkdirSync(`${dir}/gateway`, { recursive: true });
mkdirSync(`${dir}/public`, { recursive: true });
writePair(`${dir}/private/workflow-service.pem`, `${dir}/public/workflow-service.jwks.json`, 'workflow-dev-1');
writePair(`${dir}/gateway/api-gateway.pem`, `${dir}/public/api-gateway.jwks.json`, 'gateway-dev-1');
