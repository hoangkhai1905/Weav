# Nhật ký làm việc - Workflow Service: sửa các finding mức High từ backend review

## 1. Metadata

| Trường                       | Giá trị                                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Ngày làm việc                | `2026-10-01`                                                                                      |
| Múi giờ ghi log              | `Asia/Saigon`                                                                                     |
| Dự án / repository           | Weav, `services/workflow-service`                                                                 |
| Nhánh                        | `refactor/optimize-backend` (chưa commit)                                                         |
| Người thực hiện              | AI agent (theo yêu cầu của K)                                                                     |
| Người review / nhận bàn giao | K                                                                                                 |
| Trạng thái cuối session      | `Hoàn thành` phần code, test và tài liệu; chưa commit                                             |
| Phạm vi session              | WF-1/X-1, WF-3, WF-4 và phần workflow của X-2 trong `docs/reviews/2026-10-01-backend-review.md`  |
| Liên kết liên quan           | `docs/reviews/2026-10-01-backend-review.md`, `docs/specs/services/workflow-service.md`            |

## 2. Tóm tắt điều hành

- WF-1: manual run và webhook nhận header tùy chọn `Idempotency-Key`; cùng key + cùng body trả lại đúng 202 ban đầu, cùng key + body khác trả 422 `IDEMPOTENCY_KEY_REUSED`.
- WF-3: publish lại bản nháp không đổi là no-op (không version mới, không secret mới, không event mới); bản nháp đổi vẫn tạo version và secret mới.
- WF-4: key lạ và secret sai không còn tiêu hao ngân sách chung; thêm limiter theo từng endpoint sau khi xác thực, limiter toàn cục chỉ còn là trần cho request đã xác thực.
- X-2: create, save draft, publish, pause/resume gọi Workspace trước và ngoài transaction, sau đó mới mở transaction ngắn để lock, kiểm tra lại và ghi.

| Hạng mục                | Trạng thái | Ghi chú ngắn                                                              |
| ----------------------- | ---------- | ------------------------------------------------------------------------- |
| Build / compile         | `PASS`     | `./mvnw verify` BUILD SUCCESS                                             |
| Unit / integration test | `PASS`     | 451 test, 0 failure, 0 error, 0 skipped (gồm cả 3 test "environment-only") |
| Migration / database    | `PASS`     | V6 áp dụng qua Flyway trên Testcontainers PostgreSQL                      |
| Review thay đổi         | `Đã kiểm tra` | `git diff --check` sạch; chưa chạy GitNexus `detect_changes` vì chưa commit |
| Commit / PR             | Chưa tạo   | Theo yêu cầu: không commit                                                |

## 3. Mục tiêu và phạm vi

Trong phạm vi: `services/workflow-service`, `packages/contracts/http/workflow/openapi.yaml`, `docs/specs/services/workflow-service.md`, log này.

