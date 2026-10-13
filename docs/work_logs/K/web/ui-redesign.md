# Nhật ký: Thiết kế lại giao diện web (ui-redesign)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-10-05 |
| Nhánh | `claude/youthful-thompson-7gz34q` (nền: `6a9d333` WIP restyle) |
| Người thực hiện | AI agent (Claude) |
| Trạng thái | Đang tiếp tục (phase 1 đến 6 đã có commit; còn các hạng mục ở mục 11) |
| Phạm vi | Áp dụng bộ thiết kế đã duyệt (Tokens, Workflows, Editor, Executions/Runs, Connections) lên `apps/web` |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Ánh xạ token mới lên tên biến shadcn hiện có (`--background`, `--primary`, `--border`...) và thêm token `ok/warn/err/run/pause/t-*` | Toàn app đổi palette mà không sửa từng component | Class cũ (`bg-brand-gradient`, `shadow-brand`, `page-hero-glow`) vẫn chạy nhưng đã phẳng |
| Chuyển `slate/rose/amber/emerald...` cứng trong builder, executions, ConfirmModal sang token bằng codemod (script nằm trong scratchpad, không commit) | Dark mode và palette đồng nhất, ít diff thủ công | Các trang khác (Dashboard, Workspace, Settings, AI, Telegram) chưa codemod; vẫn dùng được nhờ token nhưng còn màu cứng |
| Workspace switcher chuyển lên sidebar, giữ `<select>` native và mọi testid `topbar-workspace-*` | Giữ hành vi/test hiện có | Topbar chỉ còn breadcrumb, ngôn ngữ, theme, thông báo, avatar; bỏ ô tìm kiếm toàn cục (không nơi nào dùng) |
| Danh sách quy trình: số liệu 7 ngày, lần chạy gần nhất, badge Lỗi suy ra từ `executionApi.getExecutions()` (best effort, tối đa 50 quy trình) | API quy trình không có các trường này | Nếu API lỗi thì hiển thị `—`; cột Người sở hữu chỉ hiện khi API trả `ownerName` |
| Xóa quy trình vẫn chỉ bật trong mock mode, hộp xác nhận gõ `xóa N` | Workflow Service V1 chưa có endpoint xóa | Test bulk-delete được cập nhật để gõ cụm xác nhận |

## 3. Thay đổi theo phase

| Phase | Commit | Nội dung chính |
| --- | --- | --- |
| 1. Tokens | `ce56963` | `index.css`: palette sáng/tối, token trạng thái và loại bước, radius 6-8px, Geist Mono, helper gradient/glow thành phẳng |
| 2. Shell | `3fbf8a8` | Sidebar 220px, `WorkspaceSwitcher`, Topbar rút gọn |
| 3. Quy trình | `84599f8` | Bảng dày 40px, segmented filter, bulk bar, `TypedConfirmDialog`, `StatusBadge`, trạng thái trống/đang tải/lỗi |
| 4. Editor | `b721524` | Header 48px, node phẳng 232px có dải loại bước, edge/minimap/controls, inspector theo token |
| 5. Lượt chạy | `37af20d` | `LiveWorkflowExecutionsPage` theo Runs.dc; các trang execution khác map token |
| 6. Kết nối | commit cuối | `ConnectionsPage` dạng danh sách phẳng, badge trạng thái, dialog tạo mới theo thiết kế |

## 4. File chính bị ảnh hưởng

`apps/web/src/index.css`, `components/layout/{Sidebar,Topbar,WorkspaceSwitcher,AppLayout}.tsx`, `components/common/{StatusBadge,statusBadgeClass,TypedConfirmDialog,ConfirmModal}.tsx`, `components/workflows/WorkflowGlyph.tsx`, `components/builder/*`, `pages/{WorkflowsPage,WorkflowBuilderPage,ExecutionsPage,ExecutionDetailPage,LiveExecutionDetailPage,LiveWorkflowExecutionsPage,ConnectionsPage}.tsx`, `lib/i18n/translations.ts`, `e2e/workflow-ui.spec.ts` (gõ cụm xác nhận khi xóa hàng loạt), `package.json` (+`@fontsource-variable/geist-mono`).

## 5. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Type check | `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | PASS sau mỗi phase |
| Build | `pnpm --dir apps/web build` | PASS |
| Lint | `pnpm --dir apps/web exec eslint <file đã sửa>` | Chỉ còn lỗi `set-state-in-effect` / `no-useless-assignment` đã có từ trước (WorkflowsPage, LiveWorkflowExecutionsPage, WorkflowBuilderPage) |
| E2E | `VITE_API_MODE=http npx playwright test -c playwright.local.config.ts workflow-ui workspace-connections localization dashboard-real-data workflow-catalog-v1` | 35 failed / 45 passed, trùng tập lỗi baseline; toàn bộ workspace-connections PASS |
| Ảnh chụp | script Playwright (chromium) ở chế độ mock | Sáng/tối cho Quy trình, Editor, Lượt chạy, Kết nối; 0 lỗi console |

## 5b. Phiên tiếp theo: editor toàn màn hình, chi tiết lượt chạy 3 cột, API thật

- Trang editor (`/workflows/:id`, `/builder`) và trang lượt chạy (`/workflows/:id/executions`, `/executions/:id`, chỉ khi không ở mock mode) ẩn Topbar, sidebar thu thành rail 56px, không padding; canvas chiếm toàn bộ phần còn lại.
- Bỏ palette trái cố định; thêm bảng "Thêm bước" (nút nổi trên canvas hoặc Ctrl/⌘+K, Esc đóng) dùng cùng `PALETTE_CATALOG` và `handleAddCatalogItem`. Inspector 400px chỉ khi chọn node, Esc đóng. Log đáy 32px, mặc định thu gọn (tự mở khi xem trước). fitView tối thiểu zoom 0.85.
- `ExecutionsTriPane`: danh sách lượt (API `getExecutions(workflowId)`), bảng bước có waterfall tính từ timestamp, panel Input/Output(Lỗi)/Nhật ký. Input hiển thị thông báo vì service không lưu input từng bước. Không dựng "Chạy lại từ bước" hay mẹo sửa lỗi vì API không có.
- Badge "Lỗi" và tab Lịch sử chạy trỏ tới `/workflows/:id/executions` (trước đây `/executions?workflowId=` bị trang live bỏ qua).
- Xóa quy trình bị ẩn khi không ở mock mode (API chưa có). Chuỗi tiếng Anh còn lại trong builder đã chuyển sang i18n (header, banner, log, nhãn readiness); các nhãn form trong inspector (Left value, Operator...) vẫn là tiếng Anh.
- Settings tab và công tắc Active: bỏ qua vì chưa có endpoint tương ứng trong UI/API. Undo/redo: không có sẵn.
- E2E: `addNode` và các test OCR/catalog mở palette trước; test logs trong `workflow-api-v1` bấm tab Logs. Kết quả 5 spec chính vẫn 35 failed / 45 passed, trùng baseline; `workspace-read-switch` + `ocr-builder` 20 failed / 7 passed, trùng baseline trước phiên này.

