# Nhật ký: bot điều khiển, sự kiện workflow, Discord - backend (W6-B1)

> Một log cho cả tính năng, cập nhật tại chỗ. Mẫu: `docs/work_logs/log_template.md` (bản rút gọn). Spec: `docs/superpowers/specs/2026-10-09-w6b-control-bot-design.md`; plan: `docs/superpowers/plans/2026-10-09-w6b-control-bot.md` (lane B1).

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-09 |
| Nhánh | `feat/w6-b1-control-bot-backend` (từ `week6` 042f384), worktree `T:\Weav-wt\w6-b1` |
| Người thực hiện | Coding agent lane W6-B1 (coordinator review/commit) |
| Trạng thái | Code + test tự động xong; chưa commit; chưa kiểm tra trên stack thật |
| Phạm vi | 3 loại node (`weav.workflow`, `trigger.workflow_event`, `discord.send_message`), executor, listener sự kiện, schema/hợp đồng |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Giới hạn / theo dõi |
| --- | --- | --- |
| `ControlBotStore` (cổng đọc JDBC mới) cho: người publish của run, danh sách workflow, thống kê status, nguồn sự kiện, listener | Executor không được gọi controller; cần `published_by` và truy vấn theo workspace | Chỉ đọc bảng của workflow-service |
| `weav.workflow` đi qua `ExecutionAdmissionService.manual` (key `wfctl-<nodeExecutionId>`), `WorkflowPublicationService.pause/resume`, `MonitoringService.history` | Dùng lại quota, idempotency, kiểm tra quyền; retry của node không chạy đôi | `status` kiểm `WORKFLOW_MONITOR` trực tiếp |
| Tên workflow: NFC, trim, gộp khoảng trắng, lower `Locale.ROOT`; không bỏ dấu tiếng Việt | Theo plan: `báo cáo  tuần` khớp `Báo cáo tuần`, nhưng `Bao cao tuan` thì không | Trùng tên -> `AMBIGUOUS_WORKFLOW` kèm tối đa 5 ứng viên |
| `WorkflowEventTriggerService` + `FinishedListenerConfiguration` (bean `@Primary` gọi `AlertEvaluator` rồi service sự kiện) | `ExecutionStateAdapter` nhận đúng một `ExecutionFinishedListener` | Mỗi listener tự nuốt lỗi |
| Khóa idempotency `wfevent:<sourceExecutionId>` trên `(workflow_id, idempotency_key)` có sẵn; trạng thái trong input là `SUCCEEDED` (không phải `SUCCESS`) | Khớp từ vựng `events`; không cần migration | `TriggerType`/`ExecutionTriggerType` thêm `WORKFLOW_EVENT` (cột VARCHAR, không migration) |
| Kiểm tra publish: `workflowIds` phải thuộc workspace (`WORKFLOW_NOT_IN_WORKSPACE`), qua `Optional<ControlBotStore>` thêm vào constructor `@Autowired` | Tránh sửa mọi chỗ gọi constructor cũ (giữ constructor 11 tham số) | `events` hợp lệ kiểm trong `DefinitionValidator` |
| `PinnedHttpTransport.executeDiscordWebhook`: host cố định discord.com/discordapp.com, đường dẫn `/api/webhooks/<id>/<token>`, không query/port/userinfo | Chống SSRF, theo mẫu Telegram | URL webhook không bao giờ log hay trả về |
| Discord 429: lỗi `HTTP_RATE_LIMITED` retry được, thông báo nêu số giây `Retry-After`; lịch retry của runner vẫn cố định | `Failure` không có trường chờ, đổi sẽ chạm toàn bộ runner | Chưa tôn trọng `Retry-After` thật sự (xem rủi ro) |
| Chống vòng lặp A<->B qua `weav.workflow run`: run bắt đầu trong chuỗi sự kiện (trigger WORKFLOW_EVENT hoặc key `wfctl-chain-`) được admit với key `wfctl-chain-<nodeExecId>`; `WorkflowEventTriggerService` bỏ qua nguồn có trigger WORKFLOW_EVENT hoặc key bắt đầu bằng `wfctl-chain-` | Dấu hiệu bắc cầu, không cần migration; run do bot bắt đầu từ trigger thường vẫn bắn cảnh báo | `ControlBotStore.runOrigin` đọc thêm trigger type + idempotency key |
| Kiểm quyền theo thao tác (`WORKFLOW_RUN` / `WORKFLOW_MANAGE_STATE` / `WORKFLOW_MONITOR`) trước khi tìm workflow theo tên | Người không có quyền không dò được tên workflow | Trả lời `command` khi trùng tên không liệt kê id |
| `command` cần `sender` + `allowedSenders` (bắt buộc khi publish); sender không có trong danh sách thì không làm gì, trả `ok:false` | K quyết định: bot Telegram công khai không được cho ai cũng điều khiển | `allowedSenders` là trường cá nhân (`x-weav-personal`), bị bỏ khi chia sẻ template |
| `published_by` null -> `FORBIDDEN` không retry; reply cắt ở ranh giới dòng/từ | Review | |
| Discord 429 giữ lịch retry cố định của runner (giới hạn đã biết, K đã chốt) | Đổi cần trường delay trên `Failure` dùng chung | |

## 3. File thay đổi

- Schema/hợp đồng: `packages/workflow-schema/nodes/{weav.workflow,trigger.workflow_event,discord.send_message}.json`, `packages/contracts/http/workflow/definition.schema.json`, `openapi.yaml` (enum trigger type + `WORKFLOW_EVENT`).
- workflow-service: `NodeSideEffects`, `DefinitionValidator`, `TriggerType`, `ExecutionTriggerType`, `WorkflowExecutionRepositoryAdapter`, `ExecutionStateAdapter`, `WorkflowPublicationService`, `PinnedHttpTransport`, `WorkspaceClient` (thêm `DISCORD`); mới: `ControlBotStore`, `ControlBotStoreAdapter`, `WeavWorkflowNodeExecutor`, `WorkflowEventTriggerService`, `FinishedListenerConfiguration`, `DiscordSendMessageNodeExecutor`.
- Cấu hình: `application.properties`, `.env.example`, `compose.dev.yml` (`WORKFLOW_WEB_BASE_URL`, mặc định rỗng).
- Test: `NodeConfigSchemasTest`, `DefinitionValidatorTest`, `WorkflowPublicationTest`, mới `WeavWorkflowNodeExecutorTest`, `WorkflowEventTriggerServiceTest`, `WorkflowEventIntegrationTest` (Testcontainers), `DiscordSendMessageNodeExecutorTest`.

## 4. Lệnh đã chạy

Xem báo cáo cuối của lane (kết quả `./mvnw verify` ghi ở dưới khi chạy xong).

## 5. Rủi ro và việc tiếp theo

- `Retry-After` của Discord chưa được dùng để dãn lịch retry.
- Cần kiểm tra thật trên stack: bot Telegram `/status`, `/run`, `/failures`; workflow lỗi kích hoạt mẫu cảnh báo email/Discord.
- Lane B2: connection `DISCORD` ở workspace-service và web.
