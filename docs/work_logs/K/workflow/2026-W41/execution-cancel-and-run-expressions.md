# Nhật ký: dừng lượt chạy, biểu thức lượt chạy, sửa nhỏ (W6-C3)

> Một log cho cả tính năng, cập nhật tại chỗ. Mẫu: `docs/work_logs/log_template.md` (bản rút gọn).

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-09 |
| Nhánh | `feat/w6-c3-cancel-expressions` (từ `week6` e9a1710), worktree `T:\Weav-wt\w6-c3` |
| Người thực hiện | Coding agent lane W6-C3 (coordinator review/commit) |
| Trạng thái | Code + kiểm tra tự động xong; chưa commit; chưa kiểm tra trên stack thật |
| Tài liệu nguồn | `docs/superpowers/specs/2026-10-09-w6c-shared-templates-design.md` mục 6-8; plan lane W6-C3 Task 1-5 |

## 2. Phạm vi

1. Dừng một lượt chạy: cờ `cancel_requested_at` (Flyway V15), `POST .../executions/{id}/cancel`, runner kiểm tra cờ mỗi vòng lặp, trạng thái CANCELLED không gửi thông báo `workflow.failed`.
2. Biểu thức mới `{{ now }}`, `{{ run.id }}`, `{{ workflow.id }}`, `{{ workflow.name }}` (+ bộ chọn biến, prompt AI).
3. Nút "Dừng" trên trang chi tiết lượt chạy.
4. N8 (tên bước do AI sinh), follow-up (1) câu chữ LONG_RUNNING, (3) 404 cho workspace đã xóa, (4) `runtime.integration.cjs`.

## 3. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| `requestCancel(workspaceId, workflowId, executionId, at)` có thêm `workspaceId` | Cổng chỉ kiểm quyền theo workspace; không có nó thì người có quyền ở workspace A hủy được run của workspace B nếu biết id | NOT_FOUND khi lệch workspace/workflow |
| `SELECT ... FOR UPDATE OF e` trong `requestCancel` | Cùng khóa dòng với `commit` của runner: run vừa SUCCESS/FAILED thì trả ALREADY_FINISHED, không ghi đè | Cờ đặt đúng lúc run sắp xong vẫn có thể kết thúc SUCCESS (chấp nhận) |
| `isCancelRequested`/`requestCancel` là default method của `ExecutionStatePort` | Giữ nguyên các fake trong test (ExecutionRunnerTest, ScheduleConcurrencyTest) | Adapter ghi đè |
| `Snapshot` thêm `workflowName` + constructor 13 tham số cũ | Biểu thức `workflow.name`; 167 process đi qua đây nên không đổi chữ ký cũ | `workflowName` null thì `{{ workflow.name }}` lỗi "không có giá trị" |
| `MappingContext` thêm `RunInfo run`, giữ constructor 3 tham số | Biểu thức cũ phải giải y như trước; `now`, `run.id`... chỉ khớp chính xác cả chuỗi nên không đụng `variables.now`, `nodes.now.output.x` | Ngoài lượt chạy (run == null) thì lỗi MAPPING_ERROR |
| Cancel thắng failure trong runner nếu cờ được thấy trước | Người dùng đã dừng; run đã có failureSeen thì vẫn FAILED | |
| CANCELLED: không ghi outbox nhưng vẫn gọi `notifyFinishedAfterCommit` | Luật cảnh báo vẫn thấy run kết thúc | Monitoring đã chỉ đếm SUCCESS/FAILED |
| Lỗi 409 dùng `ExecutionAlreadyFinishedException` (code `EXECUTION_ALREADY_FINISHED`) | Mã lỗi ổn định cho web/mobile | `ConflictException` có thêm constructor protected `(code, message)` |
| N8: model trả `name` cho mỗi node; backend đưa vào `layout[nodeId].name` | Web đã đọc `layout[id].name` làm tên bước; không đổi hình dạng response | Fallback ở web: `nodeLabel(type)` thay vì id thô |
| Follow-up (3): `WorkspaceNotFoundException extends ForbiddenException` (HTTP 404, code RESOURCE_NOT_FOUND) khi workspace-service trả 404 cho access | Mọi `catch (ForbiddenException)` hiện có (outbox publisher...) giữ nguyên | 404 khi người gọi không phải thành viên, hoặc workspace đã xóa/không tồn tại (workspace-service trả 404 cho cả hai); 403 chỉ cho thành viên thiếu quyền. Quyết định của K, 2026-10-09: giữ 404 cho người không phải thành viên (follow-up 3 giữ nguyên) |
| Follow-up (1): đổi câu chữ trong `notification-catalog.ts` ("đã chạy hơn N ..."), không thêm trường vào event | Thêm trường phá hợp đồng JSON schema `.strict()` của notification-service | Câu chữ đúng cả khi run đã xong |

## 4. Thay đổi