## 5c. Sửa 3 lỗi editor

- Header editor: lưới 3 cột (tên quy trình co lại trước, tab ở giữa, hành động bên phải), mọi control `whitespace-nowrap shrink-0`. Hành động: nút icon "Tạo bằng AI" và "Xem trước luồng" (tooltip), 2 nút chữ "Chạy" (khi đã Published) và "Xuất bản", 1 nút chính "Lưu". Ngữ cảnh workspace chuyển thành `sr-only` kèm title (giữ testid). Đã kiểm tra 1440, 1280 và 1024: không xuống dòng, không tràn.
- Node điều kiện: nhãn nhánh Đúng/Sai nằm ngoài node bên phải cạnh handle (testid `condition-port-label-*`), không đè badge "Sẵn sàng".
- Toàn bộ nhãn tiếng Anh trong form inspector (điều kiện, cron, webhook, HTTP, email, Sheets, Telegram, OCR, AI, schema, thông điệp readiness) chuyển sang key `builder.cfg.*` VI/EN; bản EN giữ nguyên chữ cũ nên selector e2e không đổi. Giá trị lưu không đổi.

## 5d. Pan khi mở inspector

- Khi chọn node (click hoặc thêm từ palette) và inspector 400px mở, nếu node + 80px cho nhãn nhánh không nằm trọn trong vùng canvas nhìn thấy (trừ 400px và lề 24px) thì viewport được pan (200ms, 0 khi giảm chuyển động) mà không đổi zoom. Chỉ chạy khi đổi lựa chọn. `fitViewOptions` chừa 424px bên phải khi panel mở; minimap đã dịch trái 412px.

## 5e. Quét chuỗi tiếng Anh khi ngôn ngữ là Tiếng Việt

- Thêm `lib/i18n/tr.ts` (`tr(key)`, `appLocale()`) cho module ngoài React. Toàn bộ thông báo lỗi của API client (workflow, OCR, kết nối, thông báo, auth, workspace), lỗi fallback ở trang Quy trình/Builder/Dashboard/Live executions/AI panel chuyển sang khóa `msg.*`; bản EN giữ nguyên chữ cũ.
- Builder: mô tả/tên node Telegram, lý do chặn xuất bản, nhãn cạnh (aria), ghi chú node không hỗ trợ, badge "Test passed". Toaster có `containerAriaLabel`. Mẫu quy trình (tiêu đề, trigger, tên bước), nhãn trigger của lượt chạy, định dạng ngày theo ngôn ngữ.
- Cố ý giữ tiếng Anh: dữ liệu mock/demo (tên quy trình, log, bước của mock ExecutionsPage/ExecutionDetailPage/AiGenerator), id kỹ thuật (`trigger.schedule`, phương thức HTTP), tên thương hiệu (Gmail, Google Sheets, Telegram, Slack, OCR), mức log (`[ERROR]`), ví dụ placeholder, attribution "React Flow", alt logo "WEAV app logo", thông điệp lỗi backend hiển thị nguyên văn.
- Kiểm tra: quét DOM tiếng Việt qua mock mode cho 24 route/trạng thái và chụp ảnh `vi-*.png`.

## 5h. Vòng 5: picker Sheets, sidebar hover, tab Workspace, menu hàng kết nối

- Inspector Google Sheets: picker kết nối giống Gmail (chỉ liệt kê kết nối Sheets ACTIVE, gợi ý rỗng có link tới Workspace → Kết nối, bỏ `font-mono`); thêm 3 test e2e.
- Sidebar: hover/focus mở rộng dạng overlay (không đẩy nội dung), nút ghim/bỏ ghim; test không dịch layout.
- Header editor: trạng thái "Đang bật" chỉ hiện một lần (chip nháp chỉ khi chưa xuất bản/tạm dừng; nhãn công tắc ẩn dưới lg).
- Workspace tách `/workspace`, `/workspace/members`, `/workspace/settings`; test members/read-switch/notification-integration trỏ lại đường dẫn mới.
- Hàng kết nối: một nút chính + menu "…" (bàn phím: mở, mũi tên, Esc), xóa ở cuối sau đường phân cách.
- Kiểm tra: tsc, build, eslint (chỉ 4 lỗi cũ); Playwright 35 failed / 66 passed đúng tập lỗi baseline; workspace-connections 35/35; workspace-members + read-switch 8 failed / 13 passed như trước (1 test read-switch flaky khi chạy song song). notification-integration "validated targets" lỗi sẵn có.
- GitNexus: LOW; WorkspacePage impact không xác định rõ (index cũ), đã kiểm tra callers bằng grep.

## 5i. Vòng 6: readiness Sheets/Gmail và thêm kết nối từ inspector (7b4d3db, 0178e90)