Ngoài phạm vi (chủ động không làm): carry-over credential và endpoint rotate-secret (WF-3 chỉ làm no-op), Valkey/limiter theo IP (WF-4 bản đầy đủ), fallback header của provider (`X-GitHub-Delivery`...), idempotency cho `POST /workflows` (create), thay đổi Gateway (handoff của đối tác), thay đổi `.env`, thay đổi kích thước pool Hikari.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do | Phương án đã cân nhắc | Hệ quả / theo dõi |
| --- | --- | --- | --- |
| Lưu `idempotency_key`/`request_hash` bằng field JPA `updatable=false` trong `WorkflowExecutionJpaEntity` | Chỉ ghi lúc admission; `save()` dùng `merge` với entity dựng từ mapper (không có hai field này) nên `updatable=false` ngăn ghi đè thành null | Native SQL (phải tự qualify schema) | `request_hash` khai báo `char(64)` + `SqlTypes.CHAR` để qua `ddl-auto=validate` |
| Replay luôn trả `QUEUED` | Phản hồi gốc luôn là 202 `QUEUED`; "body giống hệt" theo yêu cầu, dù run có thể đã chạy tiếp | Trả trạng thái hiện tại | Client cần trạng thái thật thì đọc `GET .../executions/{id}` |
| Dựa vào workflow row lock để tuần tự hóa cùng key; unique index chỉ là backstop | Cả manual và webhook đều lock workflow trước khi kiểm tra key nên không có race thực sự (test 3 luồng đồng thời cho đúng 1 run) | Bắt `DataIntegrityViolation` rồi đọc lại (transaction đã bị abort trong PostgreSQL, phải mở transaction mới) | Nếu sau này bỏ lock, phải thêm retry ở tầng service |
| `request_hash` = SHA-256 của JSON input đã sắp xếp key | Cùng nội dung khác thứ tự key vẫn là cùng request | Hash thô của body | Chỉ hash `input`, không hash header |
| Webhook: kiểm tra key sau khi xác thực secret, trước khi lock workflow | Request không xác thực không chạm ngân sách nào; request bị 429 không giữ lock | Kiểm tra trước xác thực (hiện trạng) | Vẫn giữ đường dummy-hash/constant-time cho key lạ |
| `WebhookEndpointRateLimiter`: map giới hạn 10.000 endpoint, dọn cửa sổ hết hạn khi đầy, fail-open khi vẫn đầy | Bộ nhớ có giới hạn, không thêm dependency; trần toàn cục vẫn áp dụng | Caffeine (không có sẵn), Valkey (chưa dùng ở workflow) | Limiter vẫn theo từng JVM (đã ghi trong spec) |
| Tách transaction bằng `TransactionOperations` (constructor mới + constructor cũ dùng `withoutTransaction()`) | Tránh self-invocation của `@Transactional`; unit test dựng service trực tiếp vẫn chạy | Bean `@Transactional` riêng | `get`/`list` bỏ `@Transactional` (repository đã tự có `readOnly` transaction) |
| Test `concurrentPublishersAllocateDistinctVersions...` đổi kỳ vọng | Hai publisher đồng thời cùng một draft nay cho một version (WF-3). Đổi tên test, kỳ vọng `[1,1]`, version tiếp theo là 2 | Giữ nguyên (sẽ fail) | Đây là thay đổi hành vi có chủ đích |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `ExecutionAdmissionService`: overload có `idempotencyKey`; validate `[A-Za-z0-9._:-]{8,128}` (400), tính `request_hash`.
- `WorkflowExecutionRepositoryAdapter`: sau khi giữ lock workflow, tìm theo `(workflow_id, idempotency_key)`; trùng hash trả `Admission` gốc, khác hash ném `IdempotencyKeyReusedException`.
- `GlobalExceptionHandler`: `IdempotencyKeyReusedException` map sang 422 (`IDEMPOTENCY_KEY_REUSED`).
- `WorkflowExecutionController`, `WebhookController`: đọc header `Idempotency-Key`.
- `WorkflowPublicationService`: `publish` không còn `@Transactional`; làm kiểm tra remote trước, `publishLocked` trong `TransactionOperations`; thêm `unchangedPublication` (no-op khi trạng thái PUBLISHED và definition + schemaVersion bằng version hiện tại). `pause`/`resume` cũng tách authorize khỏi transaction.
- `WorkflowDraftService`: `create`/`save` tách như trên; `save` vẫn lock + kiểm tra lại tham chiếu connection trong transaction.
- `WebhookTriggerService` + `WebhookEndpointRateLimiter` (mới).

### 7.2. Dữ liệu, schema và migration

