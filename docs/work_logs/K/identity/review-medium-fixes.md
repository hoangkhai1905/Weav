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

## 7. ID-7: avatar (decode, giới hạn upload, dọn dẹp bền vững)

| Quyết định | Lý do | Đánh đổi |
| --- | --- | --- |
| `AvatarImageValidator`: đọc width/height từ header ImageReader trước khi decode; từ chối > 8192 mỗi cạnh hoặc > 40 MP; ảnh lớn hơn 1024 px được decode bằng `setSourceSubsampling(n, n, 0, 0)` (n = ceil(max(w,h)/1024)) | Ảnh 4000x3000 từ điện thoại vẫn được chấp nhận (decode ra 1000x750 ~ 3 MB) mà header "30000x30000" bị từ chối trước khi cấp phát | Ảnh lớn bị thu nhỏ khi lưu (tối đa ~1024 px); reader WebP có thể bỏ qua subsampling, trần bộ nhớ khi đó là 40 MP |
| `AuthRateLimiter.Scope.AVATAR_UPLOAD_USER(10, 1 giờ)`, key = user id (JWT subject), kiểm tra đầu `PUT /users/me/avatar` | Giới hạn chi phí decode/S3 mỗi user; cùng phản hồi 429 `RATE_LIMITED` như các scope khác | Mọi lần upload đều tốn đơn vị, kể cả upload lỗi |
| Migration `V7__avatar_cleanup.sql`: bảng `avatar_cleanup(object_key PK, user_id, created_at, next_attempt_at, attempts, last_error)` | Thay hàng đợi trong bộ nhớ (mất khi restart, bị tràn) | Thêm `user_id` và `next_attempt_at` (cần cho `storage.delete(userId, key)` và backoff) |
| `UpdateAvatarUseCase`/`DeleteAvatarUseCase` ghi hàng cleanup của key cũ trong CÙNG transaction đổi/xoá key; bỏ lệnh xoá S3 trực tiếp sau commit | Rollback không để lại hàng; commit không bao giờ mất key cũ; S3 vẫn ngoài transaction | Object cũ bị xoá trễ tối đa một chu kỳ reconciler (30 s) thay vì ngay |
| `AvatarCleanupReconciler` (giữ lịch 30 s): claim tối đa 20 hàng `FOR UPDATE SKIP LOCKED` (lease 5 phút), xoá S3 ngoài transaction, rồi xoá hàng; lỗi thì `attempts+1`, `last_error` (tên exception), backoff luỹ thừa tối đa 10 phút; đủ 10 lần: log ERROR, giữ hàng, bỏ qua | An toàn nhiều replica, không giữ kết nối khi gọi S3 | Hàng bỏ cuộc cần xử lý thủ công |
| Object mới mồ côi (upload xong nhưng DB lỗi) giữ đường cũ: xoá ngay, lỗi thì `enqueue` (autocommit) | Không đổi hành vi | - |

File: `application/validation/AvatarImageValidator.java`, `infrastructure/security/AuthRateLimiter.java`, `presentation/http/AvatarController.java`, `application/usecase/{Update,Delete}AvatarUseCase.java`, `infrastructure/storage/AvatarCleanupReconciler.java`, `db/migration/V7__avatar_cleanup.sql`. Tồn đọng: `weav.avatar.storage.cleanup-queue-capacity` (`AVATAR_S3_CLEANUP_QUEUE_CAPACITY`) giờ không còn tác dụng, có thể xoá ở lượt dọn cấu hình sau.
Test mới: `AvatarImageValidatorTest` (4000x3000 JPEG, header 30000x30000), `AvatarControllerRateLimitTest` (Valkey, lần 11 -> 429), `AvatarCleanupReconcilerIntegrationTest` (rollback không để lại hàng, xoá object+hàng, lỗi tăng attempts, bỏ cuộc sau 10 lần), `AvatarLifecycleUseCaseTest` (sửa theo hàng đợi bền vững).
Kết quả ID-7: `./mvnw verify` 349 test, 0 failure, 3 error (3 Avatar minio đã biết), 1 skipped; `git diff --check` sạch.

## 8. ID-5: đăng ký lộ email đã tồn tại (quyết định: chấp nhận rủi ro, ghi lại)

| Quyết định | Lý do | Đánh đổi |
| --- | --- | --- |
| Giữ `POST /auth/register` trả 409 khi email đã tồn tại (phương án b) | Người dùng chọn (a) chỉ khi mail đã nối cho luồng đăng ký. Hiện mail chỉ dùng cho OTP; đăng ký tạo user `ACTIVE` ngay và trả user, nên đổi sang 202 + email là đổi contract mà web/mobile đang dùng | Kẻ tấn công dò được email đã đăng ký; giảm nhẹ bởi `REGISTER_IP` 5 lần/phút (Valkey, ID-3). Xem lại nếu thêm xác minh email khi đăng ký |

## Step 3 / Low (ID-9, ID-10, ID-11)

- **ID-9**: tìm kiếm user escape `!`, `%`, `_` (`SpringDataUserRepository.escapeLike`, gọi trong `UserRepositoryAdapter.findPage`) và dùng `LIKE ... ESCAPE '!'`; kết quả với input thường không đổi. Migration `V8__user_search_trgm_and_session_retention.sql`: `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public` + GIN trigram index trên `lower(email)` và `lower(coalesce(display_name,''))`. Lưu ý: cần quyền tạo extension trên Neon (pg_trgm được hỗ trợ).
- **ID-10**: `SessionRetentionPurgeJob` (hằng giờ, batch 1000, `pg_try_advisory_xact_lock`) xóa `user_sessions` có `COALESCE(revoked_at, expires_at) < now() - N ngày` (`weav.identity.session-retention-days`, mặc định 30); session revoke trong cửa sổ N ngày được giữ nên grace/reuse không bị ảnh hưởng. Cùng migration V8 thêm index một phần `idx_user_sessions_active (user_id, expires_at) WHERE revoked_at IS NULL`.
- **ID-11**: `AuthRateLimitFilter` giới hạn theo IP `POST /auth/reset-password` (10 / 15 phút) và `POST /auth/logout` (30 / 1 phút), 429 giống các scope khác. Đường dẫn khớp route gateway.
- Test: `AuthRateLimitFilterTest` (reset/logout 429), `DirectoryUserQueryIntegrationTest.searchTreatsLikeWildcardsLiterally`, `SessionRetentionPurgeJobIntegrationTest`. Kết quả `mvnw verify`: xem báo cáo của coordinator.

Kiểm tra lại (coordinator, 2026-10-02): `./mvnw verify` 352 test, 0 failure, 3 error (3 Avatar minio đã biết), 1 skipped. Đã sửa các assert `Retry-After` cứng (60/900) trong `AuthRateLimitFilterTest` thành khoảng [cửa sổ-5, cửa sổ] vì giá trị lấy từ TTL còn lại trên Valkey (flake 59 vs 60 có từ ID-3).
