# Workflow Service V1 detailed record — triggers and readiness

> Historical task notes recovered from commit 18b6dfa. The source records below retain their original decisions, file inventories, test commands, and handoff details. Their test counts are milestone snapshots; the final integrated release evidence is in workflow-service-v1.md.

Source notes are grouped here to keep the K folder navigable while retaining implementation detail.

---

### Source record: 2026-09-23-workflow-service-task-16.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / chưa commit |
| Người thực hiện | Codex GPT-6 Luna MAX worker |
| Người review / nhận bàn giao | `/root` |
| Trạng thái cuối session | `Hoàn tất implementation và kiểm tra tập trung`; shared OpenAPI projection remains with root |
| Phạm vi session | Cron/timezone validation, durable schedule scanner and admission, pause/resume/republish behavior, and Telegram readiness detail projection. |
| Liên kết liên quan | Workflow Service V1 spec and Task 16 implementation plan |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Schedule publication now validates six-field Spring cron and an explicit IANA timezone. Schedule registrations start with their first future instant; Telegram registrations persist disabled with a fixed dependency reason; webhook publication remains closed.
- A bounded Spring scanner admits one recorded due slot per trigger, coalesces downtime, retries transient failures without losing the slot, and advances trigger state in the same transaction as execution/outbox admission. Workflow then trigger row locks match Task 8's order.
- Workflow GET now projects safe trigger readiness and schedule timestamps. A real-PostgreSQL/Rabbit integration test verifies concurrent scans admit one slot and the worker finishes it successfully.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Compile | `PASS` | Focused Maven selectors compiled 146 production and 52 test sources. |
| Unit / integration test | `PASS` | Peer combined Task 15/API_KEY + Task 16 selector passed 50 tests, including real PostgreSQL/Rabbit schedule execution. |
| Migration / database | `PASS` | No migration added; Task 16 uses V3 schedule/execution columns and the existing `(trigger_id, scheduled_at)` unique index. Testcontainers applied V1–V3. |
| Review thay đổi | `Đã kiểm tra` | Owned diff and `git diff --check`; GitNexus impact remained `UNKNOWN`, corroborated manually. |
| Commit / PR | `Chưa tạo` | No stage/commit/push. |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Validate explicit cron/timezone and calculate deterministic future schedule instants, including DST.
2. Deliver durable bounded schedule admission with multi-instance safety, downtime coalescing, and atomic slot advancement.
3. Preserve fail-closed webhook behavior and expose disabled Telegram readiness in workflow detail.

##### Trong phạm vi

- Workflow Service scheduling, publication, trigger persistence, detail projection, tests, scanner config, README, and Task 16 handoff files.

##### Ngoài phạm vi / chủ động chưa làm

- No Task 17 webhook implementation, schema migration, code staging, commit, or push.
- Did not edit the shared Workflow OpenAPI contract while awaiting root's direction; GET detail runtime fields are implemented.

##### Tiêu chí hoàn thành

- [x] Six-field cron and IANA timezone validation; JVM timezone independence and explicit DST policy.
- [x] Atomic bounded scheduled admission, concurrent scanner deduplication, rollback/retry, pause/resume/republish, and broker/worker SUCCESS coverage.
- [x] Combined Task 15/API_KEY + Task 16 Maven verification returned by the peer: 50 tests passed.
- [ ] Root-owned OpenAPI contract includes the additive trigger detail projection.
- [x] Work log and Task 16 scratch report prepared; no commit.

#### 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Task 8 already admits automatic executions and atomically stores execution, pending node rows, and outbox intent. It locks the workflow row before the trigger row and has a unique scheduled-slot index.
- **Giả định đã dùng:** DST gaps skip nonexistent wall times; a repeated wall time fires once at the earlier offset. This makes each local cron slot deterministic and is covered by tests.
- **Ràng buộc:** Do not edit Task 15 executor registry/HTTP code; do not edit the shared OpenAPI contract before coordinating with root; root owns the global plan/progress ledger and acceptance.
- **Nguồn sự thật:** `docs/superpowers/specs/workflow-service-spec.md`, `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` Task 16, Task 6/8/10/11 reports, and current service source.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — 2026-09-23

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Before 12:26 | Reviewed Task 16 plan, existing admission lock order, and GitNexus impact | Impact returned `UNKNOWN` due index/runtime version mismatch; source callers and lock order were manually corroborated. | Xong |
| Before 12:26 | Implemented cron validation, schedule publication, scanner, retry handling, lifecycle transitions, and GET detail projection | Added DST, publication, HTTP readiness, concurrent PostgreSQL, rollback, pause/resume/republish, and Rabbit worker coverage. | Xong |
| 12:26 | Ran focused Maven selectors | 5 schedule semantics, 13 publication unit, 4 publication HTTP, and 3 schedule integration tests passed. | Xong |
| 12:36 | Coordinated serialized build slot | Peer combined Task 15/API_KEY + Task 16 selector passed: 50 tests, 0 failures/errors/skips. | Xong |

##### Diễn giải quan trọng

