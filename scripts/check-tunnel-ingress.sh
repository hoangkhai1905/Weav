#!/usr/bin/env bash
# Offline check of infrastructure/cloudflared/config.yml: `bash scripts/check-tunnel-ingress.sh` (needs docker).
# Validates the ingress file and asserts which service each URL is routed to.
set -euo pipefail
cd "$(dirname "$0")/.."

# One pin: the tag compose.prod.yml runs.
IMAGE=$(grep -o 'cloudflare/cloudflared:[^[:space:]]*' compose.prod.yml | head -1)
[ -n "$IMAGE" ] || { echo "FAIL: no cloudflared image in compose.prod.yml"; exit 1; }
# pwd -W gives Docker Desktop a Windows path under Git Bash; plain pwd elsewhere.
root=$(pwd -W 2>/dev/null || pwd)
# MSYS_NO_PATHCONV stops Git Bash from rewriting the container path; harmless on Linux.
cf() { MSYS_NO_PATHCONV=1 docker run --rm -v "$root/infrastructure/cloudflared:/etc/cloudflared:ro" "$IMAGE" tunnel --config /etc/cloudflared/config.yml "$@"; }

cf ingress validate >/dev/null || { echo "FAIL: ingress validate"; exit 1; }

fail=0
expect() { # url, expected service
  local out got
  out=$(cf ingress rule "$1" 2>&1) || true
  got=$(sed -n 's/^[[:space:]]*service: *//p' <<<"$out" | tr -d '\r')
  if [ "$got" = "$2" ]; then echo "PASS $1 -> $2"; else echo "FAIL $1 -> expected $2, got: ${got:-$out}"; fail=1; fi
}

expect 'https://api.weav.id.vn/auth/web/csrf' 'http://identity-edge:8080'
expect 'https://api.weav.id.vn/auth/oauth/google/mobile/start' 'http://identity-edge:8080'
expect 'https://api.weav.id.vn/auth/oauth/google/callback' 'http://identity-edge:8080'
expect 'https://api.weav.id.vn/auth/oauth/google/callback?code=a%2Fb&state=c' 'http://identity-edge:8080'
expect 'https://api.weav.id.vn/oauth/google/callback' 'http://workspace-service:8080'
expect 'https://api.weav.id.vn/oauth/google/callback?code=a%2Fb&state=c' 'http://workspace-service:8080'
expect 'https://api.weav.id.vn/actuator/health' 'http://api-gateway:3000'
expect 'https://api.weav.id.vn/auth/web/../../actuator/prometheus' 'http://api-gateway:3000'
expect 'https://api.weav.id.vn/auth/me' 'http://api-gateway:3000'
expect 'https://api.weav.id.vn/oauth/google/callback/x' 'http://api-gateway:3000'
expect 'https://api.weav.id.vn/api/v1/webhooks/telegram/k' 'http://api-gateway:3000'
expect 'https://app.weav.id.vn/workflows/abc' 'http://web:8080'
expect 'https://admin.weav.id.vn/users' 'http://admin:8080'
expect 'https://evil.weav.id.vn/' 'http_status:404'

exit $fail
