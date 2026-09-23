# Nhật ký làm việc - Task 17 Webhook ingress

## 1. Metadata

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

## 2. Tóm tắt

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

## 3. Scope and acceptance

Implemented Task 17 only. Acceptance covered hashed-only persistence, one-time no-store publication, non-disclosing reads/errors, webhook authentication and lifecycle rejection, arbitrary JSON/null input, size/rate bounds, atomic execution/outbox commit, firing-root-only execution, queued completion after pause, and duplicate endpoint migration safety. OCR implementation, `NodeExecutorRegistry`, and Task 18 production configuration were left to their owners.

## 4. Decisions

| Decision | Reason / evidence | Follow-up |
| --- | --- | --- |
| Generate 24-byte endpoint keys and 32-byte secrets with `SecureRandom`, encoded base64url without padding; persist SHA-256 verifier only. | Matches Task 17 contract; fixed-size digests use `MessageDigest.isEqual`, including a dummy digest for unknown endpoints. | Lost publish response requires another publish; no retrieval path exists. |
| Enforce a unique partial index on non-null endpoint keys after duplicate preflight. | Historical rows remain untouched; duplicate data fails migration before index creation. | If deployment data contains duplicates, perform explicit data repair outside this migration. |
| Lock workflow then current trigger, recheck published/current/active state, and reuse `ExecutionAdmissionService.automatic` in the same transaction. | Serializes pause/republish against ingress and keeps execution rows plus outbox intent atomic. | Broker delivery remains asynchronous after commit. |
| Use a bounded process-wide fixed-window limiter, default 6,000 requests/minute. | Constant memory, monotonic clock, and simple service-level admission bound. | Limit is per process instance. |

## 5. Changes

### Application, persistence, and HTTP

- Added `WebhookSecretPort`, `WebhookSecretService`, `WebhookTriggerService`, `WebhookIngressRateLimiter`, generic webhook/rate-limit exceptions, and `WebhookController`.
- Added `findWebhookByEndpoint` and `lockCurrent` use to the trigger adapter; publication provisions fresh webhook registrations and returns one-time credentials through redacted response records.
- Added `V4__unique_webhook_endpoints.sql`, with a duplicate-group preflight that reveals only a count and never deletes data.
- Added path-template redaction for webhook errors and request-size responses; security denials and generic exception responses use the sanitized path. The exact POST ingress is public; other routes retain existing authentication.
- Updated Workflow OpenAPI for the public ingress, generic 404, 413/429 behavior, one-time publication secrets, no-store response, and body limit.

### Tests

- `WebhookIngressTest`: real HTTP, PostgreSQL and RabbitMQ; one-time credentials; generic invalid credential/lifecycle 404; arbitrary JSON and null; sanitized body-limit errors; rollback when outbox insertion fails; webhook root success after pause.
- `WebhookEndpointMigrationTest`: duplicate-key preflight fails without deleting registration rows or creating the unique index.
- `WebhookSecretTest`, `WebhookIngressRateLimiterTest`, and updated publication unit/HTTP tests.

## 6. Affected files

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

## 7. Verification evidence

- Workflow service, from `services/workflow-service`:
  `mvn -o -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WebhookIngressTest,WebhookSecretTest,WebhookIngressRateLimiterTest,WebhookEndpointMigrationTest,WorkflowPublicationTest,WorkflowPublicationHttpTest test` — **25 passed, 0 failed, 0 errors**. `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` was set. This used the cached Maven 3.9.16 executable because the repository wrapper could not start Maven under the current PowerShell environment.
- Workspace contract test, from `services/workspace-service`:
  `mvn -o -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WorkflowContractValidationTest test` — **2 passed, 0 failed, 0 errors**; SnakeYAML parsed the updated Workflow OpenAPI.
- `git diff --check` — clean; Git printed line-ending normalization notices for shared application properties files.
- Migration success was observed at PostgreSQL 18.6 schema version v4 in the HTTP acceptance tests. Duplicate-preflight test observed the expected V4 failure and transaction rollback while both trigger rows remained.
- RabbitMQ acceptance admitted and completed the webhook execution after the workflow was paused; the webhook firing root succeeded while the unrelated manual root was skipped.

## 8. GitNexus and risk

GitNexus upstream impact returned `risk: UNKNOWN` because the registered index uses LadybugDB storage version 43 while the installed runtime supports 42. Per repository guidance, this is unresolved, not a clean impact result. Targeted source searches confirmed the WorkflowTriggerPort implementation/delegation sites and the controller, filter, security, and exception-handler callers. No reindex or commit was attempted.

## 9. Handoff / next steps

1. Root reviews the shared working-tree diff and runs the broader Workflow regression suite; no additional Task 17 changes remain from this worker.
2. Keep all one-time response credentials out of logs and caches. The database has only `endpoint_key` and `secret_hash` for webhook authentication.
3. No files were staged, committed, or pushed. The shared checkout contains unrelated concurrent Workflow/OCR work; preserve it.

## 10. End of session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 16:26 Asia/Saigon` |
| Worktree | Shared checkout with uncommitted parallel task files. |
| Commit / PR | None |
| Người cập nhật log | Codex worker `workflow_webhook_6` |
| Cần đọc trước khi tiếp tục | Task 17 plan section, this work log, and current `git status`. |

## 11. Security regression follow-up (2026-09-23)

- Root's broad Workflow run exposed a test-only route collision: `WorkflowSecurityTest.TestSecurityController` declared a second `POST /webhooks/{endpointKey}` mapping after the production webhook controller was added.
- Removed the duplicate test stub. The security regression now exercises the real controller using a random unknown endpoint and expects generic `404 WEBHOOK_NOT_FOUND` with `Cache-Control: no-store`; anonymous `GET /webhooks/{key}` and `POST /webhooks/{key}/extra` still expect `401`.
- GitNexus impact for `WorkflowSecurityTest` returned `risk: UNKNOWN` because the index database is storage version 43 and the installed runtime is version 42. Source inspection confirmed the duplicate mapping existed only in this test controller; production security configuration was not changed.
- Verification: `WorkflowSecurityTest,WebhookIngressTest` — **22 passed, 0 failures, 0 errors** with PostgreSQL 18.6 and RabbitMQ Testcontainers. Maven was run from `services/workflow-service` with UTC timezone.
- No production webhook/security behavior changed. Root will rerun the full Workflow suite. No stage, commit, or push.
