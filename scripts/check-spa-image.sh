#!/usr/bin/env bash
# Runnable check for the web/admin static images.
# Usage: scripts/check-spa-image.sh <image> [expected-api-url-baked-into-bundle]
set -u
image=${1:?usage: check-spa-image.sh <image> [expected-api-url]}
expect=${2:-}
fail=0
check() { if "$@"; then echo "PASS: $desc"; else echo "FAIL: $desc"; fail=1; fi; }

cid=$(docker run -d --rm -p 127.0.0.1::8080 "$image") || { echo "FAIL: cannot start $image"; exit 1; }
trap 'docker rm -f "$cid" >/dev/null 2>&1' EXIT
port=$(docker port "$cid" 8080/tcp | head -1 | sed 's/.*://')
base=http://127.0.0.1:$port
for _ in $(seq 30); do curl -fs -o /dev/null "$base/" && break; sleep 0.5; done

code() { curl -s -o /dev/null -w '%{http_code}' "$base$1"; }

desc="GET / is 200 text/html no-cache"
check bash -c "h=\$(curl -s -D - -o /dev/null $base/ | tr -d '\r'); grep -qi '^HTTP.* 200' <<<\"\$h\" && grep -qi '^content-type: text/html' <<<\"\$h\" && grep -qi '^cache-control:.*no-cache' <<<\"\$h\""

desc="deep link /workflows/abc serves the same body as /"
check [ "$(curl -s "$base/workflows/abc" | md5sum)" = "$(curl -s "$base/" | md5sum)" ]

desc="missing /assets/does-not-exist.js is 404"
check [ "$(code /assets/does-not-exist.js)" = 404 ]

asset=$(curl -s "$base/" | grep -o 'src="/assets/[^"]*"' | head -1 | sed 's/src="//;s/"$//')
desc="real asset ${asset:-<none found>} is 200 immutable"
check bash -c "[ -n '$asset' ] && h=\$(curl -s -D - -o /dev/null '$base$asset' | tr -d '\r') && grep -qi '^HTTP.* 200' <<<\"\$h\" && grep -qi '^cache-control:.*immutable' <<<\"\$h\""

if [ -n "$expect" ]; then
  desc="bundle contains $expect"
  check docker run --rm --entrypoint sh "$image" -c "grep -rqF '$expect' /usr/share/nginx/html/assets"
fi

exit $fail
