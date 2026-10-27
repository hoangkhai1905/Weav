# Demo deployment (domain, DNS, email, hosting)

## 1. Metadata

| Field | Value |
| --- | --- |
| Date | 2026-10-07, readiness audit 2026-10-26 (Asia/Saigon) |
| Owner | K, coordinator (Claude) |
| Status | In progress: domain, DNS and system email done. Readiness audit 2026-10-26 (section 6): code is ready, deploy artifacts and host are not |
| Scope | Demo hosting of the backend (no infrastructure is created without K's approval of a written plan) |

## 2. Decisions

| Decision | Reason |
| --- | --- |
| Domain `weav.id.vn` (inet.vn, VNNIC free `.id.vn`, active until 2028-10-07) | Free for the thesis period |
| DNS on Cloudflare (Free): nameservers `gerardo.ns.cloudflare.com`, `summer.ns.cloudflare.com`; inet OneShield not used | `id.vn` is on the Public Suffix List, so the zone is allowed on the free plan; enables a named Cloudflare Tunnel |
| Planned: named Cloudflare Tunnel, `api.weav.id.vn` -> gateway, `app.weav.id.vn` -> frontend | No open ports on the host, Cloudflare TLS, stable Telegram webhook URL (replaces the quick tunnel). Proxy idle cutoff about 100 s: verify assistant SSE |
| Planned host: Oracle Cloud Always Free (ARM, home region ap-singapore-1, Pay-As-You-Go to avoid idle reclamation) | Budget; next to Neon. On hold |
| Release branch `main` (staging -> dev -> main when K says so) | K's decision |
| OCR disabled for the demo until the partner provides a stable URL (it runs on Google Colab) | Colab sessions stop |
| System email (identity OTP) via Resend SMTP from `no-reply@weav.id.vn` | Branded sender, no personal Gmail App Password on the server |

Open: which Neon branch the deployed stack uses (partner moves off `production`, recommended, or a new `demo` branch).

## 3. Changes

- Cloudflare zone `weav.id.vn`: imported OneShield A/AAAA records deleted; Resend records added by the Resend integration: `send` and `rsend` CNAME (switched to DNS only), `resend._domainkey` TXT (DKIM), `_dmarc` TXT (`p=none`).
- K's local `.env`: `SMTP_*` switched to Resend (`smtp.resend.com:587` STARTTLS, user `resend`, API key with sending access, from `no-reply@weav.id.vn`) by script without printing values; the previous Gmail lines are in `tmp/smtp-gmail-backup.env` (git-ignored).
- `.env.example`: SMTP comment documents the Resend option (no variable or default changed).

## 4. Checks

| Check | Result |
| --- | --- |
| `nslookup -type=NS weav.id.vn` via 1.1.1.1 and 8.8.8.8 | Cloudflare nameservers |
| Public DNS for the Resend records | CNAMEs resolve to Resend targets (not proxied), DKIM and DMARC TXT present |
| `POST /api/auth/otp/request` PASSWORD_RESET for a password account | HTTP 202; email from Weav <no-reply@weav.id.vn> received by K |

Note: a password reset for an account without a password (Google sign-in) is accepted but sends nothing by design (no account enumeration).

Left behind: throwaway account `nhoangkhai195+resendtest@gmail.com` ("Resend test", random unknown password) in the `dev-k` identity database; delete when no longer useful.

## 5. Next steps

1. Partner: finish FE routing; decide the Neon branch for the deployed stack.
2. Oracle account and ARM VM; cloudflared named tunnel.
3. Written plan for K's approval: `compose.prod.yml` (prod Dockerfiles, heap limits, restart policies), tunnel config, VM runbook, production RS256 keys, Google OAuth redirect URLs, Flyway/Prisma migrations on the chosen Neon branch (backup branch first), R2 lifecycle rule on `workflow-files/`, demo checklist.

## 6. Readiness audit (2026-10-26, `dev` e05467f1)

Read-only audit: three subagent reports (compose dev to prod gap, web/admin build, open-items sweep) plus coordinator spot checks. No files besides this log were changed.

K decisions 2026-10-26: demo DB = new Neon branch `demo` (off `production`, backup branch first); defense around 2026-11-23. Oracle Free sign-up keeps failing, so the host is open again.

### Verdict per area

| Area | State | Evidence / gap |
| --- | --- | --- |
| Backend code | CI green, live unverified | CI run 39693154910 on `dev` HEAD ran and passed all 6 service jobs + notification integration. 0 open GitHub issues. Last full live check was e2e-audit section 12 (`week6`, 10-10); admin web, BYOK, ui-redesign-v2, manual-cap-retention, neon-suspend merged since without a live regression. |
| Web | Build green, live unverified | `tsc` + `build` pass; all 1,311 static i18n keys exist; bundle 1.7 MB (466 kB gzip), acceptable. Playwright full suite at 10-19 (e2e-v2-spec-repair.md): 416 passed, 2 skipped, 2 failed (request-budget, by decision). |
| Mobile | Partner, needs rebuild | `EXPO_PUBLIC_API_BASE_URL` / `EXPO_PUBLIC_IDENTITY_URL` are inlined at bundle time: rebuild or EAS update against the public URLs; backend `OAUTH_MOBILE_RETURN_TARGET_URI=weav://...`. the earlier report of removed `/api/telegram` calls is stale: no such call in `apps/mobile/src` (checked 2026-10-26). Scope out of the demo or hand off to the partner. |
| Admin | Ready (build), not in CI | `tsc`, `build`, `eslint` pass locally; `apps/admin` is missing from `.github/workflows/ci.yml`. |
| Unmerged work | Open | `origin/fix/workflow-live-node-test` (partner, 3 commits 10-22): format.text number coercion fix, six-field cron hint, ai-service dev mem 1g. Review + merge before freeze. |
| Base images arm64 | OK | `eclipse-temurin:25-jdk`, `25-jre-alpine`, `node:24-alpine`, `rabbitmq:4-management` all list arm64. |
| Deploy artifacts | Missing | No `compose.prod.yml`, no web/admin Dockerfile or static server, no cloudflared service, `infrastructure/docker/production` empty. |
| Host | Missing | Oracle sign-up fails. Stack needs about 4 GB RAM (8 GB comfortable). |
| Thesis evidence | Missing | No k6 test, AI eval, test report, architecture diagram (`docs/diagrams` empty) or RabbitMQ vs BullMQ note in the repo. |

### Deploy blockers found (beyond the missing files)

1. `WORKFLOW_EXECUTION_WORKER_ENABLED` defaults to `false` (compose.dev.yml:343, application.properties:144): prod must set `true` or no run executes.
2. Identity must be public over HTTPS: web Google sign-in, link/unlink and cookie refresh call `VITE_IDENTITY_SERVICE_URL` directly (apps/web/src/api/auth.api.ts:108), mobile OAuth legs too (D-OA1). Expose only `/auth/**` (tunnel path rule), never `/actuator/**` (deployment-exposure.md).
3. Workspace Google connection callback is not proxied by the gateway: `GOOGLE_OAUTH_REDIRECT_URI` points at workspace-service `:8082/oauth/google/callback`. Needs a path-restricted public route or a gateway route.
4. Identity trusts `X-Forwarded-For` only from `IDENTITY_TRUSTED_PROXY_PATTERN` (gateway pin 172.31.250.10). If cloudflared reaches identity directly, pin cloudflared's IP on `edge` and add it to the pattern.
5. Prod env: `APP_ENV=production` (gateway then refuses to start without `CORS_ALLOWED_ORIGINS` and `GATEWAY_TRUST_PROXY_HOPS>=1`), all public URLs (`GOOGLE_REDIRECT_URI`, `OAUTH_WEB_RETURN_TARGET_URI`, `OAUTH_WEB_ALLOWED_ORIGIN`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_FRONTEND_RETURN_URL`, `WORKFLOW_PUBLIC_BASE_URL`, `WORKFLOW_WEB_BASE_URL`, `NOTIFICATION_DETAIL_BASE_URL`), build-time `VITE_API_BASE_URL`, `VITE_API_MODE=http`, `VITE_IDENTITY_SERVICE_URL`, admin `VITE_API_GATEWAY_URL`.
6. Fresh secrets and keys (JWT/OTP/internal keys, `CREDENTIAL_ENCRYPTION_KEY`, RS256 identity + workflow service keys, RabbitMQ creds). Private keys are written 0600 by the host user; containers run as uid 10001 (Spring) and `node`, so fix ownership.
7. Migrations: Flyway runs at boot; notification and ai Prisma `migrate deploy` must be run by hand with the direct `*_MIGRATION_URL` (no prisma CLI in the runtime images).
8. Google OAuth: register both prod redirect URIs; app is in Testing mode (add test users, refresh tokens expire after 7 days, reconnect in the week before the defense).

### Risks (not blockers)

- WebP avatars: `webp-imageio` ships only an x86-64 glibc `.so`; on alpine (any arch) WebP upload likely fails. Demo with JPEG/PNG.
- Assistant SSE has no heartbeat; Cloudflare cuts idle streams at about 100 s. Fine for normal token streams; a `: ping` every 15 s in ai-service would remove the risk.
- Building three JDK 25 images on a small VPS is slow; build on the laptop or in CI and push to GHCR when the host is amd64, or build natively on arm64.
- Telegram bot token pasted in chat earlier (e2e-audit): no record of rotation.
- Spring compose healthchecks use `curl`, absent from the alpine prod images (their Dockerfile `HEALTHCHECK` uses wget).

### Next steps

1. K: pick a host (Oracle failed; options: student credits such as Azure for Students or DigitalOcean via GitHub Student Pack, a paid 4-8 GB VPS near Singapore, or the laptop + named tunnel as fallback). This is the critical path.
2. Coordinator: written plan (`docs/superpowers/plans/2026-10-26-demo-deployment.md`, approved by K 2026-10-26; D5 = schema-only `demo` branch if Neon offers it, else ask K) for `compose.prod.yml`, web/admin Dockerfiles + static server, cloudflared ingress (`app.`, `api.`, `admin.`, `id.` with path rules), prod env template, runbook — K approves before any infrastructure is created.
   - Runbook: `docs/deployment/demo-runbook.md`; partner handoff: `docs/handoff/2026-10-demo-mobile.md`.
3. Rehearse the same compose + named tunnel on the laptop (Neon `demo` branch), then move to the host.
   - Neon check 2026-10-26 (docs + project `falling-dust-77255917`): schema-only branches exist (beta; console or API `init_source: schema-only`, not in the MCP tool). Root branches today: `production` only (Free allowance 3); `production` and `dev-k` are archived (cold start on first connect). Console default auto-deletes after 1 day: uncheck it. A schema-only copy has empty `flyway_schema_history` / `_prisma_migrations`, so Flyway and Prisma would re-run V1 against existing tables and fail. Plan: on the fresh, empty `demo` branch drop the service schemas (K confirms) and let Flyway/Prisma build them from scratch. UNVERIFIED: whether roles and passwords are copied to a schema-only root branch.
4. Merge the partner branch and add admin to CI before the 10-31 freeze; then a full live regression on current `dev`, including the spec-only items: new account "Could not load data" (#3), forgot-password step lost on navigation (#40).
5. Evidence set (k6, AI eval, test report, architecture diagram, RabbitMQ vs BullMQ).

### Progress 2026-10-26 (branch `feature/demo-deploy`, not pushed)

- Plan Tasks 1-5 done by Sonnet lanes, each reviewed by a different agent with one fix round: `c31ced75` (web/admin images, key-dir option), `9dceed8f` (compose.prod.yml, tunnel, check scripts), then the runbook commit. Checks: `scripts/check-spa-image.sh` 5/5 on web and admin, `scripts/check-compose-prod.sh` PASS (incl. mutation tests), `scripts/check-tunnel-ingress.sh` 14/14; all eight images built on amd64 (arm64 only by manifest).
- Not done: Task 6 laptop rehearsal (needs K: Neon `demo` schema-only branch, `cloudflared tunnel create`/DNS routes, Google Console URIs, filled `prod.env`), Task 7 (host). Open risk: Spring heap at 768m limits is unmeasured (MaxRAMPercentage=75 is fixed in the Dockerfiles); measure with `docker stats` in the rehearsal.
- GitNexus re-indexed 2026-10-26; `detect-changes --scope compare --base-ref dev` on `feature/demo-deploy`: 18 files, 18 symbols (doc sections and scripts), 0 affected processes, risk low (not reported partial/truncated). Lane B fix-round removals re-checked: workflow-service reads no Valkey variable, ai-service gets its schema from `@@schema("ai")`, `APP_ENV` is read only by the gateway.

### Task 6 laptop rehearsal (2026-10-27, done)

- Neon `demo` = schema-only branch `br-mute-term-b3crg0vn` (endpoint `ep-spring-fog-b39m2zcr`), service schemas dropped with K's confirmation and rebuilt by Flyway/Prisma; tunnel `weav-demo` (`f982cd02-…`) with CNAMEs api./app./admin.weav.id.vn; secrets in `T:/Weav/tmp/prod` (prod.env, keys `identity-demo-1`, creds.json); all 8 images built on the laptop (amd64).
- Stack healthy, idle memory about 1.7 GB; public routing checked (actuator and `..` blocked, CORS app origin only).
- Freeze regression R1-R16 run on this stack (e2e-audit section 13.1): all pass after two fixes found by the run: builder run-expression blocker (`fd0d9ffe`, merged to dev) and the missing tunnel route for identity Google link/unlink (`fe1d25b6`). Google Console needed `https://api.weav.id.vn/oauth/google/callback` on client `795495011695-…`.
- Open: e-mail verification is not part of sign-up (K wants it automatic); low UI findings in e2e-audit 13.1; Task 7 (VPS) waits for a host. The laptop stack is still running.
- 2026-10-27 afternoon: e-mail verification at sign-up + inline on Invitations merged to dev (1a4d03e9); `feature/demo-deploy` merged into dev (c942c0ea, detect_changes vs dev: risk low, 0 processes). Not pushed.