- Lỗi có từ dev: bước `google.sheets` luôn "Cần ủy quyền" khi đã chọn kết nối. `getNodeReadinessBadge` nhận thêm danh sách id kết nối ACTIVE + canAttach (`useAttachableConnectionIds`, cùng query react-query nên không thêm request). Với Sheets và Gmail: thiếu connectionId hoặc trường bắt buộc (Sheets: spreadsheetId, range; Gmail: to, subject, theo `DefinitionValidator`) → Chưa cấu hình; kết nối không thuộc danh sách → Cần ủy quyền; còn lại → Sẵn sàng. Khi danh sách chưa tải xong thì không gắn "Cần ủy quyền".
- Nhãn trên bước, cảnh báo inspector và điều kiện chặn xuất bản cùng lấy từ `getNodeReadinessBadge`. Thêm khóa `msg_gmail_auth`, `msg_sheets_fields`.
- Nút "+ Thêm kết nối Google Sheets/Gmail" trong inspector mở `CreateConnectionDialog`, tách từ ConnectionsPage và chọn sẵn loại kết nối. Sau khi tạo: gắn connectionId vào bước, lưu nháp, gọi `oauth/authorize`, ghi ngữ cảnh OAuth kèm `returnTo=/workflows/<id>?step=<node>`, rồi chuyển sang Google. Callback ở trang Kết nối chỉ quay về `returnTo` khi kết nối đã được xác minh (success hoặc pending→VERIFIED); nếu thất bại thì ở lại trang Kết nối kèm thông báo. Builder đọc `?step=` để mở lại đúng bước.
- `returnTo` chỉ nhận dạng `/workflows/<id>?step=<node>` (regex trong `lib/oauthPending.ts`), nên không mở được redirect ra ngoài.
- Bước được ghi nhớ ngay lúc mở hộp thoại, vì bấm vào hộp thoại sẽ đóng inspector và xóa lựa chọn.
- Kiểm tra: tsc qua; eslint chỉ còn 2 lỗi cũ của builder; build qua; `git diff --check` sạch. Playwright http, 9 spec chuẩn: 35 failed / 68 passed, đúng 35 lỗi baseline cộng 2 test mới đạt. `workspace-connections` 37/37. GitNexus detect-changes: HIGH (đụng saveDraft/publish/ConnectionsPage), đã có e2e phủ. Impact trước khi sửa: CLI báo `ambiguous/UNKNOWN`, đã xác nhận callers bằng grep.
## 5j. Kiểm tra với stack thật (d2639ee)

- Môi trường: Compose dev đang chạy, Vite 5173 với `VITE_API_MODE=http`, user tự đăng nhập trong Browser pane, workspace "test 1" có sẵn kết nối Gmail và Sheets ACTIVE.
- Đã đạt:
  - bước Sheets với kết nối ACTIVE và đủ trường hiển thị "Sẵn sàng" ở nhãn và inspector, cảnh báo biến mất;
  - lưu nháp 200; xuất bản 200;
  - tắt (có hộp xác nhận) và bật lại: pause/resume 200;
  - "Chạy" chuyển sang Lịch sử chạy; lượt chạy lỗi đúng như dự đoán với ID bảng tính placeholder ("The Google Sheets provider rejected the request.");
  - mô tả xóa trắng lưu được (lưu "" rồi tải lại vẫn ""), tức mục tồn này không còn lỗi;
  - 20 lần chuyển trang trong 24 giây: 47 request API, không có 429 hay lỗi 4xx/5xx.
- Lỗi tìm thấy và đã sửa:
  - Bước Sheets thêm từ bảng "Thêm bước" không bao giờ lưu được: catalog đặt sẵn `sheetName/rowDataVariable/valueVariable`, backend trả 400 `UNKNOWN_CONFIG_FIELD`. Nay chỉ còn `connectionId/operation/spreadsheetId/range`; append/update nhập `values` (mảng JSON các hàng, báo lỗi khi JSON sai), readiness yêu cầu có `values`. Đã bỏ 3 khóa dịch cũ.
  - "Thêm bước" đặt bước mới chồng lên trigger và không nối, nên xuất bản lỗi `UNREACHABLE_NODE`. Nay bước mới đặt bên phải bước đang chọn (hoặc bước ngoài cùng bên phải) và tự nối nếu bước đó có một cổng ra còn trống. Thêm điều kiện chặn xuất bản phía web với cùng quy tắc.
  - Lỗi 400 của workflow API giờ hiện thêm chi tiết đầu tiên, thay vì chỉ "Workflow definition is invalid".
  - Lịch sử chạy: bước chưa có `startedAt` gây sắp xếp sai (NaN) khi lượt đang chạy; nay xếp cuối.
- Kiểm tra: tsc, build, `git diff --check` qua; eslint còn 1 lỗi cũ. Playwright 9 spec chuẩn: 35 failed / 70 passed (baseline + 4 test mới, tất cả lỗi nằm trong 4 spec baseline). GitNexus: MEDIUM.
- Chạy Sheets thật (spreadsheet của user, thao tác Đọc): với vùng `Sheet1!A1:Z100` lượt chạy lỗi `HTTP_BUSINESS_REJECTED`, vì tab của tài khoản tiếng Việt tên "Trang tính1". Đổi sang `A1:Z100` thì lượt `bd0ac9dc` thành công (bước Sheets 1.5 s). Vùng mặc định của catalog đổi thành `A1:Z100` (tab đầu tiên). Ở 800px, Lịch sử chạy chỉ hiện 2 cột; cột chi tiết bước cần màn rộng hơn.
- Thêm kết nối từ inspector với Google thật (2026-10-06): bấm "+ Thêm kết nối Google Sheets" ở bước Sheets, tạo kết nối "test sheet", nháp được lưu, chuyển sang Google, user tự đồng ý. App quay về `/workflows/193e559c…?step=node-6`, bước đã chọn sẵn kết nối mới (ACTIVE), nhãn "Sẵn sàng", không còn cảnh báo.
- Ghi vào Sheets dễ dùng hơn (2026-10-06):
  - Bảng tính vẫn trống sau khi user đổi sang "Thêm nội dung" và bấm Chạy. Nguyên nhân: lượt chạy dùng phiên bản đã xuất bản (vẫn là "Đọc"), còn thay đổi mới chỉ nằm trong bản nháp. Nay khi còn thay đổi chưa lưu, hoặc bản nháp sửa sau `publishedAt`, nút Chạy thành "Xuất bản và chạy" và xuất bản trước khi chạy (`publishedAt` được map từ API).
  - Bỏ ô JSON `values`; thay bằng trình nhập một dòng theo từng cột ("Cột A/B…", lấy chữ cột theo vùng dữ liệu), có "+ Thêm cột", xóa cột, gợi ý biến `{{ trigger.input.x }}` và `{{ id-bước.output.x }}`. Các dòng khác trong `values` (nếu có) được giữ nguyên. Gợi ý "Vùng dữ liệu" đổi theo thao tác Đọc/Thêm/Cập nhật. Readiness yêu cầu ít nhất một ô không rỗng.
  - Stack thật: "Xuất bản và chạy" tạo phiên bản mới `2a485583`; lượt `a5f97fa4` thành công, Google trả `updatedRange 'Trang tính1'!A1:C1`, 1 dòng 3 ô.
  - Kiểm tra: tsc, build qua; Playwright 9 spec chuẩn 35 failed (baseline) / 73 passed; `workspace-connections` 42/42. Commit `1510cb1` từng làm build lỗi vì test dùng `document` không có kiểu DOM; đã sửa.
