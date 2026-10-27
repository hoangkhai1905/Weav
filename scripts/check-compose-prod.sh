#!/usr/bin/env bash
# Static check of compose.prod.yml: `bash scripts/check-compose-prod.sh` (needs docker compose and node).
# Renders the file with .env.prod.example (placeholders only, never the real env) and asserts the deployment rules.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_PROD=${COMPOSE_PROD:-compose.prod.yml} # override only to test a mutated copy
export COMPOSE_PROD

json=$(mktemp) empty=$(mktemp)
trap 'rm -f "$json" "$empty"' EXIT

docker compose --project-directory . -f "$COMPOSE_PROD" --env-file .env.prod.example config --format json >"$json"

node - "$json" <<'EOF'
const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const svc = cfg.services;
const errors = [];
const check = (ok, msg) => { if (!ok) errors.push(msg); };

check(cfg.name === 'weav-prod', `project name is ${cfg.name}, expected weav-prod`);

const expected = ['rabbitmq', 'identity-service', 'workspace-service', 'workflow-service', 'ai-service',
  'api-gateway', 'notification-service', 'web', 'admin', 'cloudflared'].sort();
check(JSON.stringify(Object.keys(svc).sort()) === JSON.stringify(expected), `service set is ${Object.keys(svc).sort()}`);

const hasDockerfileHealthcheck = (s) => {
  if (!s.build) return false;
  const file = path.resolve(s.build.context, s.build.dockerfile || 'Dockerfile');
  return fs.existsSync(file) && /^HEALTHCHECK\s/m.test(fs.readFileSync(file, 'utf8'));
};

for (const [name, s] of Object.entries(svc)) {
  check(!/ocr/i.test(name), `${name}: OCR service must not exist`);
  check(!s.ports || s.ports.length === 0, `${name}: must not publish ports`);
  check(s.restart === 'unless-stopped', `${name}: restart is ${s.restart}`);
  check(Number(s.mem_limit) > 0, `${name}: missing mem_limit`);
  for (const [dep, c] of Object.entries(s.depends_on || {})) {
    if (c.condition !== 'service_healthy') continue;
    const t = svc[dep];
    check(t && (t.healthcheck || hasDockerfileHealthcheck(t)), `${name}: depends on ${dep} healthy but ${dep} has no healthcheck`);
  }
}

const MB = 1024 * 1024;
const limits = { 'identity-service': 768, 'workspace-service': 768, 'workflow-service': 1024, 'ai-service': 384,
  'api-gateway': 384, 'notification-service': 384, rabbitmq: 512, web: 64, admin: 64, cloudflared: 128 };
for (const [n, mb] of Object.entries(limits)) check(Number(svc[n]?.mem_limit) === mb * MB, `${n}: mem_limit is not ${mb}m`);

for (const n of ['web', 'admin']) check(svc[n]?.healthcheck?.test?.join(' ').includes('wget -qO- http://127.0.0.1:8080/'), `${n}: wget healthcheck missing`);

const env = (n) => svc[n]?.environment || {};
const eq = (n, k, v) => check(String(env(n)[k]) === String(v), `${n}: ${k} is ${env(n)[k]}, expected ${v}`);

// Only the gateway reads APP_ENV (it refuses to start in production without CORS and proxy hops).
eq('api-gateway', 'APP_ENV', 'production');
check(!!env('api-gateway').GATEWAY_THROTTLER_REDIS_URL, 'api-gateway: GATEWAY_THROTTLER_REDIS_URL is not set');

eq('workflow-service', 'WORKFLOW_EXECUTION_WORKER_ENABLED', 'true');
eq('workflow-service', 'WORKFLOW_EXECUTION_WORKER_OWNER', 'workflow-demo-worker');
eq('workflow-service', 'WORKFLOW_AI_ENABLED', 'true');
eq('workflow-service', 'WORKFLOW_AI_GENERATION_ENABLED', 'true');
eq('workflow-service', 'WORKFLOW_AI_DAILY_LIMIT_PER_WORKSPACE', '50');
eq('workflow-service', 'WORKFLOW_OCR_ENABLED', 'false');
eq('workflow-service', 'WORKFLOW_PUBLIC_BASE_URL', 'https://api.weav.id.vn');
eq('workflow-service', 'WORKFLOW_WEB_BASE_URL', 'https://app.weav.id.vn');
eq('ai-service', 'AI_ASSISTANT_ENABLED', 'true');