Each scheduled candidate is processed by a separate transactional service call. It locks the workflow, then trigger, rechecks published/current/active state, calls Task 8 automatic admission, and advances the stored slot before commit. On any runtime failure, that transaction rolls back; a separate transaction records only a fixed failure code and retry instant while retaining the due slot.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Skip DST gaps; choose earlier offset for overlaps | Explicit IANA-zone conversion and tests make each wall-clock cron occurrence deterministic. | Rely on JVM timezone or fire both overlap offsets. | Documented in service README; no default timezone dependency. |
| Process one trigger per independent transaction | One transient failure must roll back its scheduled slot and admission without rolling back other registrations. | Batch-wide transaction. | Bounded scans continue after a per-trigger failure. |
| Keep transient failure retry metadata in `last_error` | Existing schema already has JSONB error state; retry time stays durable without migration, and `next_run_at` remains the slot being retried. | Advance slot on failure or add a migration. | Fixed `SCHEDULE_ADMISSION_FAILED` code plus `retryAt`; no raw exception/provider message. |
| Extend GET detail with safe `triggers[]` projection | Task 15 acceptance requires persisted Telegram readiness visible after publish. | Return readiness only in publish response. | Runtime endpoint has additive fields; OpenAPI change awaits root. |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `SpringScheduleValidation` parses six-field cron and valid IANA zones, resolves next instants without JVM-default timezone, skips gaps, and selects the earlier offset during overlaps.
- `WorkflowPublicationService` injects the validator, initializes active schedule registrations, keeps paused schedules disabled, disables Telegram with `DEPENDENCY_NOT_CONFIGURED`, and keeps webhook publication fail-closed.
- `WorkflowTriggerAdapter`, `WorkflowTriggerPort`, `WorkflowRepository`, and `WorkflowRepositoryAdapter` add bounded due-candidate selection, workflow/trigger lock support, schedule slot updates, and safe failure retry persistence.
- `ScheduleTriggerService`, `ScheduleTriggerProcessor`, and `WorkflowScheduleScanner` add the bounded durable scan and atomic admission path. Pause/resume and republish compute future schedule slots under the workflow lock.
- `WorkflowController` and `WorkflowResponse` add safe trigger status/reason/timing fields on GET detail; no trigger config, webhook secret, or raw error message is returned.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Existing Workflow schema and `workflow_triggers`, `workflow_executions`, and `outbox_events`.
- **Migration:** None. Existing V3 `next_run_at`, `last_triggered_at`, `scheduled_at`, and unique scheduled-slot index are reused.
- **Tính tương thích:** Trigger detail is additive. Paused schedules discard stale slots and compute a future slot on resume.

##### 7.3. Cấu hình, hạ tầng và dependency

- `weav.workflow.schedule.scanner.enabled`, `batch-size`, `poll-interval-ms`, `initial-delay-ms`, and `failure-backoff-ms` configure scanning. Defaults enable scanning with batch 100, 1000 ms polling, and 30000 ms retry backoff. Tests disable automatic scanning and invoke it with a fixed instant.
- Added `services/workflow-service/README.md` with schedule/DST/downtime behavior and configuration notes.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** GET `/workspaces/{workspaceId}/workflows/{workflowId}` adds `triggers[]` entries with trigger ID/type/status, fixed `reasonCode`, and schedule timestamps.
- **Security:** GET retains its existing authenticated workspace authorization; only safe, server-owned fields are projected.
- **Validation/error response:** Invalid cron/timezone is a node-scoped publish validation error. Webhook provider unavailability remains 503. Telegram registration is persisted disabled with `DEPENDENCY_NOT_CONFIGURED`.
- **Logging:** Scanner failures log trigger ID and a fixed summary without raw exception details.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/scheduling/SpringScheduleValidation.java` | Cron/timezone validation and deterministic next instant. | Explicit DST behavior. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/scheduling/WorkflowScheduleScanner.java` | Bounded scheduled entry point. | Configurable and disableable per instance. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/trigger/ScheduleTriggerProcessor.java` | Transactional one-trigger admission and slot advancement. | Workflow lock before trigger lock. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/trigger/ScheduleTriggerService.java` | Bounded scan, isolated failures, durable retry. | No raw error diagnostics persisted. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowPublicationService.java` | Inject real validator, readiness-aware trigger registration, future resume slot. | Webhook remains closed. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkflowTriggerPort.java` | Candidate/query/lock/slot APIs. | Adapter and test wrapper updated. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/workflow/WorkflowTrigger.java` | Schedule state mutation helpers. | Existing constructor shape retained. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/port/out/WorkflowRepository.java` | Workflow-ID lock boundary. | Used to match admission lock order. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/repository/WorkflowRepositoryAdapter.java` | Pessimistic lock by workflow ID. | Schema-safe entity query. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/repository/WorkflowTriggerAdapter.java` | Due query, row lock, slot/retry updates, readiness pause/resume. | Native query qualifies configured schema and validates its identifier. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/mapper/WorkflowPersistenceMapper.java` | JSON node projection helper for fixed error metadata. | No raw diagnostics. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/WorkflowController.java` | GET reads current trigger projection after workflow authorization. | No secrets/config exposed. |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/response/WorkflowResponse.java` | Add safe trigger readiness/timing records. | Add matching OpenAPI schema after root direction. |
| `Sửa` | `services/workflow-service/src/main/resources/application.properties` | Production scanner defaults. | Environment-variable overrides. |
| `Sửa` | `services/workflow-service/src/test/resources/application.properties` | Disable background scanner in tests. | Tests invoke scans deterministically. |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/application/WorkflowPublicationTest.java` | Schedule and Telegram publication cases. | Webhook unavailable assertion retained. |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowPublicationHttpTest.java` | GET detail readiness acceptance. | Verifies Telegram DISABLED and safe reason. |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/WorkflowPublicationTestConfiguration.java` | Port wrapper delegation and scanner/failure test latches. | Test-only synchronization/injection. |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/scheduling/ScheduleTriggerTest.java` | Cron, timezone, and DST unit cases. | Five cases. |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/scheduling/ScheduleConcurrencyTest.java` | Real PostgreSQL/Rabbit scanner tests. | Concurrent dedup, atomic rollback/retry, lifecycle, worker SUCCESS. |
| `Thêm` | `services/workflow-service/README.md` | Scheduling operational policy and settings. | Documents coalescing and DST. |
| `Thêm` | `docs/work_logs/K/2026-09-23-workflow-service-task-16.md` | Task handoff log. | This file. |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-16-report.md` | Concise completion report. | Coordinator review. |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Cron/DST | `mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=ScheduleTriggerTest' test` with `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` | `PASS`, 5 tests. | Six fields, IANA rejection, explicit timezone, gap/overlap, impossible expression. |
| Publication and HTTP | Same wrapper with `-Dtest=WorkflowPublicationTest,WorkflowPublicationHttpTest` | `PASS`, 17 tests. | Unit and Testcontainers-backed HTTP behavior. |
| Real DB/broker scanner | Same wrapper with `-Dtest=ScheduleConcurrencyTest` | `PASS`, 3 tests. | PostgreSQL concurrent scanners, slot rollback/retry, lifecycle, Rabbit worker SUCCESS; deterministic latches. |
| Combined Task 15/16 | Peer-owned focused selector | `PASS`, 50 tests, 0 failures/errors/skips. | Includes Task 15/API_KEY and Task 16 focused cases; real PostgreSQL/Rabbit schedule cases passed. |
| Static/diff check | `git diff --check` on owned files | `PASS`; line-ending warnings only for properties files. | Full repository has unrelated shared changes. |