- Rà tương phản dark/light (2026-10-06): đoạn script trong Browser pane tính tỉ lệ WCAG từ màu đã render (có hòa trộn alpha), quét 16 route ở cả hai theme. Có 4 vi phạm, đã sửa: dấu "/" breadcrumb ở Tạo quy trình (2.05/2.37, nay `aria-hidden` như Topbar), badge "Bản thử nghiệm" (3.04 tối) và link "Mở nội dung liên quan" ở Thông báo (3.44 tối) đổi sang `text-accent-ink`, badge "AI TẠO" (3.81 sáng) đổi lớp phủ sang `bg-black/20`. Quét lại: 0 vi phạm. Chưa quét: hộp thoại, trạng thái hover/lỗi/rỗng, mock mode.
- Mock mode dùng bố cục lượt chạy mới (2026-10-06): `ExecutionsTriPane` đọc qua `executionApi`, vốn đã có nhánh mock, nên route `/workflows/:id/executions` và `/executions/:id` trỏ thẳng tới `LiveWorkflowExecutionsPage`/`LiveExecutionDetailPage`. Đã xóa `ExecutionsPage.tsx` và `ExecutionDetailPage.tsx` (2.171 dòng, chỉ `App.tsx` import) cùng 80 khóa dịch `executions.*` không còn dùng (×2 ngôn ngữ). API mock nay lọc lượt chạy theo workflowId. Sửa thêm: "Kích hoạt" hiện nguyên khóa `runs.trigger_type.trigger.webhook` với dữ liệu mock, nay bỏ tiền tố `trigger.` trước khi tra. Kiểm tra tay trên Vite mock (cổng 5174, đã tắt): `/executions/exec-101` chuyển sang `/workflows/wf-001/executions?run=exec-101`, 3 cột, 2 lượt của wf-001. Playwright 9 spec chuẩn 35 failed (baseline) / 73 passed; GitNexus LOW.
- XONG (2026-10-06) — Xóa quy trình:
  - `DELETE /workspaces/{ws}/workflows/{id}` trong `packages/contracts/http/workflow/openapi.yaml`; `WorkflowPublicationService.delete` (capability `WORKFLOW_MANAGE_STATE`, khóa hàng, tắt trigger hiện tại, `Workflow.delete` → `deleted_at/deleted_by`, không migration) và `@DeleteMapping` trong `WorkflowController`; gateway route `@Delete(':workflowId')` + spec; web `workflowV1Api.deleteWorkflow` thật, mở khóa xóa ở trang danh sách (bỏ gate mock), xóa 2 khóa dịch "chưa có API".
  - Kết nối: phiên bản đã xuất bản của quy trình đã xóa vẫn tính là đang dùng kết nối (quyết định của user 2026-09-21, `ConnectionReferenceAdapter.inUse`); chỉ bản nháp được giải phóng. Acceptance test ban đầu khẳng định ngược lại nên lỗi; đã sửa test (`deleteHidesTheWorkflowAndStopsItsTriggers`), Javadoc và mô tả OpenAPI cho đúng.
  - Lỗi tìm thấy trên stack thật: menu "…" của hàng bị ô bảng (`overflow-hidden`) cắt, không bấm được "Xóa…". Ô thao tác nay không còn `overflow-hidden`; e2e kiểm `elementFromPoint` của mục menu (không có bản sửa thì lỗi, có thì đạt).
  - Kiểm tra: stack thật (Vite 5173 + Gateway + Workflow Service), tạo quy trình thử `b469fc75…` rồi xóa qua UI: DELETE 204, hàng biến mất (22→21), GET sau đó 404, không lỗi console. Java chạy trong `eclipse-temurin:25-jdk` (máy chỉ có JDK 21): `WorkflowV1AcceptanceTest` 4/4; `mvnw verify` 495 test, chỉ 3 lỗi môi trường đã biết. Gateway jest 6/6, build qua. Web tsc, build qua; `workspace-connections` 43/43; `workflow-ui` 25 lỗi, trùng y hệt khi chạy trên HEAD không có thay đổi (baseline). GitNexus detect-changes: CRITICAL (đụng `WorkflowPublicationService`/`WorkflowController`, luồng pause/publish); đã có acceptance + toàn bộ verify phủ.
  - Môi trường: gateway và notification ở chế độ `nest --watch` bị OOM với `mem_limit` 384m/512m sau khi build lại; user đồng ý tăng: `compose.dev.yml` nay gateway 768m (~590 MiB khi chạy), notification 1g (~650–680 MiB); cả hai healthy, 0 lần restart. Ổ C còn ~4,7 GB; 167 image `weav-task10-*` không container nào dùng, user đồng ý xóa nhưng hook chặn lệnh docker mutating nên user tự chạy.
  - Timezone: không làm; timezone đã nằm trong từng bước schedule. Chờ user nói rõ nếu cần khác.
- Đăng nhập bị out (chưa sửa, chờ user đồng ý): access 15m, refresh 7d. Email/mật khẩu: refresh token chỉ giữ trong bộ nhớ tab (`sessionRefreshToken`), mất khi tải lại. Google: cookie còn hạn nhưng cờ `weav_google_oauth_session_v1` và CSRF nằm trong sessionStorage nên mất khi đóng tab. Đề xuất: chuyển cờ + CSRF Google sang localStorage; email cần identity phát cookie httpOnly như Google.
- Dữ liệu thử để lại trên Neon: quy trình `193e559c-44da-4ba9-9419-98698b014103` ("Untitled Automation Pipeline", đã xuất bản, 3 lượt chạy: 2 lỗi, 1 thành công) và kết nối Google Sheets "test sheet" (9b4e521a) trong workspace "test 1". Quy trình `193e559c…` đã xóa qua UI theo yêu cầu user (DELETE 204, 21→20, 0 đang bật); kết nối "test sheet" giữ lại. Quy trình thử `b469fc75…` cũng đã xóa mềm.
- Chưa làm / còn lại:
  - Tab "Trình chỉnh sửa" xuống 2 dòng ở header trang lượt chạy khi rộng 800px: đã sửa (nav `shrink-0 whitespace-nowrap`, tên quy trình co lại thay; e2e với tên dài: không có bản sửa thì lỗi, có thì đạt).
