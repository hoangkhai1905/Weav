# Nhật ký: Logo thương hiệu Weav (brand-logo)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-10-13 |
| Nhánh | `feat/brand-logo` (nền: `dev` `b673136`) |
| Người thực hiện | AI agent (Claude), K duyệt hướng thiết kế |
| Trạng thái | Hoàn thành, chưa commit |
| Phạm vi | Thiết kế logo mới thay ảnh raster `weav-logo-v2.png`, bộ asset (masters, favicon, app icon), gắn vào `apps/web` |

## 2. Quyết định

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Biểu tượng "Run Weave", bản Bold: tam giác "chạy" dệt từ 3 sợi, mỗi sợi luồn dưới sợi trước và vắt qua sợi sau | K chọn sau 3 vòng (vòng 1 có chữ W bị loại vì K không muốn logo có chữ; vòng 2 chọn hướng B; vòng 3 chọn biến thể D Bold) | Ý nghĩa: chạy tự động + dệt (trigger, action, result) |
| Màu `#2b5fd9` (= `--primary`), dark UI `#5b8cf0` | Giữ màu thương hiệu sẵn có | Không đổi token CSS |
| Wordmark "weav" chữ thường, Geist SemiBold (620), outline | Geist là font UI của app, giấy phép OFL cho phép dùng làm logo | Component `Logo.tsx` vẫn hiển thị chữ HTML "WEAV" như cũ (chưa đổi để tránh thay đổi ngoài phạm vi) |
| Bản nhỏ riêng (`weav-symbol-small.svg`, khe hở rộng gấp đôi) làm nguồn favicon | Khe 9/256 biến mất ở 16-32 px | Favicon vẫn thấy được nét dệt |
| Xóa `public/weav-logo-v2.png`, `public/logo.png` | Không còn tham chiếu (đã grep toàn repo; mobile dùng asset riêng) | Giảm ~940 KB trong `public/` |

## 3. File thay đổi

- `apps/web/index.html`: favicon `.ico` + `.svg`, apple-touch-icon, manifest, `theme-color`.
- `apps/web/src/components/common/Logo.tsx`, `apps/web/src/components/layout/Topbar.tsx`: dùng `/weav-mark.svg`; bỏ viền/ring bọc ảnh raster cũ.
- `apps/web/public/`: `weav-mark.svg`, `favicon.svg` (thay favicon mặc định của Vite), `favicon.ico`, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`.
- `apps/web/e2e/workflow-ui.spec.ts`: cập nhật đường dẫn logo/favicon mong đợi.
- `docs/brand/`: masters SVG, `README.md` (hướng dẫn dùng logo), `source/build.py` (sinh lại masters).

## 4. Kiểm tra

| Lệnh / bước | Kết quả |
| --- | --- |
| `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | Pass |
| `pnpm --dir apps/web build` | Pass (cảnh báo chunk > 500 kB có từ trước) |
| `VITE_API_MODE=mock playwright test e2e/workflow-ui.spec.ts -g "refreshed WEAV mark"` | 1 passed |
| Cùng test với `VITE_API_MODE=http` | Fail như trên `dev`: `/dashboard` chuyển về `/login` khi chưa đăng nhập nên không có Topbar (không do thay đổi này) |
| Trình duyệt `localhost:5173/login` | Logo mới hiển thị; 6 asset trả 200 đúng content-type; console không lỗi |
| `svg_audit.py docs/brand/*.svg` | Symbol 98-99/100; cảnh báo góc lệch ở wordmark là nét chéo gốc của Geist (bình thường) |
| `git diff --cached --check` | Sạch |
| GitNexus `impact Logo` | Báo CRITICAL nhưng sai: index chậm 85 commit, symbol `Logo` không có type và resolve nhầm sang method Java. Đã xác nhận bằng grep: `Logo` chỉ dùng ở `LoginPage`, `RegisterPage` |

## 5. Rủi ro / việc tiếp theo

- Chưa tra cứu nhãn hiệu (trademark) cho biểu tượng.
- App mobile (`apps/mobile`, phần của partner) vẫn dùng icon cũ; nếu muốn đồng bộ, bàn giao `docs/brand/weav-app-icon.svg`.
- Có thể đổi chữ "WEAV" trong `Logo.tsx` sang wordmark SVG nếu muốn đồng nhất với bộ nhận diện.

## Logo trong app dùng app icon (2026-10-18, nhánh `feature/app-icon-logo`)
- Theo yêu cầu: lấy `public/icon-192.png` (ô xanh `#2b5fd9`, biểu tượng trắng) làm logo. `WeavMark` (sidebar, đăng nhập/đăng ký/quên mật khẩu, landing) vẽ lại bằng SVG của `docs/brand/weav-app-icon.svg` thay ô chữ "W" màu mực; `Logo.tsx` (không còn nơi dùng) trỏ `/icon-192.png`. Favicon/PWA đã dùng mark này từ `ac2d7433`.
- E2E `workflow-ui` "refreshed WEAV mark" vốn đỏ từ bản v2 (tìm `<img src=/weav-mark.svg>` không còn tồn tại) → kiểm `data-testid="weav-mark"` + màu ô; pass.
- Kiểm tra: tsc sạch, eslint 2 file sạch, Browser `/` và `/login` hiện logo mới, console không lỗi. GitNexus không tìm thấy `WeavMark` (index cũ) → grep: 3 nơi dùng, props không đổi.
