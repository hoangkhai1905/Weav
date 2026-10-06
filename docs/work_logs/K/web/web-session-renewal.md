# Giữ đăng nhập web theo phiên backend (7 ngày)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-10-06`, Asia/Saigon |
| Nhánh | `claude/youthful-thompson-7gz34q` (từ `dev` `650f434`) |
| Người thực hiện | K + AI agent |
| Trạng thái | Hoàn thành |
| Phạm vi | Web không còn bị đăng xuất sau 15 phút, khi tải lại trang hay mở tab mới |

## 2. Nguyên nhân

- Identity: access token 15m, refresh/phiên 7 ngày (`JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`).
- Web không dùng refresh sau khi trang đã tải: `workspace.api`/`notification.api` gặp 401 là `logout()` ngay (đồng thời thu hồi phiên ở backend), nên cứ 15 phút là bị đá ra.
- Email/mật khẩu: refresh token chỉ trong bộ nhớ tab, tải lại là mất. Google: cookie refresh còn nhưng cờ "có phiên" ở sessionStorage, đóng tab là mất.

## 3. Quyết định

| Quyết định | Lý do | Phương án khác |
| --- | --- | --- |
| Thêm `POST /auth/web/login` trong `OAuthController`, đặt refresh vào cookie HttpOnly như luồng Google | Không để refresh token ở nơi JS đọc được; dùng lại `/auth/web/refresh`/`logout` sẵn có | Lưu refresh vào localStorage (bị loại: lộ khi XSS) |
| Endpoint nằm cùng `OAuthController` (chỉ bật khi OAuth bật) | Cookie chỉ có ích khi `/auth/web/refresh` tồn tại | Controller luôn bật như stash `codex/web-session-renewal` (user chọn không làm lúc này) |
| Web: tự làm mới trước hạn 2 phút (kiểm tra mỗi phút + khi quay lại tab), 401 → làm mới một lần rồi gửi lại; chỉ logout khi refresh bị từ chối (401) | Không để người dùng thấy lỗi; mất mạng không làm mất phiên | Một lớp transport chung cho mọi client (stash, lớn hơn) |
| Đăng nhập lùi về `/api/auth/login` (phiên trong tab) khi route web trả 404 hoặc không gọi được (status 0) | Identity tắt OAuth, hoặc origin không được phép (Playwright `127.0.0.1:4175`) | Bắt buộc route web (làm hỏng 3 e2e đăng nhập) |

Bản làm dở trước đó cho cùng việc nằm trong `stash@{0}` (GitHub Desktop, nhánh `codex/web-session-renewal`, chưa merge). User chọn giữ bản này; stash để nguyên.

## 4. Thay đổi

- Identity: `OAuthController.loginWeb` (origin + CSRF, rate limit `LOGIN_ACCOUNT` + `LOGIN_IP`, `Set-Cookie` refresh 7 ngày, body không có refresh); `SecurityConfig` mở `/auth/web/login`; `AuthRateLimitFilter` tính `/auth/web/login` như `/auth/login`. `/auth/login` cũ giữ nguyên (mobile).
- Contract: `packages/contracts/http/auth/openapi.yaml` (`loginWeb`, bổ sung), `README.md`.
- Web: `auth.api.ts` (cờ phiên sang localStorage, `refreshAccessToken` single-flight, `canRefresh`, đăng nhập qua cookie, CSRF hết hạn → lấy mới và thử lại một lần); `useAuthStore.ts` (`handleUnauthorized`, vòng tự làm mới); thử lại sau 401 trong `workspace.api`, `workflow-v1.api`, `connection.api`; `notification.api` và OCR trong builder làm mới thay vì logout.
- Không đổi schema/migration, không đổi thời hạn token.

## 5. Kiểm tra