- Dashboard (chế độ HTTP) dùng số liệu lượt chạy thật (2026-10-06): 4 ô "chưa khả dụng" thay bằng "Lượt chạy · 7 ngày", "Tỉ lệ lỗi · 7 ngày" và danh sách 6 lượt gần nhất (bấm mở đúng lượt ở trang lịch sử). Dashboard và trang Quy trình dùng chung một truy vấn lượt chạy (`fetchRecentExecutions`, key `workflowRunStatsKey`, tối đa 10 quy trình × 3 song song), mỗi trang tự tính bằng `select`, nên đi qua cả hai trang không tốn thêm request (`request-budget`: 19 < 25; trước khi dùng chung thì vượt). Helper `formatRelativeTime` tách ra từ WorkflowsPage. Kiểm tra: tsc, build, eslint (lỗi `setState` trong effect ở WorkflowsPage có sẵn); stack thật: 2 lượt, 0%, link mở đúng lượt; Playwright `dashboard-real-data` (cập nhật assertion), `request-budget` đạt, `localization`/`navigation-structure` lỗi trùng baseline. Phát hiện: `/ai/workflow-generator` (`AiGeneratorPage`) chỉ là demo `setTimeout`, không gọi API, nhưng vẫn được dẫn tới ở chế độ HTTP; chờ user chọn hướng.
- Đã sửa sau đó: header editor dưới `lg` dùng cột `minmax(0,1fr)_auto_auto` để tên quy trình co lại thay vì các nút tràn đè lên tab (e2e ở 800px, tiếng Việt, quy trình đã xuất bản: không có bản sửa thì lỗi, có bản sửa thì đạt). `ConfirmModal` có `role="alertdialog"`, `aria-modal`, liên kết tiêu đề và mô tả, nhãn nút đóng, tự focus nút Hủy, Esc để đóng.

## 6. Khôi phục sau merge và đổi chữ "workflow" (aa8e7b9)

- Merge `d4fa9f4` (sau khi viết lại tên tác giả) giữ phía chưa dịch khi gặp xung đột, làm mất key i18n trong `translations.ts`, chuỗi đã dịch trong `WorkflowBuilderPage.tsx` và mục work log của `7d79d27`. Đã khôi phục 3 file này từ `7d79d27`.
- Đổi "Tất cả workflow" → "Tất cả quy trình", thông báo chạy lại và `dashboard.ai_unavailable` sang "quy trình".
- Kiểm tra: tsc, build, `git diff --check` qua; Playwright http (5 spec chính + workflow-api-v1) 35 failed / 49 passed, đúng tập lỗi baseline; GitNexus detect-changes: critical vì đổi module dịch dùng chung.

## 7. Rủi ro và chưa làm

- Tab Cài đặt, công tắc bật/tắt quy trình, undo/redo, "chạy lại từ bước" và gợi ý cách sửa: chưa có API backend.
- Chưa kiểm tra với backend thật đang chạy; ảnh chụp dùng response giả lập theo kiểu API thật.
- Dashboard, Workspace, Settings, AI, Telegram, Notifications, Help: đã quét tương phản tự động (5j), chưa rà bố cục bằng mắt.
- Còn tiếng Anh có chủ đích: dữ liệu mẫu, mã kỹ thuật, tên thương hiệu, ví dụ placeholder, lỗi gốc từ backend.

## 8. Việc tiếp theo

1. Chạy thử với stack thật (Compose dev) và kiểm tra editor, lịch sử chạy, kết nối.
2. Rà soát giao diện các trang còn lại ở light/dark.
3. Thêm công tắc kích hoạt và tab Cài đặt khi backend có API.

## 9. Dọn UI/UX theo Todo Notion (2026-10-11, nhánh `feature/web-ui-ux-cleanup`)

Nguồn: mục "UI/UX" trong trang Notion KLTN > Todo. Chỉ sửa `apps/web`, không đụng backend.

| Việc trong Todo | Đã làm | File chính |
| --- | --- | --- |
| Màu role xấu | Badge Member chữ xám trên nền xám (`bg-muted-foreground text-text-2`) → `bg-muted`; Owner đổi từ màu lỗi đỏ sang `run` (xanh), không xuống dòng | `pages/WorkspacePage.tsx` |
| Hai chỗ Notification | Bỏ mục "Trung tâm thông báo" ở sidebar, giữ chuông ở topbar (có số chưa đọc) | `layout/Sidebar.tsx` |
| Tab Telegram ở sidebar | Bỏ mục sidebar và xóa `TelegramPage`; `/telegram` chuyển hướng sang `/workspace/connections` (link cũ trong thông báo vẫn mở được). Danh sách bot đã có ở Kết nối, các bước tạo bot chuyển vào hướng dẫn | `App.tsx`, `pages/TelegramPage.tsx` (xóa) |
| AI Generator ở sidebar → modal | Bỏ khỏi sidebar; mọi nút "Tạo bằng AI" (Dashboard, Quy trình, Tạo quy trình, Trợ giúp) mở `AiGeneratorDialog` qua `useUIStore.openAiGenerator(prompt?)`. Route `/ai/workflow-generator` giữ nguyên cho link cũ. `TemplateDialog` thêm prop `wide` | `components/ai/AiGeneratorDialog.tsx`, `pages/AiGeneratorPage.tsx`, `store/useUIStore.ts` |
| Đổi logo | Logo SVG phẳng mới (W là một luồng node trên nền primary) cho topbar, trang đăng nhập/đăng ký và favicon; PNG cũ giữ trong `public/` | `public/weav-logo.svg`, `common/Logo.tsx`, `index.html` |
| Tạo connection trực quan hơn | Dropdown dịch vụ → lưới thẻ có icon (radio, testid `connection-provider-<PROVIDER>`), kèm hướng dẫn từng bước có hình minh họa dựng bằng CSS (chat BotFather, ô URL webhook, màn hình cho phép của Google) | `pages/ConnectionsPage.tsx`, `components/connections/ConnectionGuide.tsx` |
| Nút "?" ở node webhook/bot | Header inspector có nút "?" cho `trigger.telegram`, `telegram.send_message`, `discord/slack/teams.send_message`, `trigger.webhook`; mở cùng `ConnectionGuide` (webhook: POST `/api/v1/webhooks/<endpoint key>` + header `X-Webhook-Secret`) | `pages/WorkflowBuilderPage.tsx` |
| Định dạng email/tin nhắn | Thanh B / I / link (email thêm danh sách, xuống dòng) trên ô nội dung. Email tự chuyển `bodyType` sang `html`; Telegram tự bật `parseMode: HTML` (nếu user chọn MarkdownV2 thì chèn cú pháp MarkdownV2); Discord Markdown, Slack mrkdwn. 4 template email đổi sang HTML | `builder/FormatToolbar.tsx`, `lib/formatInsert.ts` (+ `formatInsert.test.mjs`), `builder/MappingTextField.tsx`, `builder/SchemaField.tsx`, `lib/templates/index.ts` |