##### Điều chưa được kiểm tra

- Full Workflow suite after Task 15/16 has not been run by this worker; root previously reported 301/301 before those changes.
- Matching OpenAPI schema for the new GET detail field remains root-owned; the current contract diff was not changed by this worker.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact for existing symbols returned `UNKNOWN`. | Indexed storage version 43 did not match installed runtime 42; CLI fallback hit `EPERM realpath` on the user profile. | Confirmed callers and lock-order source manually; no HIGH/CRITICAL risk report was available. | Root owns index refresh and graph change detection. |
| Trung bình | Additive workflow trigger fields are not yet in OpenAPI. | The shared contract is part of the root's broader Workflow changes; no explicit ownership handoff was received. | Runtime projection and GET acceptance test are in place; this worker did not edit the shared contract. | Root to reconcile the schema before final contract acceptance. |
| Thấp | One focused test run initially failed on native SQL JSON `?` parsing and unqualified schema. | Hibernate treated `?` as a positional parameter and native SQL didn't inherit ORM default schema. | Replaced JSON existence operator with `->>` null check and qualified the configured validated schema. Final PostgreSQL tests pass. | None. |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Root owns full combined Workflow suite, global progress ledger, plan/acceptance updates, GitNexus refresh, shared OpenAPI schema reconciliation, and commit decision.

##### Cần quyết định / quyền truy cập từ người khác

- `packages/contracts/http/workflow/openapi.yaml` currently lacks GET `triggers[]` readiness/timing fields; root owns the shared contract and should reconcile it before treating the API contract as complete.

##### Hướng dẫn cho AI agent tiếp theo

