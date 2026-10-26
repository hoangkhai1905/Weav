# Demo runbook (compose.prod.yml + Cloudflare Tunnel)

Run every command from the repo root (Linux host or Git Bash). Plan: `docs/superpowers/plans/2026-10-26-demo-deployment.md`. Nothing here is automated: each step that touches Neon, Cloudflare or Google is yours to approve and run.

Public URLs: `https://app.weav.id.vn`, `https://admin.weav.id.vn`, `https://api.weav.id.vn`.

```bash
export WEAV_SECRETS_DIR="$HOME/weav-secrets"   # Linux/VPS: normal absolute path outside git
export WEAV_SECRETS_DIR="C:/Users/<name>/weav-secrets"   # Windows (Git Bash/Docker Desktop) instead: forward-slash drive form
```

Use the same string in `prod.env` (`WEAV_SECRETS_DIR=`). A new shell loses the export and the `dc()` function from section 7: define both again.

## 1. Prerequisites on the host

1. `docker version && docker compose version` -> Engine plus Compose **>= 2.17** (`additional_contexts` is used for workflow-service); `docker buildx version` -> BuildKit present.
2. Tools on the machine you run sections 2-6 from: `node --version` -> v24; `corepack enable && pnpm --version` -> 11.22.0 (key scripts, Prisma); `openssl version`; `psql --version`; `cloudflared --version`.
3. The `weav.id.vn` zone is already on Cloudflare (nameservers moved 2026-10-07): no zone step. Dashboard -> weav.id.vn -> Overview shows status **Active**.
4. `git --version`; `free -h` -> 4 GB RAM minimum (8 GB comfortable); `swapon --show` -> about 2 GB swap (Linux).
5. `systemctl is-enabled docker` -> `enabled` (Docker starts at boot). On Docker Desktop: enable "Start when you sign in".
6. `timedatectl | grep synchronized` -> `System clock synchronized: yes` (JWT and OTP expiry depend on the clock).
7. If a dev stack ever ran on this machine: `docker compose -f compose.yml -f compose.dev.yml down` (the dev `edge` network uses the same subnet 172.31.250.0/24). Also stop any quick tunnel.
8. Never start `ocr-service`; it is not part of this stack.

## 2. One-time Cloudflare

1. `cloudflared tunnel login` -> browser opens; pick the `weav.id.vn` zone. Expected: `You have successfully logged in.`
2. `cloudflared tunnel create weav-demo` -> `Created tunnel weav-demo with id <UUID>` and the credentials path (`~/.cloudflared/<UUID>.json`).
3. Copy the credentials and make them readable by the container (cloudflared runs as uid 65532):
   ```bash
   mkdir -p "$WEAV_SECRETS_DIR/cloudflared"
   cp ~/.cloudflared/<UUID>.json "$WEAV_SECRETS_DIR/cloudflared/creds.json"
   chmod 644 "$WEAV_SECRETS_DIR/cloudflared/creds.json"
   ```
   A 0600 file makes cloudflared fail with the misleading `Cannot determine default origin certificate path`.
4. DNS routes, one per hostname: `cloudflared tunnel route dns weav-demo api.weav.id.vn`, then `app.weav.id.vn`, then `admin.weav.id.vn`. Expected each: `Added CNAME ... which will route to this tunnel`.
5. Cloudflare dashboard -> Rules -> "Normalize incoming URLs" (under SSL/TLS -> Edge Certificates on some plans): **on**. No SSL mode change is needed: the tunnel origins are plain http inside the Docker network.
6. Offline check of the routing rules: `bash scripts/check-tunnel-ingress.sh` -> every row PASS.

## 3. One-time Neon (branch `demo`)

K approved a **schema-only** branch (decision D5). `production` and `dev-k` are archived on Neon: the first connection to them is slow (cold start).

