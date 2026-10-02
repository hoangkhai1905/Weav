# Nhật ký: workflow-service review medium fixes (WF-9, WF-12, WF-11, WF-8)

Nguồn: `docs/reviews/2026-10-01-backend-review.md` (WF-9, WF-12, WF-11, WF-8). Nhánh `refactor/optimize-backend`. Trạng thái: code xong, chờ coordinator review/commit.

## Quyết định

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| `recovery_count` tăng trong chính câu `UPDATE` của `claim` khi hàng đang `RUNNING` | Nguyên tử, không thêm round trip | Mọi lần re-claim (crash worker hay lỗi cấp run) đều tính; mặc định tối đa 5 |
| Vượt `weav.workflow.execution.max-recoveries` thì `failExecution` (dùng chung với `failLegacyState`) + ghi `workflow.failed` vào `notification_outbox`, `claim` trả `Optional.empty()` | Listener ack như duplicate, không cần sửa listener | Mã lỗi `RECOVERY_EXHAUSTED`; chưa có danh sách mã lỗi nào để cập nhật |
| Một component `RetentionPurgeJob`, khóa `pg_try_advisory_xact_lock`, mỗi batch (1000 dòng) một transaction | Một leader tại một thời điểm, giao dịch ngắn | Không có index riêng cho purge (quét tuần tự mỗi giờ; thêm index nếu bảng lớn) |
| Giữ lịch sử run mặc định TẮT (`WORKFLOW_EXECUTION_RETENTION_DAYS=0`) | Người dùng giao quyết định, tránh xóa dữ liệu bất ngờ | Bật bằng số ngày > 0 |

## Thay đổi

- Migration `V7__execution_recovery_cap_and_outbox_index.sql`: cột `workflow_executions.recovery_count INT NOT NULL DEFAULT 0`; index `idx_outbox_aggregate (aggregate_type, aggregate_id, event_type, created_at DESC)` (cộng thêm).
- `ExecutionStateAdapter`: `claim` (đếm + ngưỡng), tách `recordTerminalNotification` khỏi `commit`, tách `failExecution` khỏi `failLegacyState`. GitNexus impact: class `UNKNOWN` (không có caller được index); xác nhận bằng grep: `claim` chỉ gọi từ `ExecutionJobListener`, `commit` từ `ExecutionRunner`; chữ ký public không đổi.
- `RetentionPurgeJob` (mới): purge `outbox_events` PUBLISHED > 7 ngày, `notification_outbox` PUBLISHED > 14 ngày, và (nếu bật) run kết thúc SUCCESS/FAILED/CANCELLED quá hạn cùng node/attempt/log/agent_runs/agent_steps; bỏ qua run còn outbox chưa gửi hoặc là parent của run khác.
- Cấu hình: `weav.workflow.execution.max-recoveries` (5), `weav.workflow.retention.outbox-days` (7), `notification-outbox-days` (14), `execution-days` (env `WORKFLOW_EXECUTION_RETENTION_DAYS`, 0), `purge-interval` (PT1H), `initial-delay` (PT5M). Env mới chỉ có `WORKFLOW_EXECUTION_RETENTION_DAYS` (`.env.example`, `.env`, `compose.dev.yml`, `application.properties`).

## Kiểm tra

- Test mới: `ExecutionLeaseTest.aRunThatKeepsBeingReclaimedIsFailedWithRecoveryExhaustedAndNotifiesOnce`; `RetentionPurgeJobTest` (2 test).
- `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (từ `services/workflow-service`): 462 test, 0 failure, 0 error, 0 skipped (không gặp lỗi môi trường đã biết).
- `docker compose -f compose.yml -f compose.dev.yml --profile app config -q`: PASS.

## Rủi ro / việc tiếp theo

- Hành vi người dùng thấy: run bị crash lặp quá 5 lần giờ chuyển FAILED (`RECOVERY_EXHAUSTED`) và gửi thông báo thất bại, thay vì chạy lại vô hạn.
- Chưa kiểm tra trên Neon (không kết nối DB thật); migration cần chạy khi triển khai.
- Các service khác (identity `user_sessions`, `notification_outbox` của service khác) chưa có retention; ngoài phạm vi lane này.

## Lane 2: WF-11 (concurrency) và WF-8 (revision bản nháp)

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Consumer min 2 / max 4 (prefetch vẫn 1), `spring.task.scheduling.pool.size=4`, Hikari `${WORKFLOW_DB_POOL_SIZE:10}` | Tối đa 4 run song song × transaction trạng thái ngắn + 4 thread scheduler + request HTTP; Neon pooled endpoint | Env mới: `WORKFLOW_EXECUTION_WORKER_CONCURRENCY_MIN=2`, `..._MAX=4`, `WORKFLOW_SCHEDULER_POOL_SIZE=4`, `WORKFLOW_DB_POOL_SIZE=10` (`.env.example`, `.env`, `compose.dev.yml`) |
| Không sửa `retryWait...join()` | Tối đa ~3 s mỗi node, concurrency đã bù | Giữ nguyên |
| `expectedRevision` (Long, tùy chọn) trong body `PUT .../draft`, không dùng `If-Match` | Người dùng đã chọn | Thiếu thì last-write-wins như cũ; khác revision đang lưu thì 409 `DRAFT_REVISION_CONFLICT`, `error.details[0] = {field: "revision", message: "<revision hiện tại>"}` |
| Chỉ `Workflow.updateDraft` tăng `revision`; create (=0), publish, pause, resume không tăng | Chỉ `save` đổi `draft_definition`/tên/mô tả/editorState | Response `WorkflowResponse` có thêm trường `revision` (cộng thêm) |

- Migration `V8__workflow_draft_revision.sql`: `workflows.revision BIGINT NOT NULL DEFAULT 0`.
- Code: `ExecutionWorkerRabbitConfiguration` (min/max + kiểm tra 1 <= min <= max <= 16), `Workflow`/`WorkflowJpaEntity`/`WorkflowPersistenceMapper` (trường `revision`, giữ constructor cũ), `WorkflowDraftService.save` (overload 8 tham số, so sánh trong transaction đã khóa hàng), `DraftRevisionConflictException` (mới), `WorkflowController` (handler 409), `SaveWorkflowDraftRequest`, `WorkflowResponse`.
- Gateway: `saveDraftSchema` (zod `.strict()`) từng chặn trường lạ, nên thêm `expectedRevision` (int >= 0, tùy chọn) và test chuyển tiếp + 409 giữ nguyên. Response được chuyển nguyên status/body.
- Contract: `packages/contracts/http/workflow/openapi.yaml` (`SaveWorkflowDraftRequest.expectedRevision`, `Workflow.revision`).
- Kiểm tra thread-safety: `ExecutionJobListener` không giữ state theo run (chỉ `AtomicBoolean`), `ExecutionRunner` dùng biến cục bộ cho mỗi run, lease trong `claim` chặn hai worker chạy một execution bất kể owner. Không cần sửa.
- Handoff cho web: `apps/web` chưa gửi `expectedRevision`. Web nên lưu `revision` nhận được khi tải/lưu bản nháp, gửi lại trong mỗi lần `PUT .../draft`, và xử lý 409 `DRAFT_REVISION_CONFLICT` (tải lại bản nháp hoặc hỏi người dùng ghi đè).