- Preserve the workflow-before-trigger pessimistic lock order and the single-transaction admission/slot update.
- Do not change the fixed retry reason or expose raw exception/provider text.
- Check `git status` before any edits; the workspace contains unrelated concurrent Workflow changes.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 16
- Task 6/8/10/11 reports and execution runtime source

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 12:36 Asia/Saigon` |
| Trạng thái worktree | Có nhiều shared changes; no stage/commit/push. |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex GPT-6 Luna MAX worker |
| Cần đọc trước khi tiếp tục | Task 16 scratch report and root's full Workflow suite result. |

#### 14. Follow-up — application boundary and GET contract

This follow-up was assigned after the Task 16 handoff and supersedes the earlier notes that left OpenAPI reconciliation to root.

##### Changes

- Added `application.port.out.ScheduleValidationPort` for validation and `next(cron, timezone, after)`. `SpringScheduleValidation` implements it; publication and schedule admission depend on the port. The cron/DST calculation was unchanged.
- Replaced the application publication test's infrastructure adapter with a port mock and an explicit first-slot assertion. The clean-architecture rule no longer claims application files are empty scaffolds.
- Extended the shared `Workflow` detail schema with optional `triggers[]`. Items have exactly `triggerId`, `type`, `status`, `reasonCode`, `nextRunAt`, and `lastTriggeredAt`; item-level extra fields are rejected. `triggers` remains outside the existing required list and top-level `additionalProperties: true` remains, preserving additive compatibility.
- Extended `WorkflowContractValidationTest` to check the GET response reference, compatibility settings, and exact safe projection.

##### Verification

- GitNexus upstream impact for `WorkflowPublicationService`, `ScheduleTriggerProcessor`, and `SpringScheduleValidation` returned `UNKNOWN` because the index storage version is 43 and the installed runtime is 42. Targeted source search confirmed the current application and test references; no HIGH/CRITICAL risk result was available.
- Workflow Maven focused selectors — architecture, schedule, publication unit/HTTP, and real PostgreSQL/Rabbit schedule concurrency: `PASS`, 27 tests, 0 failures/errors/skips.
- Workspace `WorkflowContractValidationTest`: `PASS`, 2 tests, 0 failures/errors/skips.
- After tightening the first-slot fixture to guarantee a future instant, the final `WorkflowPublicationTest` rerun passed 13 tests with 0 failures/errors/skips. It compiled 152 main and 55 test source files against the stabilized OCR lane.
- `git diff --check`: `PASS`; Git printed existing LF-to-CRLF warnings for the two Workflow `application.properties` files.
- The checked-in Maven wrapper failed in PowerShell with `icm : Cannot index into a null array`; the cached Maven 3.9.16 binary ran successfully after sandbox escalation for the user-level `.m2` cache. The full Workflow suite remains with root for an independent rerun.
- One intervening rerun stopped at `testCompile` while OCR sources were still being added. After the OCR worker confirmed the sources and tests compiled, the final publication selector passed as recorded above.

##### Handoff

- No staging, commit, push, or Task 17 work.
- Updated ignored scratch report: `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-16-report.md`.
- Root owns the full Workflow rerun, GitNexus refresh/change detection, and commit decision.
---

### Source record: 2026-09-23-workflow-service-task-17.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex worker `workflow_webhook_6` |
| Người review / nhận bàn giao | Root task agent |
| Trạng thái | `Hoàn thành; chờ review tích hợp` |
| Phạm vi | Task 17: provision, authenticate, admit, and document durable webhook ingress |
| Nguồn | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 17; `docs/superpowers/specs/workflow-service-spec.md`, section 9 |

#### 2. Tóm tắt

- Added one-time webhook endpoint/secret provisioning. The database stores only the opaque endpoint key and SHA-256 secret verifier; publish responses containing the secret use `Cache-Control: no-store`, and later workflow reads expose no endpoint key, secret, or hash.
- Added public `POST /webhooks/{endpointKey}` ingress with fixed-length constant-time credential comparison, generic 404 for unknown/wrong/inactive/paused/superseded registrations, 1 MiB body limit, process-wide rate limit, and transactional workflow/trigger rechecks plus Task 8 execution/outbox admission.
- Added the unique partial endpoint-key migration, OpenAPI contract updates, and HTTP/PostgreSQL/RabbitMQ acceptance and rollback tests.

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Compile | `PASS` | Workflow module compiled 160 production and 60 test sources in the focused Maven run. |
| Tests | `PASS` | Focused selectors: 25/25; Workspace OpenAPI contract selectors: 2/2. |
| Migration | `PASS` | V4 applied in PostgreSQL HTTP tests; duplicate-preflight test confirmed failure rolls back and preserves rows. |
| Diff check | `PASS` | `git diff --check`; only existing properties-file line-ending notices. |
| Commit / PR | Not created | No staging, commit, or push. |

#### 3. Scope and acceptance

Implemented Task 17 only. Acceptance covered hashed-only persistence, one-time no-store publication, non-disclosing reads/errors, webhook authentication and lifecycle rejection, arbitrary JSON/null input, size/rate bounds, atomic execution/outbox commit, firing-root-only execution, queued completion after pause, and duplicate endpoint migration safety. OCR implementation, `NodeExecutorRegistry`, and Task 18 production configuration were left to their owners.

#### 4. Decisions

| Decision | Reason / evidence | Follow-up |
| --- | --- | --- |
| Generate 24-byte endpoint keys and 32-byte secrets with `SecureRandom`, encoded base64url without padding; persist SHA-256 verifier only. | Matches Task 17 contract; fixed-size digests use `MessageDigest.isEqual`, including a dummy digest for unknown endpoints. | Lost publish response requires another publish; no retrieval path exists. |
| Enforce a unique partial index on non-null endpoint keys after duplicate preflight. | Historical rows remain untouched; duplicate data fails migration before index creation. | If deployment data contains duplicates, perform explicit data repair outside this migration. |
| Lock workflow then current trigger, recheck published/current/active state, and reuse `ExecutionAdmissionService.automatic` in the same transaction. | Serializes pause/republish against ingress and keeps execution rows plus outbox intent atomic. | Broker delivery remains asynchronous after commit. |
| Use a bounded process-wide fixed-window limiter, default 6,000 requests/minute. | Constant memory, monotonic clock, and simple service-level admission bound. | Limit is per process instance. |

#### 5. Changes

##### Application, persistence, and HTTP

- Added `WebhookSecretPort`, `WebhookSecretService`, `WebhookTriggerService`, `WebhookIngressRateLimiter`, generic webhook/rate-limit exceptions, and `WebhookController`.
- Added `findWebhookByEndpoint` and `lockCurrent` use to the trigger adapter; publication provisions fresh webhook registrations and returns one-time credentials through redacted response records.
- Added `V4__unique_webhook_endpoints.sql`, with a duplicate-group preflight that reveals only a count and never deletes data.
- Added path-template redaction for webhook errors and request-size responses; security denials and generic exception responses use the sanitized path. The exact POST ingress is public; other routes retain existing authentication.
- Updated Workflow OpenAPI for the public ingress, generic 404, 413/429 behavior, one-time publication secrets, no-store response, and body limit.

##### Tests

- `WebhookIngressTest`: real HTTP, PostgreSQL and RabbitMQ; one-time credentials; generic invalid credential/lifecycle 404; arbitrary JSON and null; sanitized body-limit errors; rollback when outbox insertion fails; webhook root success after pause.
- `WebhookEndpointMigrationTest`: duplicate-key preflight fails without deleting registration rows or creating the unique index.
- `WebhookSecretTest`, `WebhookIngressRateLimiterTest`, and updated publication unit/HTTP tests.

#### 6. Affected files

- `packages/contracts/http/workflow/openapi.yaml`
- `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WebhookSecretPort.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkflowTriggerPort.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowPublicationService.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/trigger/WebhookIngressRateLimiter.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/trigger/WebhookTriggerService.java`
- `services/workflow-service/src/main/java/com/weav/workflow/domain/exception/WebhookNotFoundException.java`
- `services/workflow-service/src/main/java/com/weav/workflow/domain/exception/WebhookRateLimitExceededException.java`
- `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/workflow/WorkflowTrigger.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/repository/WorkflowTriggerAdapter.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/SecurityConfig.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/WebhookSecretService.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/GlobalExceptionHandler.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/WebhookRequestPath.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/WorkflowRequestBodyLimitFilter.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/WorkflowRequestBodyLimitConfiguration.java`
- `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/WebhookController.java`
- `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/WorkflowController.java`
- `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/response/WorkflowResponse.java`
- `services/workflow-service/src/main/resources/db/migration/V4__unique_webhook_endpoints.sql`
- `services/workflow-service/src/test/java/com/weav/workflow/WorkflowPublicationTestConfiguration.java`
- `services/workflow-service/src/test/java/com/weav/workflow/application/WorkflowPublicationTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/application/trigger/WebhookIngressRateLimiterTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/persistence/WebhookEndpointMigrationTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/security/WebhookSecretTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WebhookIngressTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowPublicationHttpTest.java`

#### 7. Verification evidence

- Workflow service, from `services/workflow-service`:
  `mvn -o -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WebhookIngressTest,WebhookSecretTest,WebhookIngressRateLimiterTest,WebhookEndpointMigrationTest,WorkflowPublicationTest,WorkflowPublicationHttpTest test` — **25 passed, 0 failed, 0 errors**. `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` was set. This used the cached Maven 3.9.16 executable because the repository wrapper could not start Maven under the current PowerShell environment.
- Workspace contract test, from `services/workspace-service`:
  `mvn -o -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WorkflowContractValidationTest test` — **2 passed, 0 failed, 0 errors**; SnakeYAML parsed the updated Workflow OpenAPI.
- `git diff --check` — clean; Git printed line-ending normalization notices for shared application properties files.
- Migration success was observed at PostgreSQL 18.6 schema version v4 in the HTTP acceptance tests. Duplicate-preflight test observed the expected V4 failure and transaction rollback while both trigger rows remained.
- RabbitMQ acceptance admitted and completed the webhook execution after the workflow was paused; the webhook firing root succeeded while the unrelated manual root was skipped.

#### 8. GitNexus and risk

GitNexus upstream impact returned `risk: UNKNOWN` because the registered index uses LadybugDB storage version 43 while the installed runtime supports 42. Per repository guidance, this is unresolved, not a clean impact result. Targeted source searches confirmed the WorkflowTriggerPort implementation/delegation sites and the controller, filter, security, and exception-handler callers. No reindex or commit was attempted.

#### 9. Handoff / next steps

1. Root reviews the shared working-tree diff and runs the broader Workflow regression suite; no additional Task 17 changes remain from this worker.
2. Keep all one-time response credentials out of logs and caches. The database has only `endpoint_key` and `secret_hash` for webhook authentication.
3. No files were staged, committed, or pushed. The shared checkout contains unrelated concurrent Workflow/OCR work; preserve it.

#### 10. End of session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 16:26 Asia/Saigon` |
| Worktree | Shared checkout with uncommitted parallel task files. |
| Commit / PR | None |
| Người cập nhật log | Codex worker `workflow_webhook_6` |
| Cần đọc trước khi tiếp tục | Task 17 plan section, this work log, and current `git status`. |

