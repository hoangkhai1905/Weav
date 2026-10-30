# Demo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the whole Weav stack (minus OCR) from one `compose.prod.yml` on any Docker host, reachable at `https://app.weav.id.vn`, `https://admin.weav.id.vn` and `https://api.weav.id.vn` through a named Cloudflare Tunnel, against a new Neon branch `demo`.

**Architecture:** One standalone compose file builds the existing prod Dockerfiles plus two new static images (web, admin) and runs a `cloudflared` connector; no host port is published. The tunnel routes by hostname and strict path regex: `api.` goes to the gateway except identity's browser OAuth paths and workspace's Google callback. Databases (Neon), Redis (Aiven Valkey) and object storage (R2) stay remote, so the same stack runs on the laptop (rehearsal and defense-day fallback) and on the VPS once K picks one.

**Tech Stack:** Docker Compose, BuildKit, nginx (static SPA), cloudflared (locally-managed tunnel), existing Spring Boot / NestJS prod Dockerfiles, Neon, Prisma `migrate deploy`.

**Spec:** `docs/work_logs/K/platform/demo-deployment.md` sections 2 and 6 (decisions, readiness audit, blockers), `docs/architecture/deployment-exposure.md` (exposure rules).

## Decisions for K to approve

| # | Decision | Why |
| --- | --- | --- |
| D1 | Three hostnames only: `app.`, `admin.`, `api.weav.id.vn`. On `api.`, path `^/auth/(oauth\|web)/[A-Za-z0-9/_-]*$` goes to identity-service, `^/oauth/google/callback$` goes to workspace-service, everything else to api-gateway. | Web Google sign-in and cookie refresh call identity directly (`apps/web/src/api/auth.api.ts`: `/auth/oauth/google/start`, `/auth/oauth/exchange`, `/auth/web/{csrf,login,refresh,logout}`); the workspace Google callback is not proxied by the gateway. Gateway routes all start with `/api/`, `/health`, `/ready`, so there is no clash. One API host = one Google redirect host and no extra DNS. The strict regex keeps `/actuator/**` and `..` tricks away from Spring. |
| D2 | Locally-managed named tunnel `weav-demo`; `infrastructure/cloudflared/config.yml` in git (no tunnel UUID), credentials JSON in the secrets dir. | Reproducible ingress rules under review, testable offline with `cloudflared tunnel ingress rule`. |
| D3 | Images are built on the host that runs them (`docker compose build`, one service at a time). No registry. | Works on amd64 laptop and arm64 or amd64 VPS without cross-builds. |
| D4 | Secrets live outside git in `${WEAV_SECRETS_DIR}` (default `./tmp/prod`): `prod.env`, `service-keys/`, `cloudflared/creds.json`. Git holds only `.env.prod.example`. | No secrets in the repo; `tmp/` is already ignored. |
| D5 | **K approved 2026-10-26: (a) schema-only; if Neon does not offer it, ask K.** Neon branch `demo` off `production`, **without the partner's data**: **(a, recommended)** a schema-only branch, if the Neon project offers it (check in the console before relying on it); **(b)** a full copy, then K-confirmed cleanup SQL on `demo` before first boot (delete copied workflows/triggers/connections). Flyway migrates on first boot; notification and ai Prisma migrations run from the laptop with the direct URLs. Partner's `production` and K's `dev-k` are not touched. | K decision 2026-10-26 (branch `demo`). A plain copy would bring the partner's published schedules, Gmail polls and Telegram triggers: the demo worker would run them (duplicate e-mails/messages, Telegram webhook taken from the partner's bot), and copied connections would not decrypt under the fresh `CREDENTIAL_ENCRYPTION_KEY`. |
| D6 | Demo scope: OCR off (`WORKFLOW_OCR_ENABLED=false`), AI assistant on (RS256), mobile not in the demo unless the partner rebuilds it against `api.weav.id.vn` (handoff note only). | Partner owns OCR and mobile. |
| D7 | Not changed: no SSE heartbeat, no WebP fix, no registry, no monitoring stack. Add a heartbeat only if the rehearsal shows a cut stream. | YAGNI; risks recorded in the log. |
| D8 | Work on branch `feature/demo-deploy` from `dev`; merge to `dev` after review, then to `main` (release branch) when K says so. | Team flow. |

## Global Constraints

- OCR is never built or started: `ocr-service` is absent from `compose.prod.yml`.
- No `ports:` on any service in `compose.prod.yml` (deployment-exposure.md). The only way in is the tunnel.
- `APP_ENV=production` for every service that reads it; `GATEWAY_TRUST_PROXY_HOPS=1`.
- `CORS_ALLOWED_ORIGINS=https://app.weav.id.vn,https://admin.weav.id.vn`.
- `WORKFLOW_EXECUTION_WORKER_ENABLED=true`, `WORKFLOW_EXECUTION_WORKER_OWNER=workflow-demo-worker`.
- AI on (dev defaults have it off): `WORKFLOW_AI_ENABLED=true`, `WORKFLOW_AI_GENERATION_ENABLED=true`, `AI_ASSISTANT_ENABLED=true`, `JWT_ACCESS_ALG=RS256`, `JWT_SIGNING_KEY_ID=identity-demo-1` (pass the same value when generating the identity key), `WORKFLOW_AI_DAILY_LIMIT_PER_WORKSPACE=50`.
- Compose project name `weav-prod` (top-level `name:`), so it never reuses the dev containers or networks.
- Every image must build for both `linux/amd64` and `linux/arm64`; every new base image is pinned to an exact tag at least two weeks old whose manifest lists both (`docker manifest inspect <image>`).
- `pnpm@11.22.0`, `node:24-alpine` for Node build stages (same as the service Dockerfiles).
- No secret value in git, in logs, or in the work log. `.env.prod.example` holds placeholders only.
- Public URLs: `https://app.weav.id.vn`, `https://admin.weav.id.vn`, `https://api.weav.id.vn` (no trailing slash).
- Commits: `git commit -m "summary" -m "description"`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; GitNexus `detect_changes` before each commit.

## Review Focus

1. **A frontend built without the build args** silently calls `http://localhost:3000` / `:8081`. Expected: the image build fails. Pinned in Task 2, Step 1.
2. **A deep link refreshed in the browser** (`/workflows/abc`, `/users/1` on admin) must serve `index.html`, while a missing `/assets/x.js` must be 404, not `index.html` (otherwise the browser gets HTML as JS). Pinned in Task 2, Step 1.
3. **Spring internals over the tunnel:** `https://api.weav.id.vn/actuator/health`, `/auth/web/../../actuator/prometheus`, `/auth/me` must not reach identity or workspace. Pinned in Task 4, Step 1.
4. **Private keys written 0600 by the host user** cannot be read by uid 10001 / `node` in the containers, so identity and workflow crash at start. Pinned in Task 5 (runbook permissions step) and Task 6 (rehearsal boot check).
5. **Spoofed `X-Forwarded-For`** must not change the client IP the gateway rate-limits on. Pinned in Task 6, Step 6.

---

### Task 1: Key scripts write to a chosen directory

**Files:**
- Modify: `scripts/ai-dev-keys.mjs:6`
- Modify: `scripts/identity-dev-keys.mjs:6`

**Interfaces:**
- Produces: both scripts honour `WEAV_SERVICE_KEYS_DIR` (same variable `compose.dev.yml` already uses for the mounts), default `tmp/service-keys` unchanged. Layout under it is unchanged: `private/`, `public/`, `gateway/`, `identity/`.

- [ ] **Step 1: Check the current behaviour**

Run (bash): `WEAV_SERVICE_KEYS_DIR="$TMPDIR/k1" node scripts/identity-dev-keys.mjs; ls "$TMPDIR/k1"`
Expected: `ls` fails (the script ignored the variable and wrote to `tmp/service-keys/identity`, or kept the existing key).

- [ ] **Step 2: Use the variable**

In both scripts: `const dir = process.env.WEAV_SERVICE_KEYS_DIR ?? 'tmp/service-keys';` (identity script appends `/identity`). Nothing else changes; the scripts still never print key material.

- [ ] **Step 3: Verify**

Run: `WEAV_SERVICE_KEYS_DIR="$TMPDIR/k1" node scripts/identity-dev-keys.mjs && WEAV_SERVICE_KEYS_DIR="$TMPDIR/k1" node scripts/ai-dev-keys.mjs && find "$TMPDIR/k1" -type f | sort`
Expected: `identity/identity-access.pem`, `identity/identity-access.pub.pem`, `private/workflow-service.pem`, `public/workflow-service.jwks.json`, `gateway/api-gateway.pem`, `public/api-gateway.jwks.json` (exact names as the scripts write today). Then `node scripts/identity-dev-keys.mjs` without the variable prints `kept existing tmp/service-keys/identity/...` (default path unchanged). Delete `$TMPDIR/k1`.

- [ ] **Step 4: Commit** `chore(scripts): key scripts honour WEAV_SERVICE_KEYS_DIR`

### Task 2: Web and admin static images

**Files:**
- Create: `infrastructure/nginx/spa.conf`
- Create: `apps/web/Dockerfile`
- Create: `apps/admin/Dockerfile`

**Interfaces:**
- Produces: images listening on port 8080 (non-root nginx), build context = repo root.
  - web build args: `VITE_API_BASE_URL`, `VITE_IDENTITY_SERVICE_URL`, `VITE_API_MODE` (default `http`), `VITE_PUBLIC_WEBHOOK_BASE_URL` (optional).
  - admin build args: `VITE_API_GATEWAY_URL`.
- Consumed by Task 3 (`web`, `admin` services) and Task 4 (tunnel targets `http://web:8080`, `http://admin:8080`).

- [ ] **Step 1: Write the check script first** (`scripts/check-spa-image.sh <image>`; leave it in the repo as the runnable check)

It runs the image on a random local port and asserts:
- `GET /` → 200, `content-type: text/html`, `cache-control` contains `no-cache`.
- `GET /workflows/abc` → 200 and the same body as `/` (SPA fallback).
- `GET /assets/does-not-exist.js` → 404.
- `GET` of one real file under `/assets/` (first `src=` in `index.html`) → 200 with `cache-control` containing `immutable`.
- `docker run --rm --entrypoint sh <image> -c "grep -rl 'localhost:3000\|localhost:8081' /usr/share/nginx/html"` finds nothing.

Run it against a not-yet-existing image. Expected: FAIL.

- [ ] **Step 2: `infrastructure/nginx/spa.conf`**

`listen 8080`; `root /usr/share/nginx/html`; `location /assets/ { try_files $uri =404; expires 1y; add_header Cache-Control "public, immutable"; }`; `location / { try_files $uri /index.html; add_header Cache-Control "no-cache"; }`; `gzip on` for js/css/json/svg; `server_tokens off`.

- [ ] **Step 3: Dockerfiles**

Build stage: `node:24-alpine`, corepack `pnpm@11.22.0`, copy root `package.json pnpm-workspace.yaml pnpm-lock.yaml` + the app's `package.json`, `pnpm install --filter ./apps/<app>... --frozen-lockfile`, copy the app, `ARG`s → `ENV`, `pnpm --filter ./apps/<app> build`. Then **fail the build** if any required arg is empty or if `grep -rl 'localhost:3000\|localhost:8081' apps/<app>/dist` finds a file (Review Focus 1). Runtime stage: `nginxinc/nginx-unprivileged:<exact alpine tag>` (runs as uid 101, port 8080), copy `infrastructure/nginx/spa.conf` to `/etc/nginx/conf.d/default.conf`, copy `dist/`.

- [ ] **Step 4: Verify**

Run:
```bash
docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL=https://api.weav.id.vn --build-arg VITE_IDENTITY_SERVICE_URL=https://api.weav.id.vn -t weav-web:check .
docker build -f apps/admin/Dockerfile --build-arg VITE_API_GATEWAY_URL=https://api.weav.id.vn -t weav-admin:check .
bash scripts/check-spa-image.sh weav-web:check && bash scripts/check-spa-image.sh weav-admin:check
docker build -f apps/admin/Dockerfile -t weav-admin:noargs .
```
Expected: first three PASS; the last build FAILS with the missing-arg message. Remove the `:check`/`:noargs` images afterwards.

- [ ] **Step 5: Commit** `feat(deploy): static images for web and admin`

### Task 3: `compose.prod.yml` and the env template

**Files:**
- Create: `compose.prod.yml`
- Create: `.env.prod.example`
- Modify: `.gitignore` (add `!.env.prod.example` after `!.env.example`)

**Interfaces:**
- Consumes: Task 2 Dockerfiles; existing `services/*/Dockerfile`.
- Produces: services `rabbitmq`, `identity-service`, `workspace-service`, `workflow-service`, `ai-service`, `api-gateway`, `notification-service`, `web`, `admin` (Task 4 adds `cloudflared`). Networks `default` and `edge` (172.31.250.0/24). Started with `docker compose -f compose.prod.yml --env-file ${WEAV_SECRETS_DIR}/prod.env up -d`.

Rules (derive each service's `environment:` from `compose.dev.yml`, then apply these):
- `build`: identity/workspace/workflow context = service folder, `dockerfile: Dockerfile`; workflow adds `additional_contexts: { workflow-schema: ./packages/workflow-schema }`; ai-service, api-gateway, notification-service context `.` with `dockerfile: services/<name>/Dockerfile`; web/admin as in Task 2 with the build args written literally (`https://api.weav.id.vn`).
- Drop: `Dockerfile.dev`, `develop.watch`, source/m2 mounts, `MAVEN_OPTS`, `JAVA_TOOL_OPTIONS`, every `ports:`, the Spring `curl` healthchecks (the prod images carry a wget `HEALTHCHECK`), the gateway OCR key mount and OCR env, `container_name`.
- Keep: `restart: unless-stopped` on all; `edge` network, gateway `ipv4_address: 172.31.250.10`, identity alias `identity-edge`, `GATEWAY_IDENTITY_SERVICE_URL=http://identity-edge:8080`; `depends_on: rabbitmq: condition: service_healthy` for identity, workflow, notification.
- `mem_limit`: identity 768m, workspace 768m, workflow 1g, ai-service 384m, api-gateway 384m, notification-service 384m, rabbitmq 512m, web 64m, admin 64m.
- Key mounts from `${WEAV_SECRETS_DIR}/service-keys/{identity,public,private}` (`:ro`) exactly where dev mounts them.
- rabbitmq: `rabbitmq:4-management`, named volume, credentials from `RABBITMQ_USERNAME`/`RABBITMQ_PASSWORD` (no guest default), `NOTIFICATION_LEGACY_DRAIN=false` on notification-service (fresh broker).
- Fixed values from Global Constraints are written literally in the compose file, not in the env file; secrets and per-host values come from the env file with `${VAR:?set VAR in prod.env}` so a missing one stops `up`.
- `IDENTITY_TRUSTED_PROXY_PATTERN=172[.]31[.]250[.](10|11)` (gateway pin + cloudflared pin from Task 4).
- Public URL envs: `GOOGLE_REDIRECT_URI=https://api.weav.id.vn/auth/oauth/google/callback`, `OAUTH_WEB_RETURN_TARGET_URI=https://app.weav.id.vn/auth/callback`, `OAUTH_WEB_ALLOWED_ORIGIN=https://app.weav.id.vn`, `GOOGLE_OAUTH_REDIRECT_URI=https://api.weav.id.vn/oauth/google/callback`, `GOOGLE_OAUTH_FRONTEND_RETURN_URL=https://app.weav.id.vn/connections`, `WORKFLOW_PUBLIC_BASE_URL=https://api.weav.id.vn`, `WORKFLOW_WEB_BASE_URL=https://app.weav.id.vn`, `NOTIFICATION_DETAIL_BASE_URL=https://app.weav.id.vn`, `NOTIFICATION_EMAIL_ENABLED=true`.
- `.env.prod.example`: every `${VAR:?...}` the compose file uses, grouped (Neon demo DB hosts/users/passwords per service + direct migration URLs, `VALKEY_URL` (`rediss://`), JWT/OTP/internal service secrets, `CREDENTIAL_ENCRYPTION_KEY`, RabbitMQ, Google OAuth client, SMTP (Resend), R2, DeepSeek, `WEAV_SECRETS_DIR`), each `CHANGE_ME` with a one-line comment on how to generate it (`openssl rand -base64 48` etc.).

- [ ] **Step 1: Write the static check** (`scripts/check-compose-prod.sh`, kept as the runnable check)

With `--env-file .env.prod.example`: `docker compose -f compose.prod.yml config --format json` succeeds, and jq asserts: project `name` is `weav-prod`; every `depends_on` with `condition: service_healthy` points at a service that has a healthcheck in compose or a `HEALTHCHECK` in its Dockerfile (web and admin get a compose healthcheck `wget -qO- http://127.0.0.1:8080/ >/dev/null`, since `nginx-unprivileged` has none); the AI values from Global Constraints are set; no service has `ports`; service set equals the list above (+`cloudflared` once Task 4 lands); no service name contains `ocr`; every service has `restart: unless-stopped` and a `mem_limit`; `workflow-service` env has `WORKFLOW_EXECUTION_WORKER_ENABLED=true`; `api-gateway` env has `APP_ENV=production`, `GATEWAY_TRUST_PROXY_HOPS=1` and the exact CORS string; `api-gateway` has `ipv4_address 172.31.250.10`. Also: with an empty env file, `config` FAILS naming a missing variable.

Run it now. Expected: FAIL (no compose file).

- [ ] **Step 2: Write `compose.prod.yml`, `.env.prod.example`, the `.gitignore` exception** per the rules above.

- [ ] **Step 3: Verify**

Run: `bash scripts/check-compose-prod.sh` → PASS. `git check-ignore .env.prod.example` → not ignored. `docker compose -f compose.prod.yml --env-file .env.prod.example build identity-service` → builds (proves the context paths; repeat for `workflow-service` and `api-gateway`, one at a time). Remove the built images afterwards.

- [ ] **Step 4: Commit** `feat(deploy): production compose file and env template`

### Task 4: Cloudflare Tunnel connector

**Files:**
- Create: `infrastructure/cloudflared/config.yml`
- Modify: `compose.prod.yml` (add `cloudflared`)
- Create: `scripts/check-tunnel-ingress.sh`

**Interfaces:**
- Consumes: service names/ports from Task 3 (`api-gateway:3000`, `identity-service:8080`, `workspace-service:8080`, `web:8080`, `admin:8080`).
- Produces: `cloudflared` service on `default` and `edge` (`ipv4_address: 172.31.250.11`), command `tunnel --no-autoupdate --config /etc/cloudflared/config.yml run weav-demo`, mounts `config.yml` and `${WEAV_SECRETS_DIR}/cloudflared/creds.json` (`:ro`), `depends_on` api-gateway/web/admin healthy, `mem_limit: 128m`.

`config.yml` (no `tunnel:` line, the name is on the command line):
```yaml
credentials-file: /etc/cloudflared/creds.json
ingress:
  - hostname: api.weav.id.vn
    path: ^/auth/(oauth|web)/[A-Za-z0-9/_-]*$
    service: http://identity-edge:8080
  - hostname: api.weav.id.vn
    path: ^/oauth/google/callback$
    service: http://workspace-service:8080
  - hostname: api.weav.id.vn
    service: http://api-gateway:3000
  - hostname: app.weav.id.vn
    service: http://web:8080
  - hostname: admin.weav.id.vn
    service: http://admin:8080
  - service: http_status:404
```

- [ ] **Step 1: Write `scripts/check-tunnel-ingress.sh`**

Runs `docker run --rm -v <repo>/infrastructure/cloudflared:/etc/cloudflared:ro cloudflare/cloudflared:<pinned> tunnel --config /etc/cloudflared/config.yml ingress validate` and then `ingress rule <url>` for each row, asserting the matched service:

| URL | Expected service |
| --- | --- |
| `https://api.weav.id.vn/auth/web/csrf` | `identity-edge:8080` |
| `https://api.weav.id.vn/auth/oauth/google/mobile/start` | `identity-edge:8080` |
| `https://api.weav.id.vn/auth/oauth/google/callback` | `identity-edge:8080` |
| `https://api.weav.id.vn/auth/oauth/google/callback?code=a%2Fb&state=c` | `identity-edge:8080` |
| `https://api.weav.id.vn/oauth/google/callback` | `workspace-service:8080` |
| `https://api.weav.id.vn/oauth/google/callback?code=a%2Fb&state=c` | `workspace-service:8080` |
| `https://api.weav.id.vn/actuator/health` | `api-gateway:3000` |
| `https://api.weav.id.vn/auth/web/../../actuator/prometheus` | `api-gateway:3000` |
| `https://api.weav.id.vn/auth/me` | `api-gateway:3000` |
| `https://api.weav.id.vn/oauth/google/callback/x` | `api-gateway:3000` |
| `https://api.weav.id.vn/api/v1/webhooks/telegram/k` | `api-gateway:3000` |
| `https://app.weav.id.vn/workflows/abc` | `web:8080` |
| `https://admin.weav.id.vn/users` | `admin:8080` |
| `https://evil.weav.id.vn/` | `http_status:404` |

Run before the config exists. Expected: FAIL. If `ingress rule` needs the credentials file to exist, mount an empty dummy `creds.json` in the check only.

- [ ] **Step 2: Write `config.yml` and the compose service.** Pin `cloudflare/cloudflared` to an exact release tag with arm64 in its manifest.

- [ ] **Step 3: Verify** `bash scripts/check-tunnel-ingress.sh` → all rows PASS; `bash scripts/check-compose-prod.sh` (now expecting `cloudflared`, no ports) → PASS.

- [ ] **Step 4: Commit** `feat(deploy): named Cloudflare Tunnel with path-restricted routes`

### Task 5: Runbook

**Files:**
- Create: `docs/deployment/demo-runbook.md`
- Modify: `docs/work_logs/K/platform/demo-deployment.md` (link the plan and runbook)
- Create: `docs/handoff/2026-10-demo-mobile.md` (partner: `EXPO_PUBLIC_API_BASE_URL=https://api.weav.id.vn`, `EXPO_PUBLIC_IDENTITY_URL=https://api.weav.id.vn`, rebuild/EAS update, `OAUTH_MOBILE_RETURN_TARGET_URI`, Telegram screen still calls removed `/api/telegram`)

Sections, each a numbered list of exact commands with expected output:
1. **Prerequisites on a host:** Docker Engine with compose v2 and BuildKit, `git`, 4 GB RAM minimum (8 GB comfortable), swap 2 GB, Docker enabled at boot, clock synced (NTP).
2. **One-time Cloudflare:** `cloudflared tunnel login`, `cloudflared tunnel create weav-demo` (writes the credentials JSON → copy to `${WEAV_SECRETS_DIR}/cloudflared/creds.json`), `cloudflared tunnel route dns weav-demo api.weav.id.vn` (and `app.`, `admin.`). SSL/TLS mode Full; check "Normalize incoming URLs" is on.
3. **One-time Neon:** create branch `demo` from `production` the way K chose in D5 (schema-only, or full copy + K-confirmed cleanup that deletes copied workflows, triggers and connections before first boot; K approves either); record the pooled hosts for runtime and direct hosts for `NOTIFICATION_MIGRATION_URL` / `AI_MIGRATION_URL` (`?schema=ai`).
4. **One-time secrets:** create `${WEAV_SECRETS_DIR}` (`chmod 700`), copy `.env.prod.example` to `prod.env` and fill it; generate keys with `WEAV_SERVICE_KEYS_DIR=${WEAV_SECRETS_DIR}/service-keys JWT_SIGNING_KEY_ID=identity-demo-1 node scripts/identity-dev-keys.mjs` and `... node scripts/ai-dev-keys.mjs`; then `chmod 755` the key subfolders and `chmod 644` the key files (Review Focus 4: containers run as uid 10001 and `node`; the parent stays 700).
5. **One-time Google Cloud Console:** authorised redirect URIs `https://api.weav.id.vn/auth/oauth/google/callback` and `https://api.weav.id.vn/oauth/google/callback`; JS origin `https://app.weav.id.vn`; Testing-mode test users added; note that refresh tokens expire after 7 days (reconnect Google connections between 11-16 and 11-22).
6. **Migrations (from the laptop, before first boot and after any release with new migrations):** set `NOTIFICATION_MIGRATION_URL` / `AI_MIGRATION_URL` inline from `prod.env` (the root `.env` points at `dev-k`), run `prisma migrate status` first and confirm it names the `demo` endpoint, then `pnpm --dir services/notification-service db:migrate` and `pnpm --dir services/ai-service db:migrate`. Flyway runs itself at boot.
7. **Deploy / update:** `git checkout main && git pull`; build one at a time (`for s in identity-service workspace-service workflow-service ai-service api-gateway notification-service web admin; do docker compose -f compose.prod.yml --env-file "$WEAV_SECRETS_DIR/prod.env" build $s; done`); `up -d`; `docker compose ps` all `healthy`.
8. **Smoke test** (browser, then each item PASS/FAIL in the work log): register + OTP e-mail arrives; Google sign-in; dashboard loads with no request to `localhost` (DevTools network); create workflow from template, run, see SUCCESS; Google connection connect; Telegram trigger webhook registers (`getWebhookInfo` shows `https://api.weav.id.vn/...`); assistant answers a question (stream completes); invite by e-mail link opens `https://app.weav.id.vn/invitations`; admin login (ADMIN account) loads overview; `curl -s -o /dev/null -w '%{http_code}' https://api.weav.id.vn/actuator/health` is not 200.
9. **Demo-day checklist:** T-7 days reconnect Google; T-1 day full smoke test, `docker stats` under limits, Neon compute not suspended at start time (open the app 5 min before); laptop fallback ready (same secrets dir and the same tunnel; two running connectors of `weav-demo` would load-balance across two stacks, so stop the VPS stack before starting the laptop one); offline backup: screen recording of the main flows.
10. **Rollback:** `git checkout <previous tag>`, rebuild, `up -d`; DB: Neon branch restore point taken before each release (`demo` → create branch `demo-before-<date>`).

- [ ] **Step 1: Write the three documents.**
- [ ] **Step 2: Verify** every command in the runbook references a file, script or variable that exists after Tasks 1-4 (`grep` each script/var name in the repo); `git diff --check` clean.
- [ ] **Step 3: Commit** `docs(deploy): demo runbook and mobile handoff`

### Task 6: Laptop rehearsal (live; needs K's approvals)

Coordinator-run, not a subagent task. K approves each external action when it comes up: Neon `demo` branch, tunnel creation and DNS routes, Google Console redirect URIs.

- [ ] **Step 1:** Runbook sections 2-6 on the laptop (Docker Desktop, amd64).
- [ ] **Step 2:** `docker compose -f compose.yml -f compose.dev.yml down` (frees the `edge` subnet) and stop any quick tunnel, then runbook section 7. Expected: every service `healthy` within 3 min; `docker stats` totals under 5 GB.
- [ ] **Step 3:** Runbook section 8 smoke test in the in-app browser. Record PASS/FAIL with run ids in the work log.
- [ ] **Step 4:** Review Focus 4: `docker compose logs identity-service workflow-service | grep -i "permission denied\|AccessDenied"` → nothing.
- [ ] **Step 5:** Review Focus 3 live: `curl` `https://api.weav.id.vn/actuator/health` and `--path-as-is https://api.weav.id.vn/auth/web/../../actuator/prometheus` → both non-200 from the gateway, not identity.
- [ ] **Step 6:** Review Focus 5: send 2 requests to `https://api.weav.id.vn/api/auth/login` with header `X-Forwarded-For: 1.2.3.4`; the gateway log shows K's real public IP, not `1.2.3.4`.
- [ ] **Step 7:** Assistant stream: ask a question that triggers a tool call; the stream completes. If it is cut near 100 s, open a follow-up for an SSE heartbeat (D7).
- [ ] **Step 8:** `docker compose restart` then re-run the dashboard smoke item (survives restart).
- [ ] **Step 9:** Work log updated (no secrets), GitNexus `detect_changes`, merge `feature/demo-deploy` into `dev` (`--no-ff`) after review.

### Task 7: Move to the chosen host

Runs when K has a host. Same runbook on the VPS (sections 1, 4 copy the secrets dir over SSH with `scp -r`, 7, 8). Stop the laptop connector first. Expected extra checks: images built natively on the host's arch; services `healthy` after a VM reboot (`sudo reboot`, then `docker compose ps`).

## Out of scope (tracked elsewhere)

Admin in CI, partner branch merge, live regression at freeze, thesis evidence set, SSE heartbeat, WebP on alpine, Telegram token rotation (K does it in @BotFather before the demo).
