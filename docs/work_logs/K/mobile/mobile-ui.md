# Nhật ký làm việc: Mobile UI và nối API thật (apps/mobile)

> Log theo tính năng, cập nhật tại chỗ. Mẫu: `docs/work_logs/log_template.md`. Không chứa secret.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Cập nhật gần nhất | 2026-10-07 (Asia/Saigon) |
| Dự án | Weav, `apps/mobile` (Expo SDK 57) |
| Nhánh | `feature/mobile-ui` |
| Người thực hiện | AI agent (theo yêu cầu của K) |
| Trạng thái | Đang tiếp tục. Xong bước 1, 2, 4 của brief. Chưa làm bước 3 (bỏ), 5, 6 |
| Tài liệu nguồn | `weav-mobile-agent-prompt.md` (brief, không commit), `apps/mobile/docs/api-alignment.md` (báo cáo đối chiếu, thắng brief khi mâu thuẫn) |

## 2. Tóm tắt

- Mobile gọi đúng route gateway thật cho workflow, execution, connection, AI generate, assistant (workspace-scoped). Không còn mock cho các nhóm này.
- DTO, mapper, `*.http.contract.ts` và test node cho 5 nhóm; domain types theo contract thật (`workflowId`, `WAITING`, `READY/SKIPPED`, log `DEBUG/WARN`, không còn `lastRunAt/ownerName/workflowName`).
- Gỡ Telegram (repository, mock, hook, màn hình, navigation, i18n).
- Màn hiện có chỉ sửa tối thiểu để biên dịch và chạy với type mới; chưa thiết kế lại UI.

## 3. Quyết định (đã được người dùng chốt)

| Quyết định | Lý do / hệ quả |
| --- | --- |
| Không dựng mock layer mới; xóa `Mock{Workflow,Execution,Connection,Ai,Telegram}Repository`; factory luôn dùng HTTP cho workflow/execution/connection/ai/assistant | App dùng backend thật. `EXPO_PUBLIC_API_MODE=mock` chỉ còn fake auth, workspace, notification (giữ nguyên, test giữ nguyên) |
| Báo cáo đối chiếu là chuẩn | definition `{schemaVersion,nodes:[{id,type,config}],edges:[{id,source,target,sourcePort?}]}`; nhãn node = `editorState.nodes[id].name`, fallback `nodeType`; 422 là `INVALID_STATE`; pause/resume trả `triggers: []` nên refetch detail; generate có câu hỏi `CONNECTION`, lý do `INVALID_INTENT`; test connection có `DEPENDENCY_FAILURE` |
| Assistant chat là SSE qua `expo/fetch` (stream `response.body`); nếu body không đọc được thì đọc cả text rồi parse SSE một lần | Tách trong `http-assistant.repository.ts` + `assistant.sse.ts`. `expo/fetch` import động để test node không cần runtime native |
| Timeout riêng: generate 85000 ms, chat 80000 ms | Gateway: generate 80 s, chat 75 s. Route khác giữ 10 s |
| Route chi tiết execution `executions/[workflowId]/[executionId]` | Execution chỉ đọc được qua workflow. Notification không có `workflowId` nên mở `executions/lookup/[executionId]`, màn này gọi MỘT hàm `findWorkflowIdForExecution` (dò tối đa 50 workflow đầu của workspace, ghi chú là giới hạn contract) |
| `listRecentWorkspaceExecutions()`: tối đa 20 workflow, `size=10`, gộp, sort `createdAt` giảm dần | Tạm thời tới khi backend có endpoint toàn workspace; bỏ qua workflow 403/404; polling hạ còn 15 s vì mỗi lần là tối đa 21 request |
| `runWorkflow`: `Idempotency-Key` mới mỗi lần bấm (`run:<hex>`), thử lại đúng 1 lần với CÙNG key khi 504/timeout | Gateway âm thầm bỏ key sai pattern nên key được validate phía client |

## 4. Thay đổi chính

- Domain: `src/domain/{workflow,execution,connection,ai}/*.types.ts` viết lại; thêm `domain/assistant`; bỏ `domain/telegram`; mở rộng `ApiErrorCode`.
- HTTP: `*.dto.ts`, `*.mapper.ts`, `*.http.contract.ts` (workflow, execution, connection, ai, assistant), `mapper-utils.ts`, `assistant.sse.ts`, `gateway-request.ts` (gửi request có token, 401 hết phiên, lỗi chuẩn hóa), `http-*.repository.ts` viết lại, thêm `http-assistant.repository.ts`.
- Hooks: query key luôn kèm `workspaceId` (từ `workspace.store` qua `features/workspace/active-workspace.ts`); bỏ `useRetryExecution`; thêm `useDisableConnection`, `useWorkflowNames`.
- Màn hình (tối thiểu): workflows, workflow detail, executions, execution detail (chuyển thành `[workflowId]/[executionId].tsx`, bỏ nút Retry, thêm màn `lookup/[executionId].tsx`), home, connections, AI generator (xử lý union `ready/needs_input/unsupported`), profile (bỏ mục Telegram), `StatusBadge` (WAITING/ACTIVE/INVALID).
- Test cập nhật: `notification.target.test.cjs`, `run-workflow.session.test.cjs` theo route mới.
- i18n: thêm khóa vi + en cho chuỗi mới; bỏ `profile.tg*`.

## 5. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Type check | `cd apps/mobile && npx tsc --noEmit -p .` | PASS (0 lỗi) |
| Test node | `node --test $(find src -name "*.test.cjs")` (từ `apps/mobile`) | 125 pass, 0 fail (gồm 11 file contract/mapper mới + `gateway.repositories.test.cjs`) |
| Diff | `git diff --check` | PASS |
| GitNexus | `node .gitnexus/run.cjs detect-changes --scope all --repo .` | Chạy trước mỗi commit, risk low (index cũ, ký hiệu `Execution` mobile MEDIUM: 5 caller trực tiếp đều là màn hình đã sửa) |

Chưa kiểm tra: chạy app thật với gateway (Expo Web/thiết bị); stream SSE thật bằng `expo/fetch` trên thiết bị; polling 2 s execution; nhập input JSON.

## 6. Rủi ro và việc tiếp theo

- Stream `expo/fetch` chưa thử trên thiết bị. Nếu `response.body` không stream, vẫn chạy (đọc cả text) nhưng sự kiện đến cùng lúc.
- Danh sách workflow hiện lấy trang đầu (tối đa 100); màn UI sau này dùng infinite scroll.
- `findWorkflowIdForExecution` chỉ dò 50 workflow đầu; execution của workflow ngoài nhóm đó không mở được từ notification.
- Chưa có API nối cho tạo/lưu nháp/publish/xóa workflow (AI Generator "Lưu nháp" vẫn chỉ điều hướng).
- Bước 5 (design tokens, component nền) và bước 6 (thiết kế lại từng màn, màn Assistant) chưa làm.
