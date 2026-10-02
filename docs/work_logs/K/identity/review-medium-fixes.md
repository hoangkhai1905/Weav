# Nhật ký: Identity - sửa các phát hiện mức Medium từ backend review (2026-10-02)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-10-02 |
| Nhánh / commit đầu | `refactor/optimize-backend` / `7836003` |
| Người thực hiện | AI agent (theo yêu cầu của K, Step 2 / Lane 7) |
| Trạng thái | Hoàn thành code + test, chưa commit |
| Phạm vi | ID-3 trong `services/identity-service` |
| Nguồn | `docs/reviews/2026-10-01-backend-review.md` (ID-3) |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Phương án khác | Hệ quả |
| --- | --- | --- | --- |
| ID-3: chuyển bộ đếm `AuthRateLimiter` sang Valkey bằng một Lua script (`INCR` + `PEXPIRE` ở lần đầu, cửa sổ cố định), dùng lại `StringRedisTemplate` như `ValkeyOtpChallengeStore` | Xoá map trong bộ nhớ, `maxEntries` và `removeIf` O(n): kẻ tấn công không thể làm đầy bộ nhớ để khoá mọi key mới; bộ đếm dùng chung giữa các replica | Giữ map nhưng đổi chính sách đầy | Mọi scope, limit, window giữ nguyên; `Retry-After` lấy từ `PTTL` của key |
| Key = `identity:ratelimit:<SCOPE>:<sha256 hex của định danh>` | Không lưu email/IP thô trong Valkey | HMAC có khoá | SHA-256 đủ cho mục đích này; định danh vẫn đoán được bằng từ điển nếu lộ Valkey (chấp nhận) |
| `LOGIN_ACCOUNT` chỉ đếm đăng nhập thất bại: `requireAllowed` (INCR nguyên tử, giữ chỗ) trước khi xác thực, `refund` (Lua DECR chỉ khi key tồn tại và > 0) khi đăng nhập thành công; `UnauthorizedException` thì giữ nguyên đơn vị đã giữ | Đăng nhập thành công không còn tốn ngân sách; mọi kết quả "authentication failed" của use case đều đi qua `UnauthorizedException` | Sửa `LoginUseCase` | Cách peek-rồi-ghi trước đó bị race (N request song song cùng lọt qua khi count < 10) nên đổi sang reserve-then-refund. Chỉ sửa `AuthController.login`; `LOGIN_IP` vẫn đếm mọi lần thử |
| Valkey lỗi: fail-open (cho qua) và log WARN chỉ có scope | Giữ khả năng đăng nhập khi Valkey sập; không để lỗi Valkey thành 500 | Fail-closed | Trong lúc Valkey sập không có chống brute-force/rate limit (có `// ponytail:` trong code); đổi sang fail-closed nếu mô hình đe doạ thay đổi |
| Test tích hợp dùng Valkey chia sẻ trong class phải xoá `identity:ratelimit:*` giữa các test | Trước đây mỗi context Spring bị dirty có bộ đếm riêng; giờ bộ đếm sống ngoài context | - | `OtpRecoveryHttpIntegrationTest` thêm `@BeforeEach` xoá key |

## 3. File thay đổi chính

- `infrastructure/security/AuthRateLimiter.java` (viết lại nội bộ; `requireAllowed` giữ nguyên chữ ký, thêm `refund`; constructor nhận `StringRedisTemplate` thay cho `Clock`).
- `presentation/http/AuthController.java` (`login`).
- Test: `AuthRateLimiterTest` (viết lại, Testcontainers Valkey), `AuthRateLimitFilterTest` (Valkey thật), `AuthControllerLoginRateLimitTest` (mới, Valkey thật, gồm ca 5 request song song khi đã có 9 lần sai: chỉ 1 lọt tới use case), `OAuthAccountControllerTest` (mock limiter), `OtpRecoveryHttpIntegrationTest` (xoá key giữa các test).
- Response khi bị chặn không đổi: 429, mã `RATE_LIMITED`, header `Retry-After`.

## 4. Kiểm tra

Xem mục "Kết quả" bên dưới.

## 5. Kết quả

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Unit/integration | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (từ `services/identity-service`) | 343 test, 0 failure, 3 error (Avatar: AvatarTransactionRollbackIntegrationTest, S3AvatarStorageIntegrationTest, AvatarHttpIntegrationTest; minio image không pull được, lỗi môi trường đã biết), 1 skipped (M3BrowserAcceptanceFixtureTest, đã skip sẵn) |
| Diff | `git diff --check` | PASS (chỉ cảnh báo CRLF/LF) |

## 6. Rủi ro và việc tiếp theo

- Fail-open khi Valkey sập (đã nêu ở trên).
- `LOGIN_ACCOUNT` có thể bị kẻ tấn công cố ý khoá một tài khoản bằng cách gửi sai mật khẩu 10 lần/15 phút; hành vi này đã tồn tại và không đổi.
- Nên cân nhắc metric/alert cho số lần fail-open khi có Micrometer (X-15).
