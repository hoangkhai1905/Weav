# Nhật ký: Web tài khoản, workspace, kết nối (Week 5, lane W5-C)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-07 |
| Nhánh | `feat/w5-c-account` (từ `week5` ef69d9a) |
| Trạng thái | Hoàn thành code + kiểm tra stub; chờ coordinator kiểm tra trình duyệt thật |
| Phạm vi | Sửa các mục audit #2 #5 #6 #7 #8 #11(một phần) #12 #13 #14 #29 #30 #31 #38 #40 #47 #48 (chỉ web, không đổi backend) |

## 2. Quyết định

- `AuthApiError` mang thêm `code` và `fieldErrors` (từ `error.details[]` của Gateway), chỉ đọc từ response, không đọc request (mật khẩu).
- Đổi mật khẩu sai mật khẩu hiện tại: identity trả 401 mã `UNAUTHORIZED` (cùng mã với phiên hết hạn). `authApi` dùng axios riêng, không có interceptor refresh/logout, nên 401 ở đây chỉ hiện "Mật khẩu hiện tại không đúng", không đăng xuất.
- Quy tắc mật khẩu phía client = Identity: 8-72 ký tự, tối đa 72 byte UTF-8.
- Thêm thành viên: lỗi 404 (hoặc `USER_NOT_FOUND`) -> "Không có tài khoản nào với email này".
- OWNER hiển thị đủ quyền (API trả `canPublishWorkflow:false` cho OWNER).
- Avatar: `PUT/DELETE/GET /api/users/me/avatar` (multipart field `file`, JPEG/PNG/WebP, tối đa 2 MiB, kiểm tra trước khi tải lên); GET trả URL ký ngắn hạn.
- Thiết bị phiên: parse user agent bằng vài regex (không thêm thư viện). API đã có `lastUsedAt` (trang vốn đã hiển thị).
- Quên mật khẩu: lưu `{challengeId,email,expiresAt}` ở `sessionStorage` (`weav_forgot_challenge_v1`), nút "Tôi đã có mã" ở bước nhập email; xóa khi thành công, khi "dùng email khác", hoặc hết hạn.
- Kết nối: tạo xong thì Google đi thẳng sang màn hình đồng ý; Telegram nhập token trong cùng hộp thoại (đã có). Kết nối Google chưa từng ủy quyền: "Chưa kết nối" + nút "Kết nối", không có "Kiểm tra kết nối". Xóa dùng `ConfirmModal` thay `window.confirm`. Thời gian xác minh hiển thị tương đối (`formatRelativeTime`).
- Bật lại kết nối: Gateway và workspace-service KHÔNG có route enable. "Bật lại" gọi `test`, vì VERIFIED kích hoạt kết nối (hiện cho kết nối DISABLED đã có credential).
- Admin: `/admin/users` (ADMIN, chuyển về /dashboard nếu không phải), `GET /api/admin/users` (page,size,search,status), đổi trạng thái `PATCH /api/admin/users/{id}/status` body `{status}`; link ở trang Cài đặt cho ADMIN.

## 3. File thay đổi

Sửa: `apps/web/src/api/auth.api.ts`, `pages/{RegisterPage,ForgotPasswordPage,SettingsPage,WorkspacePage,ConnectionsPage}.tsx`, `App.tsx` (1 route + 1 import), `lib/i18n/translations.ts` (khối `w5c.*` ở cuối mỗi ngôn ngữ; sửa tại chỗ 3 chuỗi `workspace.identity_email` VI/EN và `msg.an_existing_identity_user_email_is_required` VI), `e2e/change-password.spec.ts`, `e2e/workspace-connections.spec.ts`.
Mới: `api/admin.api.ts`, `pages/AdminUsersPage.tsx`, `e2e/account-w5c.spec.ts`.

## 4. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| Baseline 7 spec (trước khi sửa) | 99 passed, 18 failed (đã đỏ sẵn: password-recovery x8, workspace-connections 401 x2, members x1, read-switch x7) |
| Sau khi sửa, 7 spec + `account-w5c.spec.ts` | 110 passed, cùng 18 failed (không lỗi mới) |
| `tsc --noEmit`, `build`, eslint các file đã sửa | sạch |
| `git diff --check` | sạch |

Spec cũ cập nhật vì đổi hành vi có chủ đích: đổi mật khẩu sai (thông báo mới), tạo kết nối Google hiện "Chưa kết nối", xóa dùng dialog trong ứng dụng, kiểm tra kết nối cần fixture đã ủy quyền một lần.

## 5. Rủi ro / việc tiếp theo

- Chưa kiểm tra trên stack thật (coordinator). Mã lỗi thật của 404 thêm thành viên chưa xác nhận trên stack thật.
- Một 401 do access token hết hạn khi đổi mật khẩu sẽ hiện "mật khẩu hiện tại không đúng" (hiếm: token được gia hạn chủ động trước khi hết hạn).
- Backend có thể vẫn tạo thông báo "Cần kết nối lại" khi test một kết nối chưa ủy quyền; web nay không cho gọi test ở trạng thái đó.
- Liên kết sidebar tới `/admin/users` thuộc lane B.