1. Neon console -> project `Weav` -> Branches -> Create branch: name `demo`, parent `production`, data = **Schema-only**. **Uncheck** "Automatically delete branch after 1 day" (the console enables it by default). If the console does not offer schema-only: stop and ask K.
2. Console -> Roles on `demo`: check that the roles you will put in `prod.env` (section 4) exist. Whether roles/passwords are copied to a schema-only root branch is **unverified**. If a role is missing or its password is unknown, reset the password there and use the new one in `prod.env`.
3. From the console Connect dialog (branch `demo`) note the **pooled** host (contains `-pooler`) for the `*_DB_HOST` variables and the **direct** host for `NOTIFICATION_MIGRATION_URL` / `AI_MIGRATION_URL` (`NOTIFICATION_MIGRATION_URL` ends with `?schema=notification`, `AI_MIGRATION_URL` with `?schema=ai`; see section 4).
4. A schema-only copy has empty `flyway_schema_history` / `_prisma_migrations`, so Flyway and Prisma would re-run V1 against existing tables and fail. On the fresh `demo` branch drop the service schemas before first boot (and again to redo a failed first boot). Do this once per database with `psql` on the **direct** host, `sslmode=require`.
   1. **Endpoint check, mandatory:** take the `ep-...` part of the host in your connection string, open Neon console -> Branches -> `demo` -> Connect, and compare it with the `demo` endpoint host. They must be identical. Different `ep-...`: stop (it is `production` or `dev-k`). Then `SELECT current_database();` shows the expected database.
   2. Prove the tables are empty with real counts (expected `0`; anything else: stop). One table per schema, from the migrations:

      | Database [default name] | Count query |
      | --- | --- |
      | identity [`identity-db`] | `SELECT count(*) FROM identity.users;` |
      | workspace [`workspace_db`] | `SELECT count(*) FROM workspace.workspaces;` |
      | workflow [`workflow_db`] | `SELECT count(*) FROM workflow.workflows;` |
      | notification [`notification_db`] | `SELECT count(*) FROM notification.notification_inbox;` |
      | ai [`ai_db`] | `SELECT count(*) FROM ai.conversations;` |

   3. K confirms, then drop in one transaction (schema names are the `DB_SCHEMA` values in `compose.prod.yml`):
      ```sql
      BEGIN;
      DROP SCHEMA IF EXISTS <schema> CASCADE;   -- identity | workspace | workflow | notification | ai
      COMMIT;
      ```
      `_prisma_migrations` lives in the schema named by `?schema=` in the migration URL (`notification`, `ai`), so this DROP clears it too (a redo of the DROP resets Prisma as well). Flyway's `flyway_schema_history` lives in the service schema. If notification was ever migrated without `?schema=`, its table is in `public`: run `SELECT to_regclass('public._prisma_migrations');` and, if not NULL, add `DROP TABLE public._prisma_migrations;` to the transaction.
   4. Never run these on `production` or `dev-k`.
5. Before every later release: console -> Branches -> create a branch `demo-before-<date>` from `demo` (restore point, used by section 10).

## 4. One-time secrets

1. Create the directory and the env file:
   ```bash
   mkdir -p "$WEAV_SECRETS_DIR" && chmod 700 "$WEAV_SECRETS_DIR"
   cp .env.prod.example "$WEAV_SECRETS_DIR/prod.env" && chmod 600 "$WEAV_SECRETS_DIR/prod.env"
   ```
2. Edit `prod.env`: replace every `CHANGE_ME` (each line has a comment on how to generate it, e.g. `openssl rand -base64 48`). Set `WEAV_SECRETS_DIR=` inside it to the exact string you exported (Windows: `C:/Users/<name>/weav-secrets`). No `$` in values. Migration URLs, unquoted: `NOTIFICATION_MIGRATION_URL=<direct url>?schema=notification` and `AI_MIGRATION_URL=<direct url>?schema=ai` (if the URL already has `?sslmode=require`, append `&schema=...` instead).
3. `grep -n CHANGE_ME "$WEAV_SECRETS_DIR/prod.env"` -> prints **nothing**.
4. Generate keys. The `kid` must equal `JWT_SIGNING_KEY_ID: identity-demo-1` in `compose.prod.yml`:
   ```bash
   export WEAV_SERVICE_KEYS_DIR="$WEAV_SECRETS_DIR/service-keys"
   JWT_SIGNING_KEY_ID=identity-demo-1 node scripts/identity-dev-keys.mjs
   node scripts/ai-dev-keys.mjs
   ```
   Expected: `wrote .../identity/identity-access.pem and .../identity-access.pub.pem; kid=identity-demo-1`, then `wrote ...private/workflow-service.pem and ...public/workflow-service.jwks.json` and `wrote ...gateway/api-gateway.pem and ...public/api-gateway.jwks.json`.
5. Make the keys readable by the container users (Spring uid 10001, `node` uid 1000). The parent stays 700 (that is the only reason 644 on the private keys is acceptable: nobody else on the host can reach them); the key subfolders become 755 and the files 644:
   ```bash
   find "$WEAV_SERVICE_KEYS_DIR" -type d -exec chmod 755 {} +
   find "$WEAV_SERVICE_KEYS_DIR" -type f -exec chmod 644 {} +
   ```
   Wrong modes make identity and workflow crash at start with `Permission denied`.
