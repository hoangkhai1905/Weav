# Nhật ký: Gateway - không chuyển Bearer cũ lên Identity ở route auth công khai

## Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-11 |
| Nhánh | `fix/gateway-public-auth-bearer` (từ `dev` @ `5c2fdb8`) |
| Phạm vi | `services/api-gateway` (không đụng Identity, web, mobile) |
| Trạng thái | Hoàn thành, đã kiểm tra, đã commit; chưa merge vào `dev` |
| Tham chiếu | Mobile đã sửa phía client: `4296676` trên `feature/mobile-handoff-w5-w6` |

## Vấn đề

- `POST /api/auth/refresh` kèm `Authorization: Bearer abc.def.ghi` -> `502 BAD_GATEWAY "Invalid Identity response"`; không kèm header -> `400`.
- Nguyên nhân: `IdentityProxyService.forward` chuyển nguyên header `Authorization` cả khi route là `auth: 'none'`.
  Spring resource server của Identity từ chối Bearer không hợp lệ kể cả trên route `permitAll`, trả `401` body rỗng,
  không có `content-type` (đã kiểm tra trực tiếp `localhost:8081/auth/refresh`). `relay` coi mọi phản hồi không phải JSON là `502`.

## Quyết định

- Route `auth: 'none'` (login, register, refresh, logout, oauth/mobile/exchange, forgot-password, reset-password) bỏ hẳn
  header `Authorization`: các path này đều `permitAll` ở Identity và chỉ đọc body (logout dùng `refreshToken` trong body).
  Route `optional`/`required` không đổi: guard của gateway đã verify token trước khi gọi upstream.
- Dự phòng trong `relay`: upstream `401` không có JSON -> trả `401 UNAUTHORIZED "Invalid or expired access token"` thay vì `502`.
  Các mã khác không phải JSON vẫn `502`.
- Web (`apps/web/src/api/auth.api.ts`) không gửi Bearer khi refresh/login/logout (`authRequest` không có interceptor);
  chỉ `otp/verify` (optional, đã được guard verify) và OAuth exchange intent `LINK` (gọi thẳng Identity) có Bearer. Không cần sửa web.
- GitNexus impact: `IdentityProxyService.forward` **HIGH** (25 caller trực tiếp, đều là route proxy trong `identity.module.ts`, 0 process);
  `relay` LOW. Thay đổi chỉ ảnh hưởng nhánh `auth: 'none'` và nhánh `401` không phải JSON.

## File thay đổi

- `services/api-gateway/src/identity/identity.module.ts`
- `services/api-gateway/test/auth.e2e-spec.ts`: 8 test mới (Bearer cũ bị bỏ trên 6 route công khai + mobile exchange; `401` rỗng -> `401`).
  Suite đặt `GATEWAY_AUTH_RATE_LIMIT=1000` vì test policy, không test throttle (`limits-health.e2e-spec.ts` đã phủ).

## Kiểm tra

- Test mới trên code cũ: 8 fail, đều `Received: 502` (đúng lỗi báo cáo). Trên code mới: pass.
- `pnpm --dir services/api-gateway test`: 152/152 pass.
- `pnpm --dir services/api-gateway test:e2e`: 144/144 pass (9 suite).
- `pnpm --dir services/api-gateway build`: OK. `eslint` 2 file: sạch. `git diff --check`: sạch.
- Live: gateway đang chạy (bản cũ) `:3000` -> `502`; bản build mới chạy tạm `:3010` trỏ Identity `:8081` -> `400 VALIDATION_ERROR` (giống khi không có header). Tiến trình tạm đã dừng.

## Việc tiếp theo

- Rebuild container gateway (`docker compose ... up -d --build api-gateway`) sau khi merge để stack dev có bản sửa.
- Tùy chọn (Identity): đặt `oauth2ResourceServer(o -> o.authenticationEntryPoint(...))` để 401 từ Bearer sai cũng có body JSON như các lỗi khác.
