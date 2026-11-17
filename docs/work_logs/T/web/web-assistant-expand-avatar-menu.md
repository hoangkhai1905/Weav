# Nhật ký — Web: nút toàn màn hình cho bot trợ lý và menu avatar trên topbar

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-11-16` |
| Nhánh | `feat/web-assistant-expand-avatar-menu` (từ `dev` @ `2c86ffbb`) |
| Người thực hiện | T + AI agent |
| Trạng thái | Hoàn thành, chưa commit |
| Phạm vi | Trang `/assistant` trước đây chỉ vào được từ URL; thêm lối vào từ bot nổi, và cho avatar topbar một menu tài khoản |

## 2. Kết quả

- Bot nổi có nút **Mở toàn màn hình** (`assistant-bot-expand`) dẫn tới `/assistant`. Nếu bot đang có hội thoại, id được truyền qua router state `{ conversationId }`, trang `/assistant` mở lại đúng hội thoại đó rồi xóa state (cùng cách với `explainRun`). Nút bị tắt khi đang stream để không hủy câu trả lời.
- Avatar topbar (`topbar-user-avatar`) thành nút mở menu (`topbar-user-menu`): tên + email, Thông tin hồ sơ, Bảo mật, Trợ giúp, Đăng xuất (`topbar-logout`). Đóng khi bấm ra ngoài hoặc Escape (focus về avatar), đóng khi chọn mục.
- i18n mới: `bot.expand` (vi/en). Các nhãn menu tái dùng key có sẵn (`settings.profile`, `settings.security`, `nav.help`, `nav.logout`, `nav.account`).

## 3. File ảnh hưởng

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `apps/web/src/components/assistant/AssistantBot.tsx` | Nút mở toàn màn hình, truyền `conversationId` |
| Sửa | `apps/web/src/pages/AssistantPage.tsx` | Nhận `conversationId` từ router state, kiểm UUID, mở hội thoại một lần |
| Sửa | `apps/web/src/components/layout/Topbar.tsx` | Component `UserMenu` thay cho avatar tĩnh |
| Sửa | `apps/web/src/lib/i18n/translations.ts` | Key `bot.expand` |
| Sửa | `apps/web/e2e/assistant.spec.ts` | 2 test mới: bot → `/assistant` giữ hội thoại; menu avatar (Escape, điều hướng, đăng xuất) |

## 4. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Impact | GitNexus `impact` Topbar/BotChat/AssistantChat | `UNKNOWN` (index chậm 67 commit); text search: mỗi component chỉ 1 nơi dùng → rủi ro thấp |
| Typecheck | `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | PASS |
| Lint | `pnpm --dir apps/web exec eslint` (3 file đã sửa) | PASS |
| E2E | `VITE_API_MODE=http ... playwright test assistant profile-integration session-management --project=chromium` | 34/34 PASS |
| E2E | `... navigation-structure honest-pages mobile-layout` | 14/14 PASS |
| Build | `pnpm --dir apps/web build` | PASS (chỉ cảnh báo chunk size có sẵn) |
| Diff | `git diff --check` | sạch |

### Chưa kiểm tra

- Chưa thử trên stack thật (Docker không chạy); E2E dùng `page.route` stub backend.

## 5. Việc tiếp theo

- Thử nhanh trên stack thật rồi commit và merge `--no-ff` vào `dev`.