Quyết định:
- Template Telegram vẫn để text thường (chỉ thêm xuống dòng): biến tự do (dữ liệu fetch, tóm tắt AI, nội dung chuyển khoản) có thể chứa `<` hoặc `&`, mà backend không escape nên Telegram sẽ từ chối cả tin ở chế độ HTML.
- Hướng dẫn dùng hình minh họa dựng bằng HTML/CSS thay ảnh chụp: theo theme sáng/tối, không phải cập nhật lại khi app bên ngoài đổi giao diện.

Kiểm tra:
- `tsc -p tsconfig.app.json` sạch; `pnpm build` qua; `node --test src/lib/formatInsert.test.mjs` 4/4; eslint trên các file đã sửa: chỉ còn 2 lỗi `set-state-in-effect` có sẵn (`WorkflowsPage:149`, `WorkflowBuilderPage:649`).
- Stack thật (Vite 5173 + Gateway): sidebar còn 5 mục; modal AI mở từ Dashboard; dialog tạo connection (light/dark), thẻ Telegram/Discord kèm hướng dẫn; badge role; builder: bôi đen "test" → B ra `<b>test</b>`, `bodyType` chuyển HTML kèm ghi chú (không lưu); nút "?" ở `trigger.telegram`. Mọi request API 200.
- Playwright: xem mục Kết quả e2e bên dưới.

Còn lại / rủi ro:
- Ô nội dung vẫn hiện thẻ HTML thô (`<b>…</b>`), chưa có xem trước định dạng.
- Thanh định dạng chưa có cho Teams (chưa kiểm cú pháp Adaptive Card).
- Mục "Email/tin nhắn hệ thống" (OTP, lời mời do notification-service gửi) không làm vì thuộc backend.

Kết quả e2e (Chromium, `VITE_API_MODE=http`):
- Branch: honest-pages, navigation-structure, dashboard-real-data, workspace-connections, control-bot, w7-nodes, ai-generator, localization, workflow-ui → 105 pass / 34 fail.
- Baseline `dev` (`32cbe8d`) với control-bot, localization, workflow-ui, workspace-connections → 33 fail, cùng tập lỗi cũ (workflow-ui gần như toàn bộ, localization, workspace-connections 401/`"TELEGRAM"`/readiness).
- Chỉ fail trên branch: `localization:81` (tìm nhãn "Dịch vụ" của dropdown cũ) → đã sửa test, pass; `control-bot:179` chạy lại pass (flaky). Các test tạo connection (Discord/Slack/Teams/Telegram/Google) dùng `connection-provider-<PROVIDER>`.check() và đều pass.
- GitNexus detect-changes: risk HIGH (29 file, 8 luồng qua WorkflowBuilderPage/ConnectionsPage/WorkflowsPage → auth token/workspace store); không đổi logic auth/workspace, các luồng này được e2e phủ.

### 9.1 Xem trước định dạng và thanh định dạng cho Teams (2026-10-11)

- Ô "Xem trước khi gửi" dưới ô nội dung: `lib/formatPreview.ts` chuyển nội dung thành cây phần tử an toàn (danh sách thẻ cho phép; thẻ lạ như `<script>` giữ nguyên dạng chữ; link chỉ nhận `http(s)` hoặc `{{ biến }}`), còn `components/builder/FormatPreview.tsx` render bằng React (không dùng `innerHTML`); biến hiện thành chip có tên dễ đọc. Chỉ hiện khi chế độ gửi thực sự hiển thị định dạng: email `bodyType: html`, Telegram `parseMode` HTML/MarkdownV2, Discord/Slack/Teams luôn hiện. Email HTML gộp xuống dòng như trình duyệt; chat giữ xuống dòng.
- Teams: node gửi `TextBlock` của Adaptive Card (`TeamsSendMessageNodeExecutor`, chỉ đọc để kiểm tra) → cú pháp `teams`: `**đậm**`, `_nghiêng_`, `[chữ](url)`, danh sách `- `. Discord có thêm nút danh sách.
- Kiểm tra: `node --test src/lib/formatPreview.test.mjs src/lib/formatInsert.test.mjs` 9/9; tsc, eslint (file đã sửa) sạch; e2e mới "Teams message toolbar…" trong `w7-nodes` pass, `w7-nodes` + `control-bot` 18/18; `workspace-connections` 62 pass / 4 fail đúng baseline. Stack thật: email "test email 1" (không lưu) → B và danh sách ra `<ul><li>…</li></ul><b>…</b>`, ô xem trước hiện chấm đầu dòng và chữ đậm, chỉ xuất hiện sau khi chuyển sang HTML. Node Teams trên stack thật không thử được vì workspace chưa có kết nối Teams (trường nội dung chỉ hiện khi đã chọn kết nối), nên phủ bằng e2e.

### 9.2 Soạn trực quan (WYSIWYG) ngay trong ô nội dung, nút `</> HTML` (2026-10-11)