#### 11. Security regression follow-up (2026-09-23)

- Root's broad Workflow run exposed a test-only route collision: `WorkflowSecurityTest.TestSecurityController` declared a second `POST /webhooks/{endpointKey}` mapping after the production webhook controller was added.
- Removed the duplicate test stub. The security regression now exercises the real controller using a random unknown endpoint and expects generic `404 WEBHOOK_NOT_FOUND` with `Cache-Control: no-store`; anonymous `GET /webhooks/{key}` and `POST /webhooks/{key}/extra` still expect `401`.
- GitNexus impact for `WorkflowSecurityTest` returned `risk: UNKNOWN` because the index database is storage version 43 and the installed runtime is version 42. Source inspection confirmed the duplicate mapping existed only in this test controller; production security configuration was not changed.
- Verification: `WorkflowSecurityTest,WebhookIngressTest` — **22 passed, 0 failures, 0 errors** with PostgreSQL 18.6 and RabbitMQ Testcontainers. Maven was run from `services/workflow-service` with UTC timezone.
- No production webhook/security behavior changed. Root will rerun the full Workflow suite. No stage, commit, or push.
---

### Source record: 2026-09-23-workflow-service-task-18.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / chưa commit |
| Người thực hiện | Codex GPT-6 worker |
| Người review / nhận bàn giao | `/root` |
| Trạng thái cuối session | `OCR constructor/config regressions covered; focused OCR tests pass; Task 17 context test now reaches a separate webhook bean error` |
| Phạm vi session | Workflow OCR JWT, bounded private client, executor/config/tests và OCR contract docs. |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 18 |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thêm `ocr.extract`, RS256 service JWT signer và private `POST /v1/extractions` client. Request chỉ chứa một source, mặc định `vi+en`/`detectTables=true`, UUID `X-Request-ID`, cùng `traceparent` hợp lệ nếu có.
- Giới hạn response ở 1 MiB, thời gian kết nối/đọc tối đa 5/30 giây, redirects bị tắt; kiểm tra response theo fixtures v1; lỗi không giữ provider body/cause; output đi qua `OutputSanitizer` với token và URL hiện hành.
- URL và artifact execution đều mặc định tắt và cần từng cờ xác minh riêng. Tài liệu ghi rõ OCR runtime hiện chưa xác minh JWT claims, còn tin `X-Workspace-ID`, tự sinh request ID thiếu, và khởi tạo `artifact_resolver=None`; không có production activation trong thay đổi này.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Compile | `PASS` | Latest focused Maven run biên dịch 152 production và 56 test source. |
| Unit / contract test | `PASS trong phạm vi OCR` | Latest run passed all 12 OCR tests; earlier representative `WorkflowPublicationTest` passed 13/13. Task 17 context selector exposed a separate webhook bean constructor error. |
| Migration / database | `Không áp dụng` | Không đổi schema hay migration. |
| Runtime OCR | `Chưa kiểm tra` | Không gọi OCR service; service-side verifier/allowlist/resolver còn là prerequisite. |
| Review thay đổi | `Đã kiểm tra` | OCR diff và `git diff --check`; GitNexus impact trên registry hiện hữu là `UNKNOWN`, được corroborate bằng source. |
| Commit / PR | `Chưa tạo` | Không stage/commit/push. |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Tạo signer ngắn hạn với `iss=weav-workflow`, `aud=weav-ocr`, `scope=ocr:extract`, workspace, execution, node execution, `kid`, `iat`, `exp`, và `jti`.
2. Gọi đúng private extraction route với request/response được giới hạn và lỗi/credentials được xử lý an toàn.
3. Giữ URL/artifact gate đóng cho tới khi prerequisite phía OCR được xác minh độc lập; không phát minh artifact descriptor API.

##### Trong phạm vi

- Workflow OCR infrastructure/client/executor/config và tests.
- OCR README/OpenAPI mô tả các claim và prerequisite runtime.
- Work log K và scratch handoff bị ignore.

##### Ngoài phạm vi / chủ động chưa làm

- Không sửa OCR runtime, `WorkflowPublicationService`, `ScheduleTriggerProcessor`, `SpringScheduleValidation`, Workflow OpenAPI, hay Task 17 files.
- Không thêm descriptor/download contract, OCR artifact resolver, `X-Workspace-ID` workaround, dependency, migration, hay production enablement.

