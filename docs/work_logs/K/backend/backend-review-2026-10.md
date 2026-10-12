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
- Idle backoff effect on Neon compute suspension (needs a live stack; the alert sweeper (60 s) and recovery scanner (30 s) still poll and keep compute awake, see follow-ups).

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Cách xử lý hiện tại | Bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | GitNexus `detect-changes` rated batch 3 HIGH (10 processes: admission, publication, purge) | targeted suites + full workflow verify green | owner live smoke: manual run, publish, schedule |
| Trung bình | Notification retention deletes data 60 s after boot (default 90 days) | real-Postgres integration case; `NOTIFICATION_RETENTION_DAYS=0` disables | owner decides before deploy |
| Thấp | `/ready/upstreams` now needs an ADMIN token | documented | update any external monitor |
| Thấp | Production gateway must set `GATEWAY_TRUST_PROXY_HOPS=1` (compose default stays 0 for dev) | fail-fast message names the var | set in prod env |
| Thấp | Lint baseline still red (api-gateway now 0; ai 148, notification 51, unchanged per file) | no new problems | separate lint cleanup |

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
- Scale-to-zero: `LongRunningAlertSweeper` (60 s) and `ExecutionRecoveryScanner` (30 s) still query every tick; Neon's 5-minute suspend needs them backed off too.
- Pre-existing lint debt in ai-service (148) and notification-service (51).
- Identity `notification_outbox` has no `published_at` index (workspace has one); fine at current size.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Trạng thái worktree | sạch after the final commit |
| Commit/PR đã tạo | 7 batch commits + this log, pushed to `origin/fix/backend-review-2026-10`; no PR, no merge |
| Người cập nhật log | AI agent (Claude Code) |
| Cần đọc trước khi tiếp tục | sections 6, 7.3, 10, 11 |
