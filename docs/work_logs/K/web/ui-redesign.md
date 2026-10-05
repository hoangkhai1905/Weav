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

## 6. Rủi ro và chưa làm

- Trang chi tiết lượt chạy 3 cột (Executions.dc.html: waterfall, "Cách sửa") chưa dựng lại; mới đổi màu theo token.
- `ExecutionsPage` (mock) vẫn là bố cục dashboard cũ, chỉ đổi token.
- Editor: chưa có palette ⌘K, công tắc bật/tắt, tab Cài đặt, canvas dọc; giữ bố cục ngang và palette bên trái.
- Dashboard, Workspace, Settings, AI, Telegram, Notifications, Help chưa codemod màu cứng.
- `LiveWorkflowExecutionsPage` và danh sách quy trình ở chế độ http chưa chụp ảnh với dữ liệu thật (chỉ kiểm tra bằng type/build/e2e).

## 7. Việc tiếp theo

1. Dựng chi tiết lượt chạy theo Executions.dc.html (danh sách lượt, bảng bước có waterfall, panel Input/Output/Lỗi).
2. Codemod màu cứng cho các trang còn lại và rà soát dark mode.
3. Thêm palette ⌘K và công tắc kích hoạt cho editor khi API hỗ trợ.