### 4.1. workflow-service
- Thêm `V15__execution_cancel_request.sql`, `ExecutionCancelService`, `ExecutionAlreadyFinishedException`, `WorkspaceNotFoundException`, `RunInfo`.
- Sửa `ExecutionStatePort`, `ExecutionStateAdapter` (requestCancel, isCancelRequested, workflow_name trong snapshot, CANCELLED không outbox), `ExecutionRunner` (cancelSeen + `finalizeStopped`), `MappingContext`, `MappingResolver`, `WorkflowExecutionController` (`POST /{executionId}/cancel` -> 202), `IntentCompiler`/`WorkflowGenerationService` (tên bước), `WorkspaceClient`, `GlobalExceptionHandler`, `ForbiddenException`, `ConflictException`.
- Test: `ExecutionCancelStateTest` (Postgres), `ExecutionCancelServiceTest`, `ExecutionRunnerTest` (3 ca mới), `MappingResolverTest` (2), `DefinitionValidatorTest` (1), `WorkflowExecutionHttpTest` (1), `WorkflowGenerationServiceTest` (1), `WorkspaceClientTest`, `GlobalExceptionHandlerTest`.

### 4.2. Gateway, contracts
- `workflow.module.ts`: route `POST .../executions/:executionId/cancel`; spec: 2 ca. `openapi.yaml`: path `cancelExecution`; README: đoạn mô tả.

### 4.3. ai-service, notification-service
- `prompts.ts` (`GENERATE_SYSTEM`: biểu thức mới + `name` mỗi node) + spec; `generation-result.ts` (node có `name` tùy chọn <= 80 ký tự) + spec.
- `notification-catalog.ts` + spec (câu chữ LONG_RUNNING); `test/runtime.integration.cjs` (+ `monitoring.alert.consecutive_failures`, `monitoring.alert.long_running`, 22 loại).

### 4.4. Web
- `ExecutionsTriPane.tsx` (nút "Dừng" + ConfirmModal + badge "Đang dừng…"; đây là nơi thật của trang chi tiết lượt chạy, `LiveExecutionDetailPage` chỉ chuyển hướng), `workflow-v1.api.ts` (`cancelExecution`; `definitionToCanvas` fallback tên bước theo loại), `execution.api.ts`, `VariablePicker.tsx` (nhóm "Lần chạy"), `translations.ts` (khối W6-C3; `runs.status.cancelled` đổi thành "Đã dừng"/"Stopped").
- `e2e/execution-cancel.spec.ts` (5 ca, cổng 4184).

## 5. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `./mvnw -q test -Dtest=ExecutionCancelServiceTest,ExecutionRunnerTest,MappingResolverTest,DefinitionValidatorTest` (workflow-service) | PASS |
| `./mvnw test -Dtest=ExecutionCancelStateTest,WorkflowExecutionHttpTest` | PASS 15/15 |
| `./mvnw test -Dtest=WorkspaceClientTest,GlobalExceptionHandlerTest,IntentCompilerTest,WorkflowGenerationServiceTest,AlertEvaluatorTest` | PASS 64/64 |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | xem mục 6 |
| `pnpm --dir services/api-gateway test` / `test:e2e` / `build` | 119 / 131 / OK |
| `pnpm --dir services/ai-service test` / `test:e2e` / `build` | 216 / 75 / OK |
| `pnpm --dir services/notification-service test` / `test:e2e` / `build` | 104 / 19 / OK |
| `tsc --noEmit -p tsconfig.app.json`, `pnpm --dir apps/web build`, eslint các file đã sửa | PASS |
| Playwright chromium (cổng 4184, `VITE_API_MODE=http`): `execution-cancel`, `executions-live`, `builder-correctness` | 19/19 PASS |

## 6. Rủi ro và việc tiếp theo

- Chưa kiểm tra trên stack thật: dừng một run dài (http chậm), `{{ run.id }}`/`{{ now }}` trong tin nhắn, 404 workspace đã xóa.
- Cờ dừng chỉ được thấy khi một node xong hoặc khi hết thời gian chờ retry; node đang chạy không bị ngắt (đúng spec).
- Web không biết "đã gửi yêu cầu dừng" sau khi tải lại trang (API chưa trả cờ); nút "Dừng" hiện lại, bấm lần nữa an toàn.
- 404 (không còn 403) khi người gọi không phải thành viên workspace hoặc workspace đã xóa/không tồn tại; 403 chỉ cho thành viên thiếu quyền. Quyết định của K (2026-10-09): giữ nguyên.
- `{{ workflow.name }}` là tên hiện tại của quy trình (không phải tên lúc bắt đầu); chấp nhận.
- Review vòng 1: runner chờ retry theo lát 2 giây và kiểm tra cờ dừng giữa các lát; nếu cờ được đặt khi node cuối đang chạy và node thành công thì run kết thúc SUCCESS; thêm test run phục hồi có sẵn cờ, test dừng trong lúc chờ retry, test 404/409 qua MockMvc.