- Theo phản hồi của user: ô nhập hiện thẳng định dạng thay vì thẻ thô + khung xem trước. Khi chế độ gửi có hiển thị định dạng (email `bodyType: html`, Telegram có parse mode, Discord/Slack/Teams), `MappingTextField` (prop `format.rich`) dựng DOM từ cây an toàn của `formatPreview` (`components/builder/richText.ts` → `buildRich`) và ghi ngược bằng `serializeRich`: HTML có escape `& < >`, Telegram HTML dùng `\n` (Telegram không nhận `<br>`), MarkdownV2 có escape ký tự đặc biệt, Discord `**`, Slack mrkdwn, Teams Markdown của Adaptive Card. Nút dùng `document.execCommand` (đậm, nghiêng, danh sách, link qua `prompt` chỉ nhận `http(s)`); Enter trong danh sách tạo mục mới. Biến vẫn là chip.
- Lần định dạng đầu ở bước text thường: chuyển bước sang HTML/parse mode rồi định dạng luôn; xuống dòng đã gõ của email đổi thành `<br>`.
- Nút `</> HTML` (`</> Markdown` cho chat) chuyển sang sửa mã nguồn, có khung xem trước bên dưới. Nội dung có thẻ/thuộc tính mà trình soạn trực quan không giữ được (bảng, ảnh, style, comment…) mở thẳng ở chế độ mã và không cho quay về (`richEditable`), tránh mất code người dùng tự viết.
- Kiểm tra: tsc, eslint, build qua; unit 9/9; e2e Teams viết lại (đậm hiện trong ô, `</> Markdown` ra `**Build failed**`, xem trước ở chế độ mã, lưu `**Build failed**`); `w7-nodes` + `control-bot` + `workspace-connections` 79 pass / 5 fail = 3 baseline cũ + `2124`, `2608` pass khi chạy lại (flaky). Stack thật ("test email 1", không lưu): bôi đen → B ra `<b>…</b>` hiển thị đậm trong ô, email tự sang HTML; Enter, danh sách 2 mục, nghiêng → `<b>test xin chao</b><br><ul><li>muc <i>mot</i></li><li>muc hai</li></ul>`; `</> HTML` hiện mã + xem trước; thêm `<img>` ở chế độ mã → không quay về trực quan, hiện giải thích.

## 10. Giao diện v2 theo Claude Design (nhánh `feature/ui-redesign-v2`, từ 2026-10-13)

Nguồn: artifact Claude Design `Q6Z6MhT3rKQwPuPYgT6Y88` (`project/*.dc.html`), prompt `weav-ui-redesign-agent-prompt.md`. Quyết định của chủ dự án (2026-10-13): landing ở `/` cho khách, người đã đăng nhập vào `/dashboard`; trình tạo chỉ restyle, giữ canvas.

### Lane 1: token, font, theme (xong)
- `index.css`: đổi giá trị token sáng/tối theo Theme.dc.html (giữ tên biến). `--primary` = nút chính màu mực (`#1d1b18` / `#ece9e4`), xanh `#2456c7`/`#8eaef3` chỉ cho `--ring`, `--run`, `--accent-ink`. Bo góc `xl`/`2xl` = 10px. Font: Be Vietnam Pro 400–700 + JetBrains Mono (qua `@fontsource`), bỏ Geist.
- Vì primary không còn xanh: `focus:border/ring-primary` → `ring` (xanh), viền hover thẻ → `border-strong`, trạng thái chọn/đang chạy → `run`, link `text-primary` → `text-accent-ink`, `text-white` trên `bg-primary` → `text-primary-foreground` (tránh chữ trắng trên nền ngà ở chế độ tối). 41 file, chỉ đổi class.
- Kiểm tra: tsc sạch; build qua; eslint còn 3 lỗi `set-state-in-effect` có sẵn (LiveWorkflowExecutionsPage:92, WorkflowBuilderPage:649, WorkflowsPage:149), không do lane này. Browser `/login`: font Be Vietnam Pro có dấu (`document.fonts.check` true), nền `#f6f5f2`, nút chính `#1d1b18`/trắng; tối: nền `#131211`, nút `#ece9e4`/`#131211`; console không lỗi. Stack backend chưa chạy nên chưa xem trang cần đăng nhập.
- GitNexus detect-changes: 63 file, risk low, 0 luồng bị ảnh hưởng.

### Lane 2: khung web (thanh bên, topbar, bot nổi) (xong, chưa kiểm trong Browser)
- Thanh bên: logo `WeavMark` + nút thu gọn/ghim cạnh logo, ô nhóm làm việc dưới logo, rộng 64px khi thu gọn / 248px khi mở (rê chuột mở đè lên nội dung, nút ghim giữ nguyên logic cũ). Mục: Tổng quan, Quy trình, Lịch sử chạy (`/executions`), Không gian làm việc; bỏ Trợ lý AI khỏi thanh bên (đã có bot nổi; route `/assistant` giữ). Cài đặt, Trợ giúp, khối người dùng (tên + email, nút đăng xuất) luôn ở đáy. Mục đang chọn = nền thẻ + viền 1px (giữ `data-testid="active-nav-indicator"`).
- Topbar: nền trang, breadcrumb giữ nguyên (e2e dùng `topbar-breadcrumb-current`), VI/EN dạng nút đôi, mặt trăng/mặt trời đổi theme, chuông có số chưa đọc (nền `err`). Không làm ô tìm kiếm Ctrl K của thiết kế vì app chưa có tìm kiếm toàn cục.
- Bot nổi `components/assistant/AssistantBot.tsx`: nút robot (ăng-ten xanh, miệng chữ W), panel 380x540 (lời chào theo tên, 3 câu hỏi gợi ý, dòng trạng thái công cụ, nút "Mở trong trình tạo" khi có bản nháp, nút "Xem lịch sử chạy" khi trợ lý có xem lượt chạy, cuộc trò chuyện mới, ô nhập). Ẩn ở trình tạo quy trình và ở `/assistant`; không hiện khi `isAssistantMockMode`. Hội thoại giữ khi đóng panel.
- Logic chat tách ra `hooks/useAssistantChat.ts`, `AssistantPage` dùng lại (hành vi giữ nguyên, kể cả `explainRun`).
- File mới dùng chung: `lib/uiClasses.ts` (nút mực, nút viền, thẻ, icon button), `components/common/WeavMark.tsx`.
- i18n: khối `// ---- v2 redesign ----` cuối mỗi ngôn ngữ trong `translations.ts` (`bot.*`, `topbar.language`).
- GitNexus impact: Sidebar LOW, Topbar LOW, AssistantPage LOW, AppLayout (hai symbol, chỉ App gọi) LOW. detect-changes: 6 file, risk low.
- Kiểm tra: tsc sạch; eslint chỉ còn 3 lỗi có sẵn; build qua; `git diff --check` sạch.
- Rủi ro: e2e `navigation-structure` (rộng 56/220 → 64/248, danh sách link), `honest-pages` (link "Trợ lý AI" không còn ở thanh bên), `workflow-ui` (font-size link 14px vẫn giữ) cần xem lại; nút "Xem lịch sử chạy" của bot chỉ hiện theo tên công cụ, chưa có nút "Kết nối lại" vì API trợ lý không trả dữ liệu có cấu trúc.