eq('identity-service', 'JWT_ACCESS_ALG', 'RS256');
eq('identity-service', 'JWT_SIGNING_KEY_ID', 'identity-demo-1');
eq('identity-service', 'IDENTITY_TRUSTED_PROXY_PATTERN', '172[.]31[.]250[.](10|11)');
eq('identity-service', 'GOOGLE_REDIRECT_URI', 'https://api.weav.id.vn/auth/oauth/google/callback');
eq('identity-service', 'OAUTH_WEB_RETURN_TARGET_URI', 'https://app.weav.id.vn/auth/callback');
eq('identity-service', 'OAUTH_WEB_ALLOWED_ORIGIN', 'https://app.weav.id.vn');
eq('workspace-service', 'GOOGLE_OAUTH_REDIRECT_URI', 'https://api.weav.id.vn/oauth/google/callback');
eq('workspace-service', 'GOOGLE_OAUTH_FRONTEND_RETURN_URL', 'https://app.weav.id.vn/connections');
eq('notification-service', 'NOTIFICATION_DETAIL_BASE_URL', 'https://app.weav.id.vn');
eq('notification-service', 'NOTIFICATION_EMAIL_ENABLED', 'true');
eq('notification-service', 'NOTIFICATION_LEGACY_DRAIN', 'false');

eq('api-gateway', 'GATEWAY_TRUST_PROXY_HOPS', '1');
eq('api-gateway', 'CORS_ALLOWED_ORIGINS', 'https://app.weav.id.vn,https://admin.weav.id.vn');
eq('api-gateway', 'IDENTITY_SERVICE_URL', 'http://identity-edge:8080');
check(svc['api-gateway']?.networks?.edge?.ipv4_address === '172.31.250.10', 'api-gateway: edge ipv4_address is not 172.31.250.10');
check(svc.cloudflared?.networks?.edge?.ipv4_address === '172.31.250.11', 'cloudflared: edge ipv4_address is not 172.31.250.11');
check((svc['identity-service']?.networks?.edge?.aliases || []).includes('identity-edge'), 'identity-service: missing identity-edge alias');

const buildArgs = (n) => svc[n]?.build?.args || {};
check(buildArgs('web').VITE_API_BASE_URL === 'https://api.weav.id.vn', 'web: VITE_API_BASE_URL');
check(buildArgs('web').VITE_IDENTITY_SERVICE_URL === 'https://api.weav.id.vn', 'web: VITE_IDENTITY_SERVICE_URL');
check(buildArgs('web').VITE_API_MODE === 'http', 'web: VITE_API_MODE');
check(buildArgs('admin').VITE_API_GATEWAY_URL === 'https://api.weav.id.vn', 'admin: VITE_API_GATEWAY_URL');

const cmd = (svc.cloudflared?.command || []).join(' ');
check(cmd === 'tunnel --no-autoupdate --config /etc/cloudflared/config.yml run weav-demo', `cloudflared: command is "${cmd}"`);
check(/^cloudflare\/cloudflared:\d{4}\.\d+\.\d+$/.test(svc.cloudflared?.image || ''), 'cloudflared: image is not pinned to an exact release');

// Secrets never get an inline default: a missing one must stop `up`, not fall back to a weak value.
const raw = fs.readFileSync(process.env.COMPOSE_PROD, 'utf8');
const notSecret = new Set(['WEAV_SECRETS_DIR']); // a directory path, not a secret value
for (const m of raw.matchAll(/\$\{([A-Z0-9_]+):-/g)) {
  if (/SECRET|PASSWORD|KEY|TOKEN/.test(m[1]) && !notSecret.has(m[1])) errors.push(`compose.prod.yml: secret ${m[1]} has an inline default`);
}
check(!/:-guest\b/.test(raw), 'compose.prod.yml: a ":-guest" default');

// Only workflow-service may mount the private service-key folder.
for (const [name, s] of Object.entries(svc)) {
  for (const v of s.volumes || []) {
    if (String(v.source).replace(/\\/g, '/').includes('service-keys/private') && name !== 'workflow-service') errors.push(`${name}: mounts service-keys/private`);
  }
}

// No default broker credentials anywhere.
for (const [name, s] of Object.entries(svc)) {
  for (const [k, v] of Object.entries(s.environment || {})) if (v === 'guest') errors.push(`${name}: ${k} is "guest"`);
}

if (errors.length) { console.error('FAIL compose.prod.yml\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('PASS compose.prod.yml structure');
EOF

# An empty env file must stop `config` and name a missing variable.
if out=$(docker compose --project-directory . -f "$COMPOSE_PROD" --env-file "$empty" config 2>&1); then
  echo "FAIL: config succeeded with an empty env file"; exit 1
fi
grep -q 'set [A-Z_]* in prod.env' <<<"$out" || { echo "FAIL: empty env error does not name a variable: $out"; exit 1; }
echo "PASS empty env file is rejected: $(grep -o 'set [A-Z_]* in prod.env' <<<"$out" | head -1)"
