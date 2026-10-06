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
- Dữ liệu thử để lại trên Neon: quy trình `193e559c-44da-4ba9-9419-98698b014103` ("Untitled Automation Pipeline", đã xuất bản, 3 lượt chạy: 2 lỗi, 1 thành công) và kết nối Google Sheets "test sheet" (9b4e521a) trong workspace "test 1" trong workspace "test 1". Xóa quy trình chưa có API.
- Chưa làm / còn lại:
  - Tab "Trình chỉnh sửa" xuống 2 dòng ở header trang lượt chạy khi rộng 800px: đã sửa (nav `shrink-0 whitespace-nowrap`, tên quy trình co lại thay; e2e với tên dài: không có bản sửa thì lỗi, có thì đạt).
- Đã sửa sau đó: header editor dưới `lg` dùng cột `minmax(0,1fr)_auto_auto` để tên quy trình co lại thay vì các nút tràn đè lên tab (e2e ở 800px, tiếng Việt, quy trình đã xuất bản: không có bản sửa thì lỗi, có bản sửa thì đạt). `ConfirmModal` có `role="alertdialog"`, `aria-modal`, liên kết tiêu đề và mô tả, nhãn nút đóng, tự focus nút Hủy, Esc để đóng.

## 6. Khôi phục sau merge và đổi chữ "workflow" (aa8e7b9)

- Merge `d4fa9f4` (sau khi viết lại tên tác giả) giữ phía chưa dịch khi gặp xung đột, làm mất key i18n trong `translations.ts`, chuỗi đã dịch trong `WorkflowBuilderPage.tsx` và mục work log của `7d79d27`. Đã khôi phục 3 file này từ `7d79d27`.
- Đổi "Tất cả workflow" → "Tất cả quy trình", thông báo chạy lại và `dashboard.ai_unavailable` sang "quy trình".
- Kiểm tra: tsc, build, `git diff --check` qua; Playwright http (5 spec chính + workflow-api-v1) 35 failed / 49 passed, đúng tập lỗi baseline; GitNexus detect-changes: critical vì đổi module dịch dùng chung.

## 7. Rủi ro và chưa làm

- Tab Cài đặt, công tắc bật/tắt quy trình, undo/redo, "chạy lại từ bước" và gợi ý cách sửa: chưa có API backend.
- Chưa kiểm tra với backend thật đang chạy; ảnh chụp dùng response giả lập theo kiểu API thật.
- `ExecutionsPage`/`ExecutionDetailPage` ở mock mode vẫn bố cục cũ, chỉ đổi token.
- Dashboard, Workspace, Settings, AI, Telegram, Notifications, Help chưa được rà soát giao diện bằng mắt.
- Còn tiếng Anh có chủ đích: dữ liệu mẫu, mã kỹ thuật, tên thương hiệu, ví dụ placeholder, lỗi gốc từ backend.

## 8. Việc tiếp theo

1. Chạy thử với stack thật (Compose dev) và kiểm tra editor, lịch sử chạy, kết nối.
2. Rà soát giao diện các trang còn lại ở light/dark.
3. Thêm công tắc kích hoạt và tab Cài đặt khi backend có API.