6. Shell-exported variables override `--env-file` values in compose. Run section 7 from a fresh shell and check that no name from `prod.env` is already set (names only, never values; expected: no output, or only `WEAV_SECRETS_DIR`):
   ```bash
   for v in $(sed -n 's/^\([A-Z][A-Z0-9_]*\)=.*/\1/p' "$WEAV_SECRETS_DIR/prod.env"); do [ -n "${!v+x}" ] && echo "$v is set in the shell"; done
   ```
   Unset any it lists (`unset NAME`) or open a new shell.
7. Before the demo, rotate the Telegram bot token in @BotFather and use the new token in the Weav connection.

## 5. One-time Google Cloud Console

OAuth client (Web application) used for `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`:

1. Authorised redirect URIs, both:
   - `https://api.weav.id.vn/auth/oauth/google/callback` (sign-in, identity)
   - `https://api.weav.id.vn/oauth/google/callback` (Google connections, workspace)
2. Authorised JavaScript origin: `https://app.weav.id.vn`.
3. The consent screen is in Testing mode: add every demo account under Test users.
4. Refresh tokens of a Testing app expire after 7 days: reconnect every Google connection between 2026-11-16 and 2026-11-22.

## 6. Migrations (from the laptop, before first boot and after any release with new migrations)

Flyway (identity, workspace, workflow) runs itself at boot. Prisma (notification, ai) does not: the runtime images have no prisma CLI. The repo-root `.env` points at `dev-k`, so set the URLs inline from `prod.env` and check the host before applying.

1. `pnpm install --frozen-lockfile` (fresh checkout only).
2. Load the two URLs into this shell only, without shell-parsing the file (a Neon URL with `&` would break `source`); nothing is printed:
   ```bash
   export NOTIFICATION_MIGRATION_URL="$(sed -n 's/^NOTIFICATION_MIGRATION_URL=//p' "$WEAV_SECRETS_DIR/prod.env" | tr -d '"')"
   export AI_MIGRATION_URL="$(sed -n 's/^AI_MIGRATION_URL=//p' "$WEAV_SECRETS_DIR/prod.env" | tr -d '"')"
   [ -n "$NOTIFICATION_MIGRATION_URL" ] && [ -n "$AI_MIGRATION_URL" ] && echo loaded
   ```
   Expected: `loaded`. Compose does not read these two variables, so the same lines are fine for `--env-file`.
3. Status first (read-only):
   ```bash
   pnpm --dir services/notification-service exec prisma migrate status
   pnpm --dir services/ai-service exec prisma migrate status
   ```
   Expected: the datasource line names the **demo** endpoint (`ep-...`, compare it with the Neon console as in section 3) and schema `notification` / `ai`; never `dev-k` or `production`. On the fresh branch: `Following migration(s) have not yet been applied`. If the endpoint is not `demo`, stop.
4. Apply:
   ```bash
   pnpm --dir services/notification-service db:migrate
   pnpm --dir services/ai-service db:migrate
   ```
   Expected each: `All migrations have been successfully applied.`
5. `unset NOTIFICATION_MIGRATION_URL AI_MIGRATION_URL`

## 7. Deploy / update

Shorthand used below (define it, and export `WEAV_SECRETS_DIR`, again in every new shell): `dc() { docker compose -f compose.prod.yml --env-file "$WEAV_SECRETS_DIR/prod.env" "$@"; }`

1. `git checkout main && git pull` (rehearsal: the branch under test).
2. Build one service at a time (a small host runs out of memory otherwise; the three Spring images are slow):
   ```bash
   for s in identity-service workspace-service workflow-service ai-service api-gateway notification-service web admin; do
     dc build $s || break
   done
   ```
   `web` / `admin` fail on purpose if a `VITE_*` build arg is empty or the bundle contains `localhost:3000` / `localhost:8081`.