- Migration `V6__execution_idempotency.sql`: thêm cột nullable `idempotency_key VARCHAR(128)`, `request_hash CHAR(64)` và unique index từng phần `uq_workflow_executions_idempotency (workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Chỉ thêm, tương thích ngược; rollback = drop index và hai cột.

### 7.3. Cấu hình

- `weav.workflow.webhook.rate-limit.endpoint-requests-per-window` = `${WORKFLOW_WEBHOOK_ENDPOINT_RATE_LIMIT_REQUESTS_PER_WINDOW:120}` (dùng chung `...rate-limit.window`). Chưa thêm vào `.env.example` (ngoài phạm vi); biến có default.

### 7.4. API

- OpenAPI workflow: tham số header `Idempotency-Key` (manual execution + webhook), response 422 `IdempotencyKeyReused`, mô tả publish no-op và rate limit mới. Không có contract test nào liệt kê file này.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/workflow-service/src/main/resources/db/migration/V6__execution_idempotency.sql` | Cột và index idempotency |
| Thêm | `.../domain/exception/IdempotencyKeyReusedException.java` | Lỗi 422 |
| Thêm | `.../application/trigger/WebhookEndpointRateLimiter.java` | Limiter theo endpoint |
| Sửa | `.../application/port/out/ExecutionAdmissionPort.java` | `Command` thêm key/hash (constructor cũ giữ nguyên) |
| Sửa | `.../application/service/ExecutionAdmissionService.java`, `.../usecase/TriggerExecutionUseCase.java` | Overload idempotency |
| Sửa | `.../infrastructure/persistence/entity/WorkflowExecutionJpaEntity.java`, `.../repository/WorkflowExecutionRepositoryAdapter.java` | Lưu và replay |
| Sửa | `.../application/service/WorkflowPublicationService.java`, `WorkflowDraftService.java` | No-op publish, tách transaction |
| Sửa | `.../application/trigger/WebhookTriggerService.java` | Thứ tự limiter mới |
| Sửa | `.../presentation/http/WorkflowExecutionController.java`, `WebhookController.java`, `.../infrastructure/web/GlobalExceptionHandler.java` | Header và 422 |
| Sửa | `application.properties` | Property giới hạn theo endpoint |
| Sửa | `packages/contracts/http/workflow/openapi.yaml`, `docs/specs/services/workflow-service.md` | Contract và spec |
| Thêm/Sửa test | `ExecutionIdempotencyTest`, `RepublishNoOpTest`, `TransactionBoundaryTest`, `WebhookTriggerServiceRateLimitTest`, `WebhookEndpointRateLimiterTest`, `GlobalExceptionHandlerTest`, `WorkflowPublicationConcurrencyTest` | Xem phần 9 |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh | Kết quả | Phạm vi |
| --- | --- | --- | --- |
| Toàn bộ test + build | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (từ `services/workflow-service`) | BUILD SUCCESS; 451 test, 0 failure, 0 error | Testcontainers PostgreSQL + RabbitMQ |
| Diff | `git diff --check` | Sạch | Các file thuộc phạm vi |

Test mới: (a) cùng key hai lần = 1 execution, cùng `Admission` (kể cả đổi thứ tự key JSON); (b) cùng key khác body = `IdempotencyKeyReusedException`, 422 ở handler; (c) 3 luồng đồng thời cùng key = 1 execution; key sai định dạng = 400, không key = hành vi cũ; (d) republish không đổi = cùng version, không secret/trigger/event mới, draft đổi = version 2 + secret mới; (e) 100 request key lạ/secret sai không giảm ngân sách endpoint hợp lệ, limiter theo endpoint không ảnh hưởng endpoint khác; (f) `TransactionBoundaryTest`: không có lời gọi Workspace nào chạy khi transaction đang mở, lock/ghi chỉ chạy trong transaction (publish, save, create).

### Điều chưa được kiểm tra

- Chưa chạy với Gateway thật: Gateway hiện chưa chuyển tiếp `Idempotency-Key` (GW-1, handoff đối tác).
- Chưa đo số kết nối Hikari thực tế dưới tải; chỉ có test thứ tự gọi (f).

## 10. Rủi ro

| Mức độ | Vấn đề | Cách xử lý / bước tiếp theo |
| --- | --- | --- |
| Trung bình | Trước khi lock, `publish` đọc draft ở transaction riêng; draft đổi giữa chừng bị từ chối bằng `DraftChangedException` (giữ nguyên guard cũ, test `draftSavedDuringRemoteAuthorizationIsNeverPublished...` vẫn pass) | Không cần làm thêm |
| Thấp | Limiter theo endpoint là per-JVM, fail-open khi quá 10.000 endpoint hoạt động trong một cửa sổ | Chuyển sang Valkey nếu chạy nhiều instance |
| Thấp | Webhook không đọc `X-GitHub-Delivery` / `X-Webhook-Delivery-Id` làm key | Thêm khi cần, ở tầng controller |

## 11. Trạng thái bàn giao

1. Review diff, chạy GitNexus `detect_changes` rồi commit (chưa commit theo yêu cầu).
2. Gateway: chuyển tiếp header `Idempotency-Key`, cho phép trong CORS (handoff GW-1).
3. WF-2 (recovery chạy lại node có side effect), ID/WS còn lại thuộc các finding khác.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Trạng thái worktree | Có thay đổi chưa commit (thuộc phạm vi workflow-service, contract, spec, log) |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | AI agent |
