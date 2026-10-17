# Nhật ký: Backend review fixes 2026-10

> Feature log for the fixes from `docs/reviews/2026-10-01-backend-review.md` (G*, P*, M*, N*, D1 IDs). Extend this file in place.

## 1. Metadata

| Trường                       | Giá trị |
| ---------------------------- | ------- |
| Ngày làm việc                | `2026-10-12` |
| Múi giờ ghi log              | `UTC` (cloud container) |
| Dự án / repository           | `Weav` |
| Nhánh / commit đầu ngày      | `fix/backend-review-2026-10` from `origin/dev` / `32cbe8d` |
| Người thực hiện              | AI agent (Claude Code, cloud session) with 3 Sonnet sub-agents on disjoint folders (notification-service, ai-service, api-gateway + contracts) |
| Người review / nhận bàn giao | K (owner merges into `dev` after local live verification) |
| Trạng thái cuối ngày         | `Hoàn thành` (code + tests); live stack / Neon verification pending with the owner |
| Phạm vi session              | Batches 1-7 of the backend review prompt; no merge into `dev`/`main` |

## 2. Tóm tắt điều hành

- Batch 1 cleanup: dead files/classes, unused deps, `reconcileLegacy` and its operator script, stale docs/keys removed.
- Security/config: production trust-proxy guard, admin-only `/ready/upstreams`, capped upstream reads, `show-details=never` everywhere, deployment exposure doc.
- Workflow correctness: dedicated `@Scheduled` pool (G2 bug), manual-run cap (429), isolated purge steps, V16 indexes, alert-firing purge, cheap long-running sweep.
- Identity/workspace: identity outbox purge, workspace publisher no longer holds a DB connection during the broker confirm, driver-side socket/statement timeouts.
- Idle backoff for all 1 s pollers (Neon scale-to-zero) with wake-on-commit for outboxes.
- Notification: error codes/logging, prefetch 5, retention purge (+ Prisma index migration). AI: quota refund + rollback on failed turns, chat circuit breaker, batched purge, keyset cursor.
- Contracts: `node-capabilities` route, assistant `beforeId` cursor.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | 3 Spring services (JDK 25, Maven 3.9.16), 3 NestJS services |
| Unit / integration test | `PASS` (env-only errors only) | see section 9 |
| Migration / database | `Chưa áp dụng` | Flyway V16 (workflow) runs in Testcontainers only; Prisma notification migration applied manually by the owner |
| Health check | `Chưa kiểm tra` | no live stack / no `.env` in the cloud container |
| Review thay đổi | `Đã kiểm tra` | own review of every sub-agent diff, `git diff --check` |
| Commit / PR | 7 batch commits on `fix/backend-review-2026-10`, pushed | no PR, no merge (team merges with `--no-ff`) |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- `services/identity-service`, `workspace-service`, `workflow-service`, `api-gateway`, `notification-service`, `ai-service`, `packages/contracts`, `.env.example`, `compose.dev.yml`, docs.

### Ngoài phạm vi / chủ động chưa làm

- `services/ocr-service`, `apps/mobile`, `apps/web` (no web change needed: `NodeCapabilities` already matches the new contract).
- Dropping tables/indexes (`agent_runs`/`agent_steps`, `files`, `idx_workflow_triggers_endpoint`, `idx_workflow_triggers_status_type`), identity outbox FAILED state, moving Telegram registration after commit, removing HS256 acceptance, DLQ consumer/alerting, placeholder folders.

## 4. Bối cảnh và giả định

- No `.env`, no Neon access, no cloud infra. Docker was started inside the container, so Testcontainers suites ran. JDK 25 was extracted from the `eclipse-temurin:25-jdk` image (the container only had JDK 21); Maven 3.9.16 was used directly because `mvnw` could not fetch through the proxy.
- GitNexus: `npx gitnexus@latest analyze --index-only` succeeded (FTS extension missing, graph usable). `impact` ran before edits; many Java beans/handlers return `UNKNOWN` (Spring wiring), confirmed with grep. `detect-changes --scope staged` ran before every commit.
- Baseline (`origin/dev`, same container): identity 384 tests / 4 errors (3 MinIO + 1 notification bridge without `dist`), workspace 3 bridge errors, workflow 1104 tests / 3 errors (2 TLS cert + 1 bridge). All are environment-only.
- Baseline lint (`eslint "{src,test}/**/*.ts"`, no `--fix`) was already red: api-gateway 6, ai-service 148, notification-service 51 problems.