##### Tiêu chí hoàn thành

- [x] JWT signer và executor/client có contract tests.
- [x] Explicit Spring constructor selection; disabled OCR bean context and registry smoke test.
- [x] URL/artifact gates mặc định đóng; errors/output không tiết lộ token hay signed URL.
- [x] OCR docs nói rõ claim, request ID và prerequisite runtime còn thiếu.
- [x] `git diff --check` sạch, work log và ignored handoff sẵn sàng.
- [ ] Production OCR acceptance sau khi OCR verifier, URL allowlist và artifact resolver/contract được hoàn thành độc lập.

#### 4. Bối cảnh và ràng buộc

- **Bối cảnh hệ thống:** Workflow `NodeExecutorRegistry` tự nhận `List<NodeExecutor>`; source xác nhận `ocr.extract` component được phát hiện mà không cần sửa registry. Node execution context cung cấp workspace/execution/node execution IDs nhưng không mang user token.
- **Nguồn sự thật:** Workflow V1 plan Task 18 và OCR contract README/OpenAPI; source trong OCR service được kiểm tra để phân biệt yêu cầu contract với khả năng runtime hiện tại.
- **Ràng buộc bảo mật:** Chỉ đọc khóa RSA PKCS#8 từ file local được mount, RSA tối thiểu 2048 bit; không log body/cause có thể chứa URL hoặc bearer token. Mọi gate mặc định `false`.
- **GitNexus:** Impact upstream cho `NodeExecutorRegistry` trả `UNKNOWN` do stored DB version 43 không khớp runtime 42. Source search/inspection xác nhận list injection, registry caller path và component registration; không coi empty graph là an toàn tuyệt đối.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — 2026-09-23

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước 15:00 | Đọc Task 18, OCR contract/runtime, work log K và registry path | Xác nhận JWT/runtime gaps và artifact resolver chưa có; không sửa service OCR. | Xong |
| Trước 15:00 | Tạo JWT issuer, typed config, OCR RestClient và node executor | Executor yêu cầu `fileUrl` hoặc UUID `artifactId`; ký token mới cho mỗi lần thử. | Xong |
| Trước 15:00 | Thêm contract/JWT/executor tests và OCR docs | Tests bao gồm request headers/body, gates, response fixtures, lỗi, claim và key-source checks. | Xong |
| 15:03 | Chạy focused OCR Maven selectors | 11 tests passed; compile 152 source + 55 test source. | Xong |
| 15:04 | Chạy peer publication selector và static diff check | Peer báo 13 publication tests passed; `git diff --check` sạch, chỉ có cảnh báo line ending ở properties. | Xong |
| 15:26 | Sửa Spring bean constructor selection và thêm context smoke test | GitNexus impact của `OcrClient` là `UNKNOWN` do DB 43/runtime 42; source search xác nhận hai constructors và `@Component`, không có `@Autowired`. Annotated production constructor explicitly. | Xong |
| 15:27 | Chạy OCR, Spring smoke và representative Spring Boot selectors | `OcrClientSpringContextTest` và `WorkflowPublicationTest` cùng OCR selectors passed: 25 tests, 0 failures/errors/skips; compile 152 source + 56 test source. | Xong |
| 16:18 | Điền các OCR binding bắt buộc vào test properties và chạy Task 17 context selectors | OCR selectors passed 12/12. App contexts tiếp tục tới `WebhookIngressRateLimiter` rồi lỗi `No default constructor found`; không còn `OcrClientProperties.baseUrl` failure trong báo cáo hiện tại. | OCR xong; bàn giao blocker riêng |

##### Diễn giải quan trọng

Workflow feature flags `WORKFLOW_OCR_SERVICE_CLAIMS_VERIFIED`, `WORKFLOW_OCR_URL_ALLOWLIST_VERIFIED`, và `WORKFLOW_OCR_ARTIFACT_RESOLVER_VERIFIED` là operator attestations, không phải phát hiện trạng thái OCR runtime. Hiện OCR runtime không đáp ứng các xác minh đó, vì vậy không được bật ở production. URL execution cần claim verification và allowlist; artifact execution còn cần contract descriptor/download đã duyệt, adapter resolver thực tế, ownership/expiry/download verification.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Tách gate theo OCR, URL source, artifact source và từng prerequisite | Một cờ global không chứng minh URL SSRF controls, claim verification hay resolver. | Một `enabled` flag duy nhất. | Tất cả giá trị mặc định `false`; cờ `verified` cần bằng chứng độc lập trước khi cấu hình. |
| Chỉ chấp nhận RSA PKCS#8 qua `file:` local URI, khóa >=2048 bit | Signing credential không được tải từ URL tùy ý; yếu tố khóa phải tương thích RS256 an toàn. | Cho Spring `ResourceLoader` chấp nhận mọi scheme. | Khóa production cần được mount; location sai trả `DEPENDENCY_NOT_CONFIGURED` an toàn. |
| Giữ artifact request shape nhưng khóa execution khi resolver chưa được chứng minh | OCR contract chưa có descriptor/download API; không được suy diễn một route từ `artifactId`. | Gọi thử bằng legacy workspace header hoặc tự định nghĩa endpoint. | Cấu hình vẫn kiểm tra được nhưng production activation chờ contract/resolver đã duyệt. |
| Giới hạn private response và chuyển lỗi sang failure code/safe message | OCR output và lỗi có thể chứa signed URL hoặc dữ liệu nhạy cảm. | Trả raw provider payload/body/cause cho execution log. | Response cap 1 MiB; JSON/schema bounds; không kèm cause hoặc body; output qua sanitizer. |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `OcrClientProperties` kiểm tra origin, timeout, TTL <=120s và max response <=1 MiB; `toString()` không lộ key reference.
- `WorkflowServiceJwtIssuer` ký RS256 mới cho mỗi lần gọi với `kid`, claims cố định, `iat`, TTL cấu hình mặc định 60s và unique `jti`. Khóa chỉ đọc từ file local PKCS#8; không cho network resource hoặc RSA <2048 bit.
- `OcrClientConfiguration` tắt redirects và giới hạn connect/read timeout. `OcrClient` gửi đúng `/v1/extractions`, Bearer service JWT, UUID `X-Request-ID`, optional valid `traceparent`, và JSON request contract. Không gửi `X-Workspace-ID`.
- Client kiểm tra input/source, response JSON/schemaVersion/requestId, document/text/blocks/tables/metadata bounds; phân loại retry chỉ cho lỗi transient và không đưa provider body/message vào failure.
- `OcrNodeExecutor` map `ocr.extract` config với đúng source discriminator, language và table option; token không thể lấy từ user input.

