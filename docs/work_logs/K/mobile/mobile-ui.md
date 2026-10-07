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

---

## Bước 5: design tokens và component nền (commit "feat(mobile): design tokens and base UI components")

- Một nguồn token: `src/constants/palette.ts` (màu light/dark thuần dữ liệu, test được bằng Node) + `src/constants/theme.ts` (re-export, thêm `Radius`, `Typography`, `MinTouch`, giữ `Colors/Fonts/Spacing`). `useThemeColors` giữ nguyên toàn bộ khóa cũ (không sửa caller), thêm `onPrimary`, `skeleton`, `overlay`, `tones`. Màu `primary` đổi từ tím sang xanh dương (không dùng tím/gradient).
- Bảng màu trạng thái: 5 tone (neutral/info/warning/success/danger). `status.ts` (thuần): `statusInfo()` -> {tone, icon lucide, labelKey}, `formatDuration`, `shortId`, `truncateJson`. 15 trạng thái (execution/node/workflow/connection) + UNKNOWN; nhãn thân thiện vi/en (`status.*`, `ui.*`, `ui.error.<code>`).
- Component mới trong `src/components/ui/`: StatusBadge (viết lại: icon + nhãn i18n), ListItem, EmptyState, ErrorState (thông điệp theo `ApiError.code`, requestId nhỏ, nút thử lại), Skeleton (reduced-motion), Sheet (RN Modal), NodeTimeline, JsonViewer, OfflineBanner (`@react-native-community/netinfo` đã cài).
- Test: `status.test.cjs`, `palette.contrast.test.cjs` (tương phản >= 4.5 cả light/dark cho chữ trạng thái, chữ thường, nút primary).
- Kiểm tra: `npx tsc --noEmit -p .` sạch; `node --test` 132 pass (trước 125); `expo export --platform web` (mock) bundle OK; chưa chụp màn hình hay duyệt bằng mắt.
- Rủi ro: `useThemeColors` impact CRITICAL (20 caller) nhưng shape giữ nguyên, chỉ đổi giá trị màu. Component mới chưa màn hình nào dùng (bước 6); OfflineBanner chưa gắn vào layout.

---

## Bước 6, làn A: màn Workflows và Executions (commit "feat(mobile): redesign workflows and executions screens")

- Màn hình: tab Quy trình (infinite scroll `size=20`, ô tìm kiếm không phân biệt dấu, chip trạng thái, ghi chú giới hạn "chỉ áp dụng cho n/N đã tải", kéo để làm mới); chi tiết quy trình (trạng thái, Điều kiện kích hoạt với lý do và gợi ý sửa cho đủ 9 `reasonCode`, danh sách bước dọc theo cạnh, lịch sử chạy, Chạy ngay/Tạm dừng/Tiếp tục/Xuất bản/Xóa); chi tiết lượt chạy (timeline node có nhãn từ definition, thử lại từng lần, log phân trang + lọc mức độ, poll 2 s tới trạng thái cuối, "Chạy lại workflow" khi PUBLISHED); tab Lịch sử (gộp client, lọc trạng thái + quy trình, tên quy trình join từ danh sách workflow).
- Repository: thêm `createWorkflow`, `saveDraft`, `publishWorkflow`, `deleteWorkflow` (+ DTO, mapper, contract, test; test qua `gateway.repositories.test.cjs`). Công khai secret webhook chỉ qua `PublishResultSheet` (state cục bộ, `mutation.reset()` khi đóng, không lưu/không log). Chưa có `expo-clipboard` nên secret là text chọn được.
- Quyền: `useWorkflowPermissions` đọc bản ghi của chính mình từ `GET members?search=<email>` (OWNER có đủ quyền). Pause/Resume/Xóa cần `canManageWorkflowState`, Xuất bản cần `canPublishWorkflow`; chưa tải xong thì ẩn.
- Run: `Idempotency-Key` mới mỗi lần bấm; giữ nguyên key chỉ khi lỗi 504/timeout (repo đã tự thử lại đúng 1 lần cùng key); đổi input thì đổi key. Input JSON được kiểm tra (rỗng = `{}`, phải là object).
- Dùng chung: `ScreenHeader`, `FilterChips`, `ListSkeleton`, `ConfirmSheet` (Alert không chạy trên web), `OfflineBanner` gắn vào layout `(app)`, `ErrorState` suy thông điệp theo `code` rồi theo HTTP status (backend trả `RESOURCE_NOT_FOUND` cho 404) và ẩn nút Thử lại ở 403. i18n mới ở `stores/i18n.workflows.ts` (vi + en, có test đủ khóa).
- Sửa kèm: `Fonts.mono` trên web là `var(--font-mono)` nhưng `global.css` không được nạp nên mono rơi về serif; đổi sang danh sách font cụ thể. `run-workflow.session.test.cjs` bỏ `WorkflowsScreen` (tab list không còn nút chạy) và cập nhật toast lỗi (đã i18n, không lộ message thô). `useRunWorkflow` nhận thêm `idempotencyKey`.
- Tài khoản thử trên stack local: `mobile-ui-1791389491708@example.test` (chủ không gian "Không gian thử Mobile"), `mobile-ui-member-1791390757989@example.test` (MEMBER không có quyền xuất bản/quản lý trạng thái). Đã xóa toàn bộ workflow thử; tài khoản và workspace còn lại (không có API xóa trong phạm vi này).