### Lane 3a: Tổng quan, Quy trình, Lượt chạy, Không gian làm việc, Đăng nhập/Đăng ký/Quên mật khẩu (xong, chưa kiểm trong Browser)
- Tổng quan (`DashboardPage`): lời chào theo giờ + tên, 4 số liệu 7 ngày chỉ từ API có sẵn (`monitoring/summary`: lượt chạy, tỉ lệ thành công, lỗi cần xem, quy trình đang bật/tổng), thẻ "Cần chú ý" (lỗi gần đây + quy trình tạm dừng, nút Kết nối lại / Xem lượt chạy / Mở quy trình), "Lượt chạy gần đây", biểu đồ cột 7 ngày (`WeeklyActivity`), "Bắt đầu nhanh". Bỏ số "so với 7 ngày trước" (API không có), bỏ nhánh demo cứng của mock mode và bảng quy trình + nút chạy tay (Danh sách quy trình đã có nút chạy).
- Quy trình (`WorkflowsPage`): bộ lọc Tất cả / Đang bật / Tạm dừng / Bản nháp (bỏ tab Lỗi và lọc theo trigger), công tắc bật/tắt từng dòng gọi `pauseWorkflow`/`resumeWorkflow` có sẵn (bản nháp không có công tắc), cột "Quy trình làm gì" sinh từ node (`lib/workflowSummary.ts`, nhãn trong `wfsum.*`, nhãn catalog `nodeLabel` làm dự phòng; có test `workflowSummary.test.mjs`). Các bước cần chi tiết quy trình nên chỉ tải cho 20 dòng đầu (cache 60s), dòng còn lại chỉ hiện dòng "Chạy khi…". Giữ chọn nhiều + xoá hàng loạt, nhập tệp, menu "Thao tác khác".
- Chi tiết lượt chạy (`ExecutionsTriPane`): danh sách lượt chạy bên trái, bên phải là trang một lượt chạy: tiêu đề + trạng thái + giờ/thời lượng, khối lỗi nền đỏ bằng lời thường (`lib/executions/friendlyError.ts` + `runerr.*`, có cách sửa và nút Kết nối lại / Mở quy trình), "Chi tiết kỹ thuật" trong `<details>`, danh sách bước (thành công/lỗi/bỏ qua), chọn bước hiện "Dữ liệu nhận vào" và "Kết quả". Không có nút "Chạy lại từ bước lỗi" (backend chưa có): dùng "Chạy lại" toàn bộ. Service không lưu dữ liệu nhận vào của từng bước nên khối đó hiện ghi chú khi `input` trống. Bỏ biểu đồ waterfall và tab Input/Output/Logs (nhật ký chuyển vào `<details>`).
- Không gian làm việc: `WorkspaceHeader` (tiêu đề "Không gian làm việc" + chip tên nhóm + mô tả), `WorkspaceTabs` 4 tab, danh sách kết nối trong thẻ với ô mã nhà cung cấp, pill trạng thái, nút Kết nối lại/Kiểm tra; `WorkspacePage` bỏ chữ đậm/in hoa nhỏ. Hộp thoại tạo kết nối giữ nguyên luồng cũ.
- Đăng nhập / Đăng ký / Quên mật khẩu: `AuthLayout` (logo, VI/EN, đổi theme) + `AnimatedWorkflowShowcase` mới (2 node vào, node AI "Bộ biên dịch AI", 2 node ra, dây nét đứt chạy, chấm dữ liệu chạy dọc dây bằng `offset-path`, node nhấp nhô lệch nhịp, node giữa phập phồng, 3 ô tính năng, thu nhỏ theo bề rộng, tắt chuyển động khi `prefers-reduced-motion`). Bỏ dòng mã node (`trigger.manual`...) khỏi sơ đồ vì người dùng không rành kỹ thuật. Bỏ ô "Ghi nhớ đăng nhập" (không có tác dụng) và footer.
- Dùng chung: `components/layout/ShellControls.tsx` (VI/EN + đổi theme), `statusBadgeClass` thành pill tròn 22px, `@keyframes wv-*` trong `index.css`, khối i18n `home.*`, `wfl.*`, `wfsum.*`, `run2.*`, `runerr.*`, `auth.*` (VI + EN).
- GitNexus impact (upstream): DashboardPage, WorkflowsPage, ConnectionsPage, ExecutionsTriPane, LoginPage, RegisterPage, ForgotPasswordPage, WorkspaceHeader/Tabs, AnimatedWorkflowShowcase, WorkspaceSwitcher đều LOW; WorkspacePage UNKNOWN (trùng tên với symbol trong `workspace.api.ts`; grep: chỉ `App.tsx` gọi). detect-changes: risk HIGH vì các luồng ConnectionsPage/WorkflowsPage/WorkspacePage/ExecutionsTriPane đi qua token/workspace store (chỉ đổi giao diện, không đổi logic auth) và có thay đổi `apps/mobile` của agent khác trong cùng checkout.
- Kiểm tra: tsc sạch; eslint chỉ 3 lỗi có sẵn (LiveWorkflowExecutionsPage:92, WorkflowBuilderPage:649, WorkflowsPage:146); build qua; `node --test src/lib/workflowSummary.test.mjs` pass; `git diff --check` sạch.
- Đã sửa e2e `localization.spec.ts` (tiêu đề trang Workspace, Đăng nhập, Bắt đầu nhanh, Quy trình làm gì) và `password-recovery.spec.ts` (tiêu đề Sign In). Còn lại cần reviewer chạy: `dashboard-real-data` (bỏ bảng quy trình + nút chạy tay, bỏ `dashboard-failure-rate-7d`, quick actions mới), `honest-pages`/`navigation-structure` (sidebar rộng 64/248, không còn link Trợ lý), `workflows*`/`workflow-ui` (tab Lỗi, cột mới), spec mở trang chạy (`runs.failed_at`, tab Input/Output).