## 5. Nhật ký theo batch

| Batch | Commit | Việc đã thực hiện | Trạng thái |
| --- | --- | --- | --- |
| 1 cleanup | `f38771e` | 0-byte files and tests, `AgentRun`/`AgentStep`/`AgentRunRepository`/`WorkflowFile` (enums kept), `.agent-tests/`, `scripts/agent-worker.acceptance.cjs`, unused npm deps, mapstruct (dependency, property and the compiler plugin block that only held its processor), `reconcileLegacy` + mocks + the `db:reconcile-inbox` script and its 9 integration cases (the script would otherwise break), BOT_DB_*/OPENAI/ANTHROPIC/GEMINI keys (grep: 0 readers) | Xong |
| 2 security/config | `287f127` | G1, G9, G10, G12 + `docs/architecture/deployment-exposure.md` | Xong |
| 3 workflow | `06392c6` | G2, G3, G11, P4/G8 (V16), alert-firing purge, P9, D1 doc | Xong |
| 4 identity/workspace | `bf45e26` | G4, P3, P5 | Xong |
| 5 idle backoff | `ba7fd94` + fix commit | identity/workspace/workflow pollers + notification worker | Xong |
| 6 notification/ai | `51f7f91` | G7, N6, M4, G5, G6, M6c, N2 (+ gateway `beforeId`) | Xong |
| 7 contracts/tests | `89f6b16` | `node-capabilities` contract, Admission/FixedWindowLimiter/prisma.repository specs, sweeper cooldown tests | Xong |

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| G2: explicit `taskScheduler` bean (`ThreadPoolTaskScheduler`, `weav.workflow.scheduling.pool-size` ← `WORKFLOW_SCHEDULER_POOL_SIZE`) | Boot backs off its TaskScheduler when a `ScheduledExecutorService` bean exists; test asserts jobs run on `workflow-scheduling-*` | Rename timer bean | Replaces the dead `spring.task.scheduling.pool.size` line |
| G3 counts QUEUED, RUNNING **and WAITING** | `WAITING` is an active execution state (V13 active index, `ExecutionStateAdapter`); otherwise retrying runs escape the cap | QUEUED+RUNNING only | Idempotent replays are checked before the cap, so they still succeed at the limit |
| Purge `outbox_events` probe adds `aggregate_type = 'WORKFLOW_EXECUTION'` | `idx_outbox_aggregate` leads with `aggregate_type`; every outbox row uses that type | New index | none |
| Alert-firing purge keeps newest per (rule, workflow) **and** firings of still-active runs | cooldown reads the newest; per-run uniqueness stops the live sweeper re-firing a still-running run | keep newest only | `WORKFLOW_ALERT_FIRING_RETENTION_DAYS` (30) |
| P3 reuses `next_attempt_at` as the lease (identity pattern) | workspace table already has it; no migration | new lease column | at-least-once unchanged; integration test proves no row lock during the confirm wait |
| P5 uses driver-side timeouts (`socketTimeout`, JdbcTemplate/JPA query timeout), **not** `options=-c statement_timeout` | PgBouncer-style poolers (Neon pooled endpoint) can reject unknown startup parameters, which would stop the services from connecting | JDBC `options` / `SET` in init SQL (unsafe under transaction pooling) | Purge statements are ≤1000 rows and indexed, far below 15 s; a timeout only fails that step (G11) and the next run retries |
| Idle backoff = skip ticks until the doubled delay elapses, wake on local commit | keeps `@Scheduled` fixed delays; manual runs and notifications are not delayed by the backoff because writers raise an after-commit wake | dynamic trigger rescheduling | Other instances still back off; a schedule due during an idle stretch can start up to `WORKFLOW_SCHEDULE_SCANNER_IDLE_MAX_DELAY` (30 s) late |
| G10 uses the existing `system_role=ADMIN` claim | same check as identity admin routes | 404 in production | external anonymous monitors of `/ready/upstreams` stop working |
| G12 caps: workflow 8 MiB, identity/notifications/workspace 1 MiB, assistant 64 KiB (unchanged) | workflow definitions ≤1 MiB, execution pages ≤100 items with 8 KiB strings | single cap | over-cap → 502 BAD_GATEWAY |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- api-gateway: G1 production guard; G10 admin-only upstream readiness; G12 `src/common/read-capped.ts`; assistant list forwards `beforeId`; 6 pre-existing lint problems fixed in touched files.
- workflow-service: scheduler pool, manual cap (`MANUAL_RUN_LIMIT_EXCEEDED`, 429), purge isolation and alert-firing purge, publisher poll try/catch, long-running sweep early return, idle backoff + wake for both outboxes and the schedule/Gmail scans, Telegram D1 comment.
- identity-service: `NotificationOutboxRetentionPurgeJob`, idle backoff + wake for the outbox publisher, timeouts.
- workspace-service: `show-details=never`, claim/publish/settle publisher, idle backoff + wake, timeouts.
- notification-service: `ApiErrorFilter` 413/429/4xx codes + 5xx logging (also honours Fastify's numeric `statusCode`), worker/consumer error logs, prefetch, worker idle backoff + drain (≤50 rows per tick) + wake after ack, `RetentionPurger`.
- ai-service: quota refund + user-message rollback on provider-unavailable/timeout/abort before any delta, `CircuitBreakerChatProvider`, correlation/request ids in failure logs, batched purge (500), keyset `(updatedAt, id)` cursor via optional `beforeId`.

### 7.2. Dữ liệu, schema và migration

- workflow `V16__purge_and_lookup_indexes.sql`: 9 additive `CREATE INDEX IF NOT EXISTS` (plain, not CONCURRENTLY; tables are small).
- notification Prisma `202610120001_retention_indexes`: `notification_deliveries(status, created_at)`, `notification_inbox(created_at)`. **Applied manually by the owner on Neon** (as for the earlier notification migrations).
- No drops, renames or new columns.

### 7.3. Cấu hình — new env vars (all in `.env.example` and `compose.dev.yml`)

| Var | Default | Service |
| --- | --- | --- |
| `WORKFLOW_MANUAL_ACTIVE_RUN_LIMIT` | 10 | workflow |
| `WORKFLOW_ALERT_FIRING_RETENTION_DAYS` | 30 | workflow |
| `WORKFLOW_POLLER_IDLE_MAX_DELAY` | PT30S | workflow (both outboxes) |
| `WORKFLOW_SCHEDULE_SCANNER_IDLE_MAX_DELAY` | PT30S | workflow |
| `IDENTITY_OUTBOX_RETENTION_DAYS` | 14 | identity |
| `IDENTITY_NOTIFICATION_OUTBOX_IDLE_MAX_DELAY` | PT30S | identity |
| `WORKSPACE_NOTIFICATION_OUTBOX_IDLE_MAX_DELAY` | PT30S | workspace |
| `DB_SOCKET_TIMEOUT_SECONDS` | 30 | identity, workspace, workflow |
| `DB_STATEMENT_TIMEOUT_MS` | 15000 | identity, workspace, workflow |
| `NOTIFICATION_WORKER_IDLE_MAX_MS` | 30000 | notification |
| `NOTIFICATION_CONSUMER_PREFETCH` | 5 | notification |
| `NOTIFICATION_RETENTION_DAYS` | 90 (0 disables) | notification |
| `WORKFLOW_MAINTENANCE_IDLE_MAX_DELAY` | PT10M | workflow (recovery scanner, long-running sweep; session 2) |

`WORKFLOW_SCHEDULER_POOL_SIZE` (existing) now actually sizes the scheduler. `WORKFLOW_EXECUTION_RETENTION_DAYS` stays 0 in code; set 30 in env.

## 9. Kiểm tra và bằng chứng

Final numbers: see section 9.1 (filled after the last run).

### 9.1. Commands and results

| Hạng mục | Lệnh | Kết quả thực tế | Phạm vi |
| --- | --- | --- | --- |
| identity verify | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC mvn -B verify` (JDK 25, Maven 3.9.16) | 390 tests, 3 errors = MinIO image pull (known env-only) | final Java code except the IdleBackoff bound fix (unit-tested separately: `IdleBackoffTest` 6/6) |
| workspace verify | same | all pass (exit 0) | same as above |
| workflow verify | same | 1122 tests, 2 errors = `HttpTransportIntegrationTest` TLS cert (known env-only); the notification-bridge test passes because `notification-service/dist` was built | final tree |
| api-gateway | `pnpm --dir services/api-gateway build / test / test:e2e`, `exec eslint "{src,test}/**/*.ts"` | build OK, 170 unit, 151 e2e, lint 0 problems (baseline 6) | |
| notification-service | build / test / test:e2e / eslint | build OK, 190 unit, 19 e2e, lint 51 (= baseline, same per file) | |
| notification real infra | `test:inbox-integration`, `node --test test/migration.integration.cjs test/runtime.integration.cjs test/poison.integration.cjs` with throwaway Postgres 16 (15439) and RabbitMQ latest (15689) | inbox 24/24 (incl. new retention case), migration 1/1, runtime + poison 7/7 | containers removed afterwards |
| ai-service | build / test / test:e2e / eslint | build OK, 245 unit, 84 e2e, lint 148 (= baseline, same per file) | |
| ai real infra | `test:integration` with throwaway Postgres 16 (55433) | 15/15 (keyset, deleteMessage, refundUsage) | container removed |
| compose | `docker compose -f compose.yml -f compose.dev.yml --profile app config -q` | exit 0 (only unset-secret warnings) | |
| diff | `git diff --check` before every commit; GitNexus `detect-changes --scope staged` | clean; risk low/medium except batch 3 HIGH (see section 10) | |

Regression found and fixed in this session: batch 5 first broke workflow context loading (tests set publisher poll intervals to 1 h, above the backoff ceiling) and `WorkflowV1AcceptanceTest` (direct `scan()` calls were gated). Fixed by allowing base > ceiling and moving the gate to `scanOnSchedule()`/`scanGmailOnSchedule()`; the follow-up commit is on the branch.

### Điều chưa được kiểm tra

- Live Compose stack against Neon, real Rabbit confirms with Neon latency, Playwright (no `.env`/secrets here).
- `prisma migrate deploy` / Flyway V16 on Neon (owner applies; Flyway runs on service start).
- Neon pooled endpoint behaviour with the new `socketTimeout`/query timeout (driver-side; expected to work, not observed).
- Idle backoff effect on Neon compute suspension (needs a live stack; the 30 s outbox/scanner caps still keep compute awake, see section 12).

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Cách xử lý hiện tại | Bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | GitNexus `detect-changes` rated batch 3 HIGH (10 processes: admission, publication, purge) | targeted suites + full workflow verify green | owner live smoke: manual run, publish, schedule |
| Trung bình | Notification retention deletes data 60 s after boot (default 90 days) | real-Postgres integration case; `NOTIFICATION_RETENTION_DAYS=0` disables | owner decides before deploy |
| Thấp | `/ready/upstreams` now needs an ADMIN token | documented | update any external monitor |
| Thấp | Production gateway must set `GATEWAY_TRUST_PROXY_HOPS=1` (compose default stays 0 for dev) | fail-fast message names the var | set in prod env |
| Thấp | Lint was red on `dev` (ai 148, notification 51) | fixed in session 2, CI lint now blocking | none |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Owner: pull `fix/backend-review-2026-10`, apply the notification Prisma migration on Neon, start the stack, smoke manual run / schedule / notifications, then `git merge --no-ff` into `dev`.
2. Web/mobile: send `beforeId=<last conversation id>` with `before` when paging assistant conversations.

### Follow-ups (not done, out of scope)

- Drop unused tables/indexes (`agent_runs`, `agent_steps`, `files`, `idx_workflow_triggers_endpoint`, `idx_workflow_triggers_status_type`).
- Identity outbox FAILED state (status migration).
- Move Telegram `setWebhook` after commit (D1).
- Remove HS256 token acceptance.
- DLQ consumer and alerting.
- Placeholder folders (`packages/shared`, `infrastructure/`, `examples/`, `tests/`, `docs/handoff` vs `docs/handoffs`, `bot-service.md`).
- Scale-to-zero: outbox/scanner idle caps (PT30S) still keep Neon awake; see section 12 for options. Schedule scanner "sleep until next due" is a follow-up.
- Identity `notification_outbox` has no `published_at` index (workspace has one); fine at current size.

## 12. Session 2 (2026-10-12): follow-ups 1 and 2, PR

- **Maintenance pollers** (`85759da`): `ExecutionRecoveryScanner` (30 s) and `LongRunningAlertSweeper` (60 s) back off up to `WORKFLOW_MAINTENANCE_IDLE_MAX_DELAY` (default PT10M) while no run is QUEUED/RUNNING/WAITING (`ExecutionRecoveryPort.hasActiveExecutions`, a cheap `EXISTS`), stay at the base interval while runs are active, and wake via `ActivitySignal` after a local admission commits. Direct `scanNow()`/`sweepNow()` stay ungated.
- **Compose healthchecks** (`f0c7132`): found while checking what else keeps Neon awake. Identity/workspace/workflow probed `/actuator/health/readiness` (includes the db indicator) and notification probed `/ready` (Prisma count) every 15 s, so Neon could never suspend. Switched to liveness (`/actuator/health/liveness`, `/health`). Spring liveness needs a completed startup (Flyway hit the DB), so `depends_on` ordering is kept; notification `/health` no longer reflects DB reachability. SETUP.md gateway `/ready` paragraph corrected (it no longer probes upstreams).
- **Remaining scale-to-zero gap (not changed, owner decision):** the outbox publishers and the schedule/Gmail scans still cap at PT30S, as specified for batch 5. Neon suspends only after ~5 idle minutes, so those still keep compute awake while the stack runs. Options: raise `WORKFLOW_POLLER_IDLE_MAX_DELAY`, `IDENTITY_/WORKSPACE_NOTIFICATION_OUTBOX_IDLE_MAX_DELAY` and `NOTIFICATION_WORKER_IDLE_MAX_MS` to ≥ 6 min (local writes still wake them at once; only cross-instance writes and broker retries wait longer), and make the schedule scanner sleep until the next `next_run_at` instead of a fixed cap (follow-up).
- **Lint cleanup**: `eslint --fix` (formatting, redundant assertions) plus hand fixes in ai-service and notification-service so `pnpm exec eslint "{src,test}/**/*.ts"` is 0 in all three Node services; CI lint made blocking (`continue-on-error` removed).
- **PR** opened to `dev` at the owner's request (the team normally merges with `--no-ff`; the owner still verifies locally before merging).

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Trạng thái worktree | sạch after the final commit |
| Commit/PR đã tạo | 7 batch commits + this log, pushed to `origin/fix/backend-review-2026-10`; no PR, no merge |
| Người cập nhật log | AI agent (Claude Code) |
| Cần đọc trước khi tiếp tục | sections 6, 7.3, 10, 11 |

## 14. Session 3 (2026-10-16): live verification of the merged review (Phase A)

Run locally against Neon `dev-k` (`br-steep-wildflower-b3hl2xdq`) on `dev` @ `7eb35e59` (contains merge `b673136`).

| Step | Result | Evidence |
| --- | --- | --- |
| Pre-flight | PASS | `b673136` is an ancestor of HEAD, tree clean, `.env` has every `.env.example` key except `WORKFLOW_MAINTENANCE_IDLE_MAX_DELAY` (PT10M default). GitNexus refreshed. |
| **`.env` pointed at production** | FIXED | All `*_DB_HOST` and both `*_MIGRATION_URL` pointed at the `production` compute, not dev-k. The first `db:migrate` hit production and was a no-op ("No pending migrations", already applied there). Hosts and the shared role password were repointed to dev-k (owner approved; password not printed). |
| Notification migration `202610120001_retention_indexes` | PASS on dev-k | Applied via `NOTIFICATION_MIGRATION_URL` (owner approved). |
| Stack (7 services, no OCR) | PASS | All healthy; 0 `ERROR`/exceptions in any log; Flyway workflow 15 -> 16 (0.8 s); notification `RetentionPurger` ran (0 rows deleted, 90 d); thread dump shows `workflow-scheduling-1..4` plus the idle `workflow-execution-timer`. |
| Smoke (headless Playwright script `tmp/smoke/phase-a.mjs`, real UI + gateway API) | PASS | login 0 console errors; manual run SUCCESS + execution detail; 14 parallel runs -> 10 accepted, 4 x 429 `MANUAL_RUN_LIMIT_EXCEEDED`; publish -> pause -> resume; schedule due 05:00:00Z fired at 05:00:12.7 s (earlier run 8.3 s) while idle; assistant answered a prompt; execution/monitoring pages 0 failed calls. One transient 401 on assistant list recovered through the refresh retry. |
| Invitation | PASS (path), deviation | qa2 invite returned 409 `USER_EXISTS` (qa2 is already a member). The subagent invited `nhoangkhai195+smokeinv1@gmail.com` (owner's mailbox alias) instead; workspace outbox row published in 1.1 s, EMAIL delivery `SENT`. Identity outbox: no new event (no signup in this run), not exercised live. Left behind: workspace `smoke-ws-*` (7b99e4c5-...) with invitation ab9b815d-... (PENDING). |
| Merge review (Sonnet, read-only) | 1 HIGH, 4 MED, LOW | See below. No test or build was run by the reviewer. |
| Idle measurement (10.8 min, 05:03:00-05:13:50 UTC) | Scans fell ~90% but compute stayed `active` | see table below |

### Idle scan rates (dev-k, idle stack, per minute)

Baseline 2026-10-12 was ~60/min per polled table (1 s polling; counters 88k-90k seq scans per table).

| Table (scan type) | Delta in 10.8 min | Per minute |
| --- | --- | --- |
| workflow.workflow_triggers (seq) | +43 | 4.0 |
| workflow.outbox_events (seq) | +44 | 4.1 |
| workflow.notification_outbox (idx) | +78 | 7.2 |
| notification.notification_deliveries (seq) | +63 | 5.8 |
| identity.avatar_cleanup (seq) | +22 | 2.0 |
| identity.notification_outbox (idx) | +22 | 2.0 |
| workspace.notification_outbox (idx) | +53 | 4.9 |

`list_branch_computes` after the window: `current_state: active`, `last_active` 05:10:46Z. Every poller still wakes every ~30 s, so Neon cannot reach its ~5 min suspend timer. Baselines are in `tmp/pgstat-baseline-2026-10-16.txt`.

### Review findings (merge b673136)

- F1 HIGH: schedule scanner backs off even while ACTIVE schedule/Gmail triggers exist; a due slot can start up to ~30 s late; a new Gmail trigger waits too (Phase B1 fixes with sleep-until-next-due + wake on publish).
- F2 MED: notification prefetch 5 > Prisma pool 3 per client (P2028 under burst) -> Phase B.
- F3 MED (owner decision): manual cap counts every active run (any trigger type, incl. WAITING), not only manual ones.
- F4 MED (owner decision): notification retention (default 90 d) deletes unread inbox rows and wakes Neon hourly.
- F5 MED: workflow execution purge batch of 1000 can livelock under the 15 s query timeout (only when `WORKFLOW_EXECUTION_RETENTION_DAYS` > 0) -> Phase B fix.
- F6-F11 LOW: cross-instance recovery up to 10 min; assistant rollback leaves an empty conversation; AI_TIMEOUT never trips the breaker; workspace publisher counts attempts at settle; openapi lacks the 429; notification README mentions the removed `db:reconcile-inbox`; gateway 1 MiB workspace cap.

### Periodic DB touch audit (Sonnet, read-only)

Wake Neon while idle: identity/workspace/workflow outbox publishers (30 s cap), schedule + Gmail scanner (30 s cap, no wake on publish), notification delivery worker (30 s cap), identity `AvatarCleanupReconciler` (fixed 30 s, no backoff), and the Dockerfile `HEALTHCHECK`s (identity/workspace/workflow `readiness`, notification `/ready`, 15 s; compose overrides them in dev). OK: Hikari (no keepalive, min-idle 0, idle 60 s), pg pools (idle close 10 s), purges (1 h), ai-service/gateway (no DB timers), `OutboxMetrics` gauges (only on scrape, cached 30 s, no scraper in repo). All services share one compute, so independent PT10M timers at different phases would still leave <5 min gaps; Phase B aligns idle wake-ups to wall-clock boundaries.

## 15. Session 3 (2026-10-16): Neon scale-to-zero and review leftovers (Phase B + C)

Branch `feature/neon-suspend-and-leftovers` from `dev` @ `7eb35e59`, one commit per batch, each diff reviewed by a second Sonnet agent before commit.

### 15.1. Design

All services share ONE Neon compute that suspends after ~5 idle minutes, so independent per-service timers (even at PT10M) would never leave a 5 min gap. `IdleBackoff` (3 copies: workflow, identity, workspace) and the notification `DeliveryWorker` now: ramp 1,2,4..32 s on empty polls, then sleep until `min(earliest known due row, aligned wake)`. Aligned wake = first wall-clock multiple of the cap (epoch ms) that is >= now + cap/2, plus a per-process jitter <= 2 s, so every service wakes in one cluster per cap. Local after-commit signals wake a poller immediately. `recordError()` (workflow) retries from the base interval so a Neon cold-start failure never costs a full aligned sleep. Multi-instance caveat: a write on another instance only wakes this one at its due time or the aligned wake.

### 15.2. Commits

| Batch | Commit |
| --- | --- |
| notification-service (worker sleep-until-due, prefetch 3 + ingest tx timeout, healthcheck, README) | `49718821` |
| gateway (G13 connection-action rate limit, D5 shared proxy helper, D3 access log) | `c3f4c501` |
| ai-service daily limit 0 = unlimited, web `beforeId` paging, contracts 429, mobile handoff note | `40756965` |
| identity + workspace (aligned backoff, avatar reconciler, Flyway V9 index, healthchecks) | `f5d0feac` |
| identity + workspace last-success gauge | `3cacd525` |
| workflow (B1 scanner/outbox sleep-until-due, B11 batch publish, F5 purge batch 100, B6/B9/B10/D8, gauge) | `963a4c8f` |
| env vars, `outputTruncated` contract + web type, work log | `ab8379ff` |

B3 (monitoring queries): EXPLAIN on dev-k (read-only) gives Hash Join over Seq Scan at ~137 executions / 150 workflows (3.6 ms / 0.7 ms); the existing `idx_workflows_workspace_active` and `idx_workflow_executions_workflow_created` already serve the workspace + time filter, a direct workspace+time index would need a denormalised `workspace_id`, so no migration was added.

### 15.3. Env vars

Changed to `PT10M`: `WORKFLOW_POLLER_IDLE_MAX_DELAY`, `IDENTITY_NOTIFICATION_OUTBOX_IDLE_MAX_DELAY`, `WORKSPACE_NOTIFICATION_OUTBOX_IDLE_MAX_DELAY`. `NOTIFICATION_WORKER_IDLE_MAX_MS` 600000. `NOTIFICATION_CONSUMER_PREFETCH` 3. New: `WORKFLOW_SCHEDULE_SCANNER_MAX_SLEEP` (PT10M, replaces `..._IDLE_MAX_DELAY`), `AVATAR_S3_CLEANUP_IDLE_MAX_DELAY` (PT10M), `GATEWAY_CONNECTION_ACTION_RATE_LIMIT` (10), `WORKFLOW_EXECUTION_DETAIL_OUTPUT_MAX_BYTES` (262144). `AI_ASSISTANT_DAILY_*_LIMIT=0` means unlimited. All in `.env.example`, `compose.dev.yml` and the local `.env`. Migrations: identity Flyway `V9__notification_outbox_published_index` (additive); workflow V16 and Prisma `202610120001` were applied in Phase A.

### 15.4. Verification

| Check | Result |
| --- | --- |
| workflow `mvnw verify` | 1161 tests, 0 failures/errors (incl. the TLS and bridge tests that were env-only before) |
| workspace `mvnw verify` | 540 tests green |
| identity `mvnw verify` | 409 tests, 3 errors = known MinIO image pull |
| notification / gateway / ai | build, unit, e2e green; eslint 0 problems; notification integration 8/8 against real Postgres + RabbitMQ |
| Live smoke (new code, dev-k) | login, manual run SUCCESS, publish/pause/resume, schedule fired +1.8 s, 300 KB output -> `OUTPUT_TRUNCATED` + `outputTruncated: true`, connection-test bucket 10 x 404 then 429 `Retry-After: 60`, assistant `before`+`beforeId` page 200, workspace create/delete, monitoring pages 0 failed calls |
| Neon suspend | compute `suspended` 10:06:47Z (~7 min after last activity), woke at the aligned cluster 10:10:13Z, 0 error/warn lines in all 6 service logs |
| Idle scans (14 min, 09:59-10:13Z) | workflow_triggers seq +4 (0.3/min), outbox_events seq +6, notification_deliveries seq +10 (0.7/min), avatar_cleanup seq +4; was ~60/min at 1 Hz and 2-7/min after the merge |
| Cold wake | from a compute suspended at 10:57:47Z: manual run 202 in 2.5 s, SUCCESS in 6.7 s; schedule published 10:58:07Z fired at 11:00:00.99Z; 0 error lines |

Burst caveat: in the Phase C run a 14-request burst gave 12 x 202 + 2 x 429 (instant runs freed slots); the exact limit of 10 was shown in Phase A (10 x 202, 4 x 429).

### 15.5. Open items for the owner

- F3: the manual-run cap counts every active run (any trigger type, incl. WAITING); decide whether it should count manual runs only.
- F4: `NOTIFICATION_RETENTION_DAYS` default 90 deletes unread inbox rows and wakes Neon hourly.
- `.env` pointed at the production Neon branch before this session; it now targets dev-k (host + password).
- `NotificationProxyTransport` logged one ERROR with no matching access-log line (likely an aborted notification stream when the page navigated); not investigated.
- A first `GET /assistant/conversations` sometimes returns 401 and recovers through the refresh retry (seen in Phase A and C).
- Heavy request bursts from one user hit the gateway general rate limit and the web app logs out on a 429 from `/api/auth/me`.

### 15.6. Owner decisions applied (2026-10-16, branch `feature/manual-cap-retention-429` from `dev` @ `956b82ba`)

| Item | Change | Commit |
| --- | --- | --- |
| F4 | `NOTIFICATION_RETENTION_DAYS` default 0 (purge off) in code, `.env.example`, `compose.dev.yml`, local `.env`; settings test covers default 0 and explicit 90 | `c820a5be` |
| Web 429 | `MANUAL_RUN_LIMIT_EXCEEDED` shows "This workflow already has too many runs in progress..." (vi + en) instead of the generic rate-limit text; Playwright case in `workflow-api-v1.spec.ts` (5/5 pass, stubbed backend) | `832dcebe` |
| F3 | manual cap counts only `trigger_type = MANUAL` (QUEUED/RUNNING/WAITING); `ManualRunLimitTest.activeAutomaticRunsDoNotBlockAManualRun` (10 active SCHEDULE/WEBHOOK rows, cap 2, manual run admitted); openapi, `.env.example`, mobile handoff wording | see git log |

GitNexus: `requireManualCapacity` (private) is not in the index; the adapter class is CRITICAL (central repository), the edit only narrows one private query with one caller. `detect_changes` flagged web `requestOnce` CRITICAL (shared request path); the new branch only fires on 429 + that code. Not checked live against the running stack (stack down).

2026-10-17: the "web logs out on a 429 from `/api/auth/me`" item is fixed (`c4cccc1a`, merge `ba2ce8f3`): boot logs out only on 401; 429/5xx/network keep the session and retry `/me` once after 5 s (Playwright `session-management` 41/41 with related specs). Partner's `fix/gateway-public-auth-bearer` reviewed and merged (`5ecdf728`): public Identity routes drop a stale Bearer, an empty Identity 401 is relayed as 401 instead of 502; Identity `/logout` reads only the body refresh token, so nothing lost. Gateway unit 192/192, e2e 162/162, build + eslint clean. Pre-existing on `dev` after the UI redesign (not caused by these): 7 stale Playwright cases in `dashboard-real-data.spec.ts` and `localization.spec.ts` assert the old dashboard/login copy.

### 15.7. Follow-ups (not done)

Drop unused tables/indexes; identity outbox FAILED state; Telegram `setWebhook` after commit; remove HS256; DLQ consumer; CHECK constraints on status columns; placeholder folders; pruning `tmp/`; execution outbox row whose execution is gone retries every 60 s forever and keeps Neon awake; workspace publisher counts attempts at settle; assistant rollback leaves an empty conversation; `AI_TIMEOUT` never trips the circuit breaker; gateway 1 MiB cap on Workspace responses; cross-instance recovery up to 10 min; three copy-pasted `IdleBackoff` classes; mobile handoff (`docs/handoff/2026-10-week7-mobile.md`) for `beforeId` and the 429 message.