### Kiểm tra

| Hạng mục | Kết quả |
| --- | --- |
| `npx tsc --noEmit -p .` | PASS |
| `node --test $(find src -name "*.test.cjs")` | 136 pass, 0 fail (trước 132; thêm contract/mapper/repo, helper, error key; bỏ 6 ca của `WorkflowsScreen`) |
| `git diff --check` | PASS |
| Expo Web trên `:5173` (`EXPO_PUBLIC_API_MODE=http`, gateway `localhost:3000`) + Playwright | Đăng ký/đăng nhập, danh sách phân trang (20 + "Tải thêm" -> 26), tìm kiếm/lọc, chi tiết, Chạy ngay (JSON sai bị chặn, JSON đúng -> 202 -> màn lượt chạy), poll 2 s (khoảng 2,4 s giữa các GET, dừng khi `SUCCESS`), lượt chạy `FAILED` với attempts/log, Pause/Resume, Xuất bản (draft + sheet secret một lần), Xóa, tab Lịch sử (lọc), 404, banner ngoại tuyến, MEMBER bị ẩn nút. Không có lỗi console ngoài các 404 chủ ý |
| Route đã gọi | `GET/POST /api/v1/workspaces/:id/workflows[...]` (list, detail, pause, resume, publish, DELETE 204, executions list/detail, POST executions 202), `GET members`, `GET workspaces`; không có route lạ |
| Ảnh chụp | `apps/mobile/docs/screens/` (sáng + tối) |

### Phát hiện, rủi ro, việc chưa làm

- `POST` không body mà kèm `content-type: application/json` bị gateway trả 400 ("Body cannot be empty"); axios của app không gửi content-type khi không có body nên pause/resume/publish/delete chạy được.
- Gateway/zod `.strict()`: `description` phải là chuỗi hoặc vắng mặt (không nhận `null`); publish bắt buộc có node `trigger.manual` (`MANUAL_TRIGGER_REQUIRED`).
- Tab Lịch sử gộp từ 20 workflow ĐẦU của danh sách (sắp theo `createdAt` giảm dần, không phải theo hoạt động): workspace có hơn 20 workflow mới hơn thì lượt chạy của workflow cũ không hiện. Đây là giới hạn của cách gộp theo brief; cần endpoint toàn workspace.
- Chưa kiểm chứng: kéo để làm mới bằng cử chỉ, cuộn tới cuối tự tải trang (đã kiểm chứng bằng nút "Tải thêm"), cỡ chữ lớn (Dynamic Type), thiết bị thật. `Alert` không dùng (không chạy trên web).
- Nhánh hiện tại là `feature/mobile` (brief ghi `feature/mobile-ui`).