##### 7.2. Dữ liệu, schema và migration

- Không đổi database, schema hoặc migration.

##### 7.3. Cấu hình, hạ tầng và dependency

- `services/workflow-service/src/main/resources/application.properties`: thêm gates OCR false, private URL mặc định theo service discovery `http://ocr-service:8000`, key ID/location rỗng, timeout, TTL và response bound.
- `services/workflow-service/src/test/resources/application.properties`: tắt mọi OCR gate cho tests.
- Bổ sung test-only base URL, key placeholders, timeout, TTL và response cap vào test `application.properties`; file test thay thế/overlay cấu hình main khi chạy một số context.
- Không thêm Maven dependency; focused compile sử dụng JOSE/Jackson/Spring hiện có.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Private `POST /v1/extractions`, `application/json`; không đổi public Workflow API.
- **Security:** RS256 claims theo contract; không thay bằng Identity HMAC/user access token. OCR docs yêu cầu verifier lấy tenant từ claim đã xác minh và không tin `X-Workspace-ID`.
- **Lỗi:** Gate đóng trả `DEPENDENCY_NOT_CONFIGURED`, không retry; provider errors chỉ dùng allowlisted code, message tĩnh và retry status/classification.
- **Quan sát:** Không thêm log chứa request/response, token, key reference hoặc URL.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClient.java` | Bounded client, validation, error/output sanitation. | Private route only. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClientConfiguration.java` | HTTP client timeout, redirects disabled. | Dedicated bean. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClientProperties.java` | Typed, bounded flags and settings. | All gate primitives default false. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/WorkflowServiceJwtIssuer.java` | RS256 service JWT. | Local PKCS#8 only. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrNodeExecutor.java` | `ocr.extract` adapter. | No descriptor API invented. |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/ocr/` | JWT, request/response and node config tests. | 11 focused tests. |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/ocr/OcrClientSpringContextTest.java` | Real Spring context resolves disabled OCR beans and registers `ocr.extract` in `NodeExecutorRegistry`. | Guards against constructor ambiguity. |
| `Sửa` | `services/workflow-service/src/main/resources/application.properties` | Append disabled OCR settings. | Shared file also contains other lanes' settings. |
| `Sửa` | `services/workflow-service/src/test/resources/application.properties` | Append OCR gate defaults. | Shared file also contains other lanes' settings. |
| `Sửa` | `packages/contracts/http/ocr/README.md` | Required claims and unresolved verifier/resolver prerequisites. | Does not claim runtime acceptance. |
| `Sửa` | `packages/contracts/http/ocr/openapi.yaml` | Auth and request ID descriptions. | No OCR runtime implementation change. |
| `Thêm` | `docs/work_logs/K/2026-09-23-workflow-service-task-18.md` | Session handoff. | This file. |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-18-report.md` | Short coordinator handoff. | Ignored by `.superpowers/sdd/.gitignore`. |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| OCR + context + publication | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC; mvn -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=OcrServiceJwtTest,OcrClientContractTest,OcrNodeExecutorTest,OcrClientSpringContextTest,WorkflowPublicationTest test` from `services/workflow-service` | `PASS`, 25 tests, 0 failures/errors/skips. | Includes actual `AnnotationConfigApplicationContext` bean/registry smoke and representative `@SpringBootTest`; compile 152 production + 56 test sources. OCR HTTP calls remain mocked. |
| OCR + Task 17 context rerun | `-Dtest=WebhookIngressTest,WorkflowPublicationHttpTest,OcrServiceJwtTest,OcrClientContractTest,OcrNodeExecutorTest,OcrClientSpringContextTest` | OCR selectors `PASS`, 12 tests; overall `FAIL` at `WebhookIngressRateLimiter` (`No default constructor found`) and subsequent `WorkflowPublicationHttpTest` context-failure threshold. | Test-property binding now supplies all required OCR fields; no OCR property error in this rerun. Task 17 worker owns the separate bean. |
| Static/diff | `git diff --check` | `PASS`; only LF-to-CRLF notices for the two shared properties files. | No stage/commit. |
| OCR OpenAPI parse | Python `yaml.safe_load` | Not available: PyYAML is not installed in the runner. | Description-only YAML edits inspected in diff; no parser claimed. |

##### Điều chưa được kiểm tra

