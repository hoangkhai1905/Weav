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

---

## Bước 6, làn B: Trang chủ, AI Generator, Trợ lý AI (commit "feat(mobile): dashboard, AI generator and assistant screens")

- **Trang chủ** (`(tabs)/index.tsx`, `features/dashboard/`): đổi không gian làm việc ngay ở đầu trang (Sheet), chuông thông báo, hai lối tắt (Trợ lý, Tạo bằng AI). Thẻ tổng quan tính phía client (`dashboard.stats.ts`, có test): số quy trình theo trạng thái, tỉ lệ thành công, đang chạy/chờ, bị lỗi. Nhãn trung thực: "trong N lượt chạy gần nhất", có dòng ghi chú "không phải thống kê theo ngày hay tuần". "Cần chú ý": 3 lượt FAILED mới nhất, trigger DISABLED (dùng lại `trigger.reason.*` của làn A), connection INVALID. Trigger chỉ có ở chi tiết quy trình nên chỉ kiểm tra tối đa 10 quy trình đã xuất bản (`TRIGGER_CHECK_LIMIT`), dùng chung query key `['workflow', ws, id]` với màn chi tiết. Có skeleton, empty, ErrorState, 403.
- **AI Generator** (`ai/generator.tsx`, `features/ai/`): ô mô tả (<= 4000 ký tự, bộ đếm, 3 gợi ý), màn chờ có các giai đoạn theo thời gian + đồng hồ (route chậm tới ~80 s; các giai đoạn là ước lượng theo giây, không phải tiến độ thật của backend). `needs_input`: mỗi mã câu hỏi một control: URL (kiểm tra http/https), SCHEDULE (chọn Mỗi giờ/ngày/tuần/tháng + giờ/phút, không gõ cron), TIMEZONE (mặc định múi giờ thiết bị), VALUE (nhãn thân thiện theo tên trường: subject, body, to...), CONNECTION (chọn trong kết nối ACTIVE + `canAttach` đúng provider). Gửi lại prompt kèm `answers` / `connections` cộng dồn qua các vòng. `unsupported`: lý do dễ hiểu + gợi ý viết lại. `ready`: xem trước dạng danh sách dọc (`FlowList`), sửa tên, "Lưu bản nháp" = `POST` tạo rồi `PUT draft` (kèm `editorState.nodes[id] = {name, position}` để web hiển thị tên bước; nếu `PUT` lỗi thì giữ `workflowId` để thử lại không tạo trùng), rồi "Xuất bản ngay" nếu `canPublish` (secret webhook hiện một lần qua `PublishResultSheet`).
- **Định dạng câu trả lời SCHEDULE**: backend ghép `answers` vào prompt rồi để model hiểu (prompt định nghĩa cron 6 trường "giây phút giờ ngày tháng thứ"). Mobile gửi câu mô tả + cron, ví dụ `Mỗi thứ sáu lúc 17:30 (cron: 0 30 17 * * FRI)`. Ngày trong tháng chỉ 1-28.
- **Trợ lý AI** (`assistant/index.tsx`, `assistant/chat.tsx`, `features/assistant/`): danh sách hội thoại, câu hỏi nhanh, mở lại hội thoại, xóa (xác nhận). Chat qua `HttpAssistantRepository.chat` (SSE, `expo/fetch`); `applyAssistantEvent` gom `delta/tool_call/draft/done/error` (có test). Định dạng tối thiểu: **đậm**, `code`, dòng gạch đầu dòng/đánh số, không thêm thư viện. Sự kiện `draft` hiện thẻ đề xuất với nút lưu thành bản nháp (không lưu tự động). Lối vào: Trang chủ và nút trên tiêu đề tab Lịch sử (giữ 5 tab).
- Chung: `components/ui/Button.tsx` (44 pt), `features/common/timezone.ts`, i18n `stores/i18n.ai.ts` (vi + en, có test đủ khóa và placeholder). Sửa lỗi phát hiện khi chạy web: nút xóa lồng trong `ListItem` (button trong button) nên tách thành phần tử anh em.

