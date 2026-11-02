#!/usr/bin/env bash
# Pull-based deploy for the demo host, run every 2 minutes by infrastructure/deploy/weav-deploy.timer.
# CI pushes ghcr.io/<owner>/weav-<service>:main only after every check passed on main. This script pulls those
# images, moves the checkout to the commit they were built from (compose file and images stay in step), then
# recreates only the containers whose image or config changed. Idle runs change nothing.
set -euo pipefail

: "${WEAV_SECRETS_DIR:?set WEAV_SECRETS_DIR}"
REPO_DIR="${WEAV_REPO_DIR:-$HOME/Weav}"
cd "$REPO_DIR"

exec 9>/tmp/weav-deploy.lock
flock -n 9 || exit 0

dc() { docker compose -f compose.prod.yml --env-file "$WEAV_SECRETS_DIR/prod.env" "$@"; }

dc pull --quiet

# Every built image must come from the same commit; a half-finished CI publish is picked up on a later run.
revisions=$(dc config --images | grep '/weav-' | xargs -r docker image inspect \
  --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' | sort -u)
if [ "$(printf '%s\n' "$revisions" | grep -c .)" -ne 1 ]; then
  echo "deploy: images not from one commit yet ($(echo "$revisions" | tr '\n' ' ')), waiting"
  exit 0
fi
revision="$revisions"

if [ "$(git rev-parse HEAD)" != "$revision" ]; then
  git fetch --quiet --depth 1 origin "$revision"
  git checkout --quiet --detach "$revision"
  echo "deploy: checked out $revision"
fi

if ! dc up -d --no-build --remove-orphans --wait --wait-timeout 300 >/tmp/weav-deploy-up.log 2>&1; then
  echo "deploy: up failed for $revision"; tail -20 /tmp/weav-deploy-up.log; exit 1
fi
if grep -qE 'Recreate|Started|Created' /tmp/weav-deploy-up.log; then
  echo "deploy: running $revision"
  docker image prune -f >/dev/null
fi