3. `dc up -d`
4. `dc ps` -> within about 3 minutes every service is `healthy` **except `cloudflared`**, which has no healthcheck and shows `Up`.
5. Tunnel: `dc logs cloudflared | grep -i "Registered tunnel connection"` -> at least one line (usually four).
6. Memory: `docker stats --no-stream` -> total under about 5 GB. A Spring service above about 90% of its limit: raise its `mem_limit` in `compose.prod.yml` (the Dockerfile ENTRYPOINT hard-codes `-XX:MaxRAMPercentage=75`), then `dc up -d`.
7. Permissions: `dc logs identity-service workflow-service | grep -i "permission denied\|AccessDenied"` -> nothing.
8. ai-service reports `healthy` even if its JWKS failed to load: test the assistant explicitly (section 8, item 7).
9. If `dc up` stops on `set X in prod.env`, add the variable (compare with `.env.prod.example`).

## 8. Smoke test

Browser with DevTools open. Record PASS/FAIL per item in `docs/work_logs/K/platform/demo-deployment.md` (run ids, no secrets).

1. Register a new account; the OTP e-mail arrives; verify.
2. Google sign-in works.
3. Dashboard loads; no request goes to `localhost` (Network filter `localhost` is empty).
4. Create a workflow from a template, run it, the run reaches SUCCESS.
5. Connect a Google connection (Connections page).
6. Telegram trigger: the webhook registers; `getWebhookInfo` shows a URL under `https://api.weav.id.vn/`.
7. Assistant: ask a question that triggers a tool call; the stream completes (proves ai-service loaded the JWKS). A stream cut near 100 s: open a follow-up for an SSE heartbeat.
8. Invite an e-mail address; the link opens `https://app.weav.id.vn/invitations`.
9. Admin: `https://admin.weav.id.vn`, log in with an ADMIN account; the overview loads.
10. Not exposed: `curl -s -o /dev/null -w '%{http_code}\n' https://api.weav.id.vn/actuator/health` -> not `200`; `curl --path-as-is -s -o /dev/null -w '%{http_code}\n' https://api.weav.id.vn/auth/web/../../actuator/prometheus` -> not `200` and not an identity response.
11. Client IP (the gateway writes no per-request log line with the client IP; it replaces `X-Forwarded-For` with the derived `request.ip` and identity stores it in `user_sessions.ip_address`): log in with a real test account: `curl -s -o /dev/null -X POST https://api.weav.id.vn/api/auth/login -H 'X-Forwarded-For: 1.2.3.4' -H 'Content-Type: application/json' -d '{"email":"<test>","password":"<pw>"}'`. Then, in the identity database via `psql` (direct host): `SELECT ip_address FROM identity.user_sessions ORDER BY created_at DESC LIMIT 1;`. Expected: your real public IP (`curl -s https://ifconfig.me`), not `1.2.3.4`.
12. Survives restart: `dc restart`, wait for `healthy`, repeat item 3.

Known limit: WebP avatars are not supported on the demo stack; use JPEG or PNG.

## 9. Demo-day checklist

1. T-7 days (2026-11-16 at the latest): reconnect every Google connection (Testing-mode refresh tokens expire after 7 days).
2. T-1 day: full section 8; `docker stats --no-stream` under the limits; Telegram bot token rotated.
3. T-5 min: open `https://app.weav.id.vn` once so the Neon computes are awake (they suspend when idle).
4. Fallback: the laptop runs the same stack with the same secrets and the same tunnel. Only one stack may run the tunnel at a time (two connectors of `weav-demo` load-balance across two stacks): run `dc down` on the running one first, then start the other.
   - Copy secrets laptop <-> VPS: `scp -r "$WEAV_SECRETS_DIR" user@host:~/weav-secrets`; on the target set `WEAV_SECRETS_DIR=` in its `prod.env` to the target path, then re-apply the modes:
     ```bash
     chmod 700 "$WEAV_SECRETS_DIR"; chmod 600 "$WEAV_SECRETS_DIR/prod.env"
     find "$WEAV_SECRETS_DIR/service-keys" -type d -exec chmod 755 {} +
     find "$WEAV_SECRETS_DIR/service-keys" -type f -exec chmod 644 {} +
     chmod 644 "$WEAV_SECRETS_DIR/cloudflared/creds.json"
     ```
5. Offline backup: a screen recording of the main flows.

## 10. Rollback

1. Code: `git checkout <previous tag>`, rebuild (section 7 step 2), `dc up -d`.
2. Database: use the restore point from before the release (`demo-before-<date>`, section 3 step 5): point the `*_DB_HOST` / `*_MIGRATION_URL` values in `prod.env` at that branch, then `dc up -d --force-recreate`.
3. Full stop: `dc down` (add `-v` only to also drop the RabbitMQ volume; it holds nothing worth keeping).