### Kiểm tra (làn B)

| Hạng mục | Kết quả |
| --- | --- |
| `npx tsc --noEmit -p .` | PASS |
| `node --test $(find src -name "*.test.cjs")` | 154 pass, 0 fail (trước 136; thêm dashboard.stats, schedule, ai.answers, assistant.chat, i18n.ai) |
| `git diff --check` | PASS |
| Expo Web `:5173` (`EXPO_PUBLIC_API_MODE=http`, gateway `localhost:3000`) + Playwright 390x844, sáng/tối | Đăng nhập, Trang chủ có dữ liệu + trống + đổi workspace + 403; AI Generator thật: 2 vòng `needs_input` (URL, SCHEDULE, VALUE) rồi `unsupported` (INVALID_INTENT), một prompt khác ra `ready` -> Lưu bản nháp (POST 201 + PUT 200) -> Xuất bản; Trợ lý thật: gửi 2 tin, trả lời, mở lại lịch sử, xóa (204). Không có lỗi console ngoài 2 cảnh báo deprecate của react-native-web (`shadow*`, `pointerEvents`) |
| Route đã gọi | `POST /api/v1/workspaces/:id/workflows/generate`, `POST .../workflows` (201), `PUT .../draft`, `POST .../publish`, `GET .../workflows[/:id]`, `GET .../workflows/:id/executions`, `GET .../connections`, `GET .../members`, `POST /api/v1/assistant/chat`, `GET /api/v1/assistant/conversations[?workspaceId&limit]`, `GET .../conversations/:id/messages`, `DELETE .../conversations/:id` |
| Kiểm tra UI bằng phản hồi giả (route stub của Playwright, không ghi gì vào backend) | AI thật không lỗi nên 429 `AI_QUOTA_EXCEEDED`, 503 `AI_UNAVAILABLE` (generate và chat), 403 ở Trang chủ, câu hỏi `CONNECTION`/`TIMEZONE` (không phải model nào cũng sinh) được kiểm bằng stub. Payload `answers`/`connections` kiểm đúng: `connections: {"email.send": <uuid>}`, `answers: {"email.send.subject": ..., "trigger.schedule.cron": "... (cron: 0 30 17 * * FRI)"}` |
| Ảnh chụp | `apps/mobile/docs/screens/home-*`, `ai-generator-*`, `assistant-*` (sáng + tối) |

### Dữ liệu thử đã tạo / dọn

- Tài khoản mới `mobile-b-1791392546173@example.test` (tên "Mobile Lane B", không có API xóa tài khoản) với không gian "Không gian thử B". Mật khẩu chỉ nằm trong file tạm đã xóa. Đã xóa mọi quy trình (5, gồm 2 do AI tạo) và hội thoại tạo khi thử; tài khoản và không gian còn lại. Tài khoản/không gian của làn A giữ nguyên (mật khẩu của làn A không được ghi lại nên không dùng lại được).

### Phát hiện, rủi ro, việc chưa làm

- Backend chưa có endpoint tổng hợp: Trang chủ phụ thuộc cách gộp client (<= 20 quy trình x 10 lượt) và <= 10 lần `GET workflow` để kiểm trigger (N+1).
- Cuộc gọi generate chưa hủy được khi người dùng rời màn hình (mutation không truyền `AbortSignal`); đang chờ tối đa 85 s.
- Các giai đoạn trên màn chờ AI chỉ là ước lượng theo giây.
- Tên bước ở câu hỏi VALUE/URL dùng id nút do model đặt (ví dụ "read revenue") khi không khớp loại nút nào.
- Thanh tab dưới cùng bị cắt nhãn trên web 390x844 (có sẵn từ trước, không thuộc làn B).
- Chưa kiểm: thiết bị thật, stream từng chunk của `expo/fetch` trên native, Dynamic Type, kéo để làm mới bằng cử chỉ.