| Hạng mục | Lệnh / thao tác | Kết quả |
| --- | --- | --- |
| Identity | `mvnw clean verify` (JDK 25 trong `eclipse-temurin:25-jdk`, máy chỉ có JDK 21) | 361 test, 0 failure, 4 error môi trường: minio ×3 (đã biết), `IdentitySecurityNotificationRuntimeIntegrationTest` cần `node` trong container |
| Test mới | `GoogleOAuthHttpIntegrationTest.webPasswordLoginSetsTheRefreshCookieThatWebRefreshRotates` | PASS (11/11 trong class): thiếu CSRF 403, sai mật khẩu 401 không cookie, đúng 200 + cookie 7 ngày, body không có refresh, `/auth/web/refresh` xoay được |
| Route thật | `curl` POST `/auth/web/login` không CSRF | 403 |
| Web | `tsc --noEmit`, `build`, eslint các file đổi | PASS |
| Playwright | `session-management`, `change-password`, `profile-integration`, `notification-*`, `workspace-read-switch` | 52 pass; 8 lỗi trùng khớp khi chạy trên code chưa sửa (baseline) |
| Trình duyệt thật (Google) | tải lại trang; tab mới (sessionStorage rỗng); token hỏng rồi chuyển trang; token hết hạn rồi để yên | Vẫn đăng nhập; hai 401 đồng thời → một `/auth/web/refresh` 200, trang tải đủ; tự làm mới sau 9 giây không cần thao tác |
| GitNexus detect-changes | `--scope all` | CRITICAL (đụng `useAuthStore`/`authApi`, dùng toàn app); phủ bằng test và trình duyệt ở trên |

### Chưa kiểm tra

- Đăng nhập email/mật khẩu trên trình duyệt thật (không dùng mật khẩu của user; có integration test).
- Đăng xuất trên trình duyệt thật (logic không đổi: có cờ phiên → `/auth/web/logout` xóa cookie).
- Nhiều tab cùng làm mới đúng lúc: dựa vào cửa sổ ân hạn 10 giây của refresh ở backend, không có khóa giữa các tab.

## 5b. Sửa lỗi sau khi user báo vẫn bị out (2026-10-06 23:20)

- Hiện tượng: Browser pane quay về `/login`. Network: 3 `POST /auth/web/refresh` cùng lúc → 403, rồi 200, 200, 401, 401, rồi `/auth/web/logout`.
- Nguyên nhân: mỗi lần Vite HMR nạp lại module auth lại thêm một `setInterval` mới (cái cũ không bị xóa), và `refreshInFlight` chỉ có tác dụng trong một bản module. Nhiều bản cùng xoay một cookie refresh, bản thua nhận 401 và logout thu hồi phiên. Lỗi tương tự xảy ra thật khi mở nhiều tab (các tab dùng chung cookie). CSRF ở sessionStorage riêng từng tab còn gây 403 khi các tab thay nhau lấy CSRF mới.
- Sửa: `refreshAccessToken` chạy trong Web Lock `weav-auth-refresh` (giữa các tab và các bản module); vào khóa nếu token đã được tab khác làm mới và còn hạn thì dùng lại (kiểm bằng `/api/auth/me`), không xoay cookie nữa. CSRF chuyển sang localStorage (dùng chung giữa tab). Hẹn giờ và listener gắn vào `window.__weavAuthRenewal`, bản module mới thay thế bản cũ thay vì chồng thêm.
- Kiểm tra: 3 tab, token hỏng, cùng gọi `handleUnauthorized` vào một thời điểm (2 vòng): cả 3 tab vẫn đăng nhập, mọi refresh 200 và chạy lần lượt, không 401/403. Playwright `session-management`, `change-password`, `profile-integration` 29/29. tsc, eslint sạch.

## 6. Bàn giao

- Phiên cũ (trước bản này) cần đăng nhập lại một lần.
- Nếu cần giữ phiên khi tắt Google OAuth: lấy phần backend `WebSessionController` từ `stash@{0}`.