- Chưa kiểm tra live OCR request: current OCR source still lacks signature/claim validation and request-ID rejection, and trusts `X-Workspace-ID`.
- Chưa chạy allowed/disallowed URL end-to-end; current deployment-side allowlist prerequisite is not independently verified.
- Chưa chạy artifact extraction; OCR dependency wiring has no concrete resolver and the descriptor/download contract is intentionally undefined.
- Full Workflow suite and final integration acceptance remain root-owned.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Cao | OCR service verifier does not validate Workflow JWT claims. | Source inspection finds bearer presence check, trusted `X-Workspace-ID` context and generated ID when absent. | Keep `WORKFLOW_OCR_SERVICE_CLAIMS_VERIFIED=false`; no production activation. | OCR service owner hardens verifier and required request ID; root obtains independent evidence. |
| Cao | URL allowlist and artifact resolver prerequisites are not proven. | OCR dependency wiring uses `artifact_resolver=None`; service safe-fetch configuration has no verified configured allowed domains. | URL/artifact flags default false; docs explicitly prohibit inferred API/workaround. | OCR/service owners implement and verify allowlist, resolver, descriptor/download and ownership/expiry checks. |
| Trung bình | GitNexus upstream impact is `UNKNOWN`. | Index DB/runtime storage version mismatch. | Targeted source inspection confirmed registry discovery/call path; UNKNOWN retained as unresolved. | Root owns index refresh/change detection. |
| Thấp | Python YAML validation unavailable. | `yaml` module is not installed. | Manually reviewed the description-only YAML diff. | Run the repository contract parser/linter if available during root acceptance. |
| Resolved | Spring could not instantiate `OcrClient` in Boot contexts. | Root combined suite reported 106 Spring context errors across 342 tests; the reported cause was multiple unannotated constructors and no default constructor. | Marked the 4-argument production constructor `@Autowired`; the new context smoke and representative `WorkflowPublicationTest` passed. | Root reruns the full Workflow suite. |
| Resolved in OCR scope | Test context initially lacked required `OcrClientProperties` URI/duration/size fields. | `src/test/resources/application.properties` had OCR gate overrides but no full property set. | Added test-only URL, key placeholders, durations and max response size; OCR selectors passed. | None for OCR; Task 17 peer owns the next distinct `WebhookIngressRateLimiter` constructor error. |
| Trung bình / cross-lane | Task 17 HTTP context startup fails at webhook ingress limiter. | Latest Surefire cause is `WebhookIngressRateLimiter: No default constructor found`; this appears after OCR selectors pass. | Not changed by OCR worker; reported to Task 17 owner. | Task 17 worker to select its Spring constructor and rerun its acceptance tests. |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Root reviews OCR source and tests, then runs the full combined Workflow suite.
2. Keep all OCR gates false in production until OCR verifier, URL allowlist, and artifact resolver prerequisites are independently satisfied.
3. After OCR runtime changes land, run end-to-end accepted/rejected JWT, allowed/disallowed URL, and artifact ownership/expiry/download tests before considering activation.

##### Cần quyết định / quyền truy cập từ người khác

- OCR runtime changes, allowlist setup and artifact descriptor/download contract remain outside this worker's scope and require their own review/acceptance.

##### Hướng dẫn cho AI agent tiếp theo

- Read this log, Task 18 and current `git status` before editing; shared Workflow files include other workers' changes.
- Do not interpret the `*_VERIFIED` flags as automatic runtime checks or activate them without external evidence.
- Do not add a descriptor API or `X-Workspace-ID` workaround.

#### 12. Tham chiếu

- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 18.
- `packages/contracts/http/ocr/README.md` and `packages/contracts/http/ocr/openapi.yaml`.
- `services/ocr-service/src/api/routes.py` and dependency wiring.

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 16:19 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; có shared Workflow changes từ các lane khác. |
| Commit/PR đã tạo | Chưa tạo. |
| Người cập nhật log | Codex GPT-6 worker |
| Cần đọc trước khi tiếp tục | Mục 10–11; Task 18 production gates. |
---

### Source record: 2026-09-23-workflow-service-smoke-handoff.md


- Branch: `feature/workflow-service`; shared checkout remains uncommitted.
- Current verification: Workflow Service 354/354 tests and package passed; Gateway unit 90/90, e2e 74/74, typecheck, and build passed; web Workflow Playwright 33/33 plus OCR builder 7/7 passed in mock mode. These do not prove the live cross-service path.
- Corrected the Workflow README smoke example to use Gateway port `3000`, matching `compose.dev.yml`; port `8081` belongs to Identity.
- `scripts/test-workflow-v1.ps1` is ready for a disposable workspace and a short-lived Identity token held only in the user's PowerShell process. It creates a persistent test workflow; the default false-branch fixture makes no outbound HTTP call. The runtime worker must be enabled for the execution to finish.
- Compose validation passed with both `.env.example` (user PowerShell) and `.env` (coordinator, elevated read-only Docker invocation). Docker is installed at `C:\Users\nhoan\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`; sandboxed execution is denied, elevated execution works. `docker ps` reported no running containers at inspection time.
- User authorized reading `.env`; inspected only relevant setting presence without displaying secrets. Database and JWT settings are populated. `IDENTITY_INTERNAL_SERVICE_KEY`, `WEAV_INTERNAL_SERVICE_KEY`, and `WORKFLOW_INTERNAL_SERVICE_KEY` are absent. `WORKFLOW_EXECUTION_WORKER_ENABLED` is absent, so Compose defaults to disabled. No smoke access token or workspace ID was available to the coordinator. `.env` remains unchanged and ignored by Git.
- User confirmed `.env` points to shared project databases, then explicitly authorized testing against them. All three Spring services support `DB_SCHEMA` for Hibernate and Flyway. Live acceptance will reuse the authorized database connections with unique test schemas, a separate local broker/cache/email sink, generated test-only credentials, and a test account/workspace created through service APIs. This avoids picking up existing Workflow schedules/executions. Keep existing schemas and `.env` unchanged.
- GitNexus `detect_changes` remains unresolved because the local index storage version is newer than the installed engine. Do not commit before rebuilding the index and rerunning graph change analysis.
- `git diff --check` passed; only existing LF/CRLF notices were reported.

#### Next acceptance slice

- Scope: local smoke Compose configuration and PowerShell launcher reusing `scripts/test-workflow-v1.ps1`; bounded to test tooling and documentation, with no changes to business behavior. Test schemas are additive within the user-authorized shared database servers.
- Acceptance: real Gateway, Identity, Workspace, Workflow, PostgreSQL, and RabbitMQ path passes the existing safe false-branch smoke; auth/workspace setup uses public APIs and a local email sink if needed. Existing database schemas/data, shared `.env`, default Docker resources, and member T logs remain untouched.
- Verification: validate the standalone Compose model, verify endpoints are local and data stores are task-owned, run the smoke, review the diff, and record redacted results. If runtime exposes a source defect, report exact evidence for coordinator review instead of widening the worker scope.
