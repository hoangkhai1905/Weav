# Nhật ký: workspace-service, sửa findings mức Medium (WS-5, WS-4)

Nguồn: `docs/reviews/2026-10-01-backend-review.md` (WS-5 trong "Other security findings", WS-4 trong "Other idempotency findings"). Nhánh `refactor/optimize-backend`. Trạng thái: hoàn thành, chưa commit (coordinator review và commit).

## Quyết định

| Quyết định | Lý do | Ghi chú |
| --- | --- | --- |
| WS-5: `StartConnectionOAuthUseCase` không còn `markDisabled()` | Reconnect làm hỏng workflow đang dùng connection trong lúc chờ consent; bỏ consent thì connection hỏng luôn | Status và credential giữ nguyên tới bước complete (đã bound theo user + PKCE, WS-6). Completion vốn chấp nhận connection ACTIVE (`markVerified` giữ ACTIVE, không gửi lại "connected" vì state mang origin ACTIVE) nên không phải sửa. |
| WS-5: giữ `requireUnused(MEMBER_ONLY)` ở start | Đây là check phân quyền, không chỉ phục vụ việc disable; complete vẫn chặn member khi connection đang được workflow dùng, nên chặn sớm tránh bắt user consent vô ích | Owner vẫn bỏ qua check này (chính sách `MEMBER_ONLY` hiện hữu, không đổi). |
| WS-4: single-flight trong JVM theo `connectionId` (`ConcurrentHashMap<UUID, CompletableFuture>`) | Pool Hikari của workspace chỉ 3, không giữ row lock qua HTTP call tới Google | Có comment `ponytail:`: per-JVM, đa replica refresh đôi là vô hại vì Google không xoay refresh token khi refresh; nâng cấp lên Valkey lock nếu điều đó thay đổi. Entry được xoá trước khi future hoàn thành, lỗi được truyền cho mọi waiter, lần gọi sau thử lại. |
| WS-4: đọc lại credential trước khi refresh; ghi trong transaction ngắn với `FOR UPDATE` | Caller khác có thể vừa refresh | `CredentialRepository.findByConnectionIdForUpdate` (`PESSIMISTIC_WRITE`). Nếu credential đang lưu còn hạn và (đã bị thay id bởi reconnect, hoặc `expiresAt` muộn hơn bản gốc) thì giữ nguyên và trả token đang lưu thay vì ghi đè. Refresh token mới của Google được lưu, nếu không có thì giữ cái cũ. I/O Google vẫn ngoài transaction (mẫu X-2). |

## File thay đổi

- Sửa: `application/usecase/StartConnectionOAuthUseCase.java`, `application/usecase/ResolveConnectionUseCase.java`, `domain/port/out/CredentialRepository.java`, `infrastructure/persistence/repository/CredentialRepositoryAdapter.java`, `SpringDataCredentialRepository.java` (đều dưới `services/workspace-service/src/main/java/com/weav/workspace/`).
- Test: `GoogleOAuthUseCasesTest` (cập nhật assert DISABLED thành ACTIVE sau start cho connection đang ACTIVE, thêm `reconnectLeavesConnectionAndCredentialUntouchedUntilBoundCompletionSwapsIt`), `InternalConnectionUseCasesTest` (thay test refresh trùng lặp bằng `concurrentResolvesOfAnExpiredCredentialShareOneProviderRefresh`, thêm `failedSharedRefreshReachesEveryWaiterAndTheNextCallRetries` và `staleRefreshDoesNotOverwriteAFresherStoredCredential`, đổi `refreshKeepsCredentialReplacedByReconnectWhileGoogleIsResponding`).

## Hành vi người dùng thấy

- `POST .../oauth/authorize` chỉ trả `authorizationUrl` (không đổi field). Connection không còn chuyển sang DISABLED khi bấm Reconnect; trạng thái ACTIVE được giữ. Với connection mới/INVALID/DISABLED, status không bị đổi ở bước start nữa (trước đây INVALID bị chuyển thành DISABLED).
- `POST /internal/.../resolve`: nếu reconnect đổi credential trong lúc refresh đang chạy, trả token mới của credential đó thay vì lỗi 409 "Connection credential changed during refresh" (chỉ còn lỗi nếu credential mới cũng đã hết hạn).

## Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (workspace-service) | PASS, 386 chạy, 0 failures, 0 errors, 0 skipped (baseline 383) |
| `git diff --check` | sạch (chỉ cảnh báo CRLF/LF) |
| GitNexus impact upstream | `StartConnectionOAuthUseCase` LOW, `ResolveConnectionUseCase` LOW |

## Rủi ro và việc tiếp theo

- Single-flight chỉ trong một JVM; nhiều replica có thể refresh đôi (vô hại, xem trên).
- Chưa chạy trên stack thật hoặc Google thật; kiểm chứng bằng Testcontainers và fixture Google.
- Bước `detect_changes` và commit do coordinator thực hiện.

## WS-7 và WS-10 (key ring, AAD, eviction không nuốt lỗi)

| Quyết định | Lý do | Ghi chú |
| --- | --- | --- |
| WS-7: `AesGcmCredentialCrypto` có key ring: key hiện tại (`CREDENTIAL_ENCRYPTION_KEY` + `_VERSION`) và key cũ qua `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` (`version:base64key,version:base64key`, mặc định rỗng) | Xoay key không còn làm hỏng toàn bộ credential đã lưu | Key được kiểm tra (Base64, đúng 32 byte, version không trùng) khi khởi động; lỗi không in key. Decrypt chọn key theo `encryption_key_version` lưu cùng payload; version lạ trên payload format 2 thì fail closed (`Credential ciphertext is invalid`). |
| WS-7: envelope format byte `2` = AAD là 16 byte UUID của connection (big-endian); format `1` là bản cũ không AAD | Chặn hoán đổi ciphertext giữa các connection | Dòng cũ trên Neon (format 1, key hiện tại) vẫn giải mã được; format 1 có version không có trong ring thì thử key hiện tại. Port đổi: `encrypt(plaintext, connectionId)`, `decrypt(payload, keyVersion, connectionId)`. |
| WS-7: re-encrypt lazy | Không thêm job nền | Mọi lần ghi credential (save, OAuth complete, refresh) dùng key hiện tại + format 2. Không re-encrypt khi đọc. |
| WS-10: `RedisWorkspaceAuthorizationCache.evict` thử lại 3 lần (50/150/400 ms), hết lần thì log ERROR (`workspace_authorization_cache_evict_failed`, chỉ workspaceId) và không ném lỗi | Lỗi evict từng bị nuốt, thành viên bị xoá có thể còn quyền | Caller đã evict sau commit (`afterCommitExecutor`). Có comment `ponytail:`: tối đa còn quyền tới hết TTL cache (5 phút) nếu Valkey chết quá thời gian retry; nâng cấp lên outbox nếu cần. Không dùng version-stamp. |

Xoay key: đặt key cũ + version vào `CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS` (`v1:<base64>`), đặt key mới + version mới (`v2`) vào `CREDENTIAL_ENCRYPTION_KEY(_VERSION)`. Giữ key cũ trong danh sách tới khi mọi credential được ghi lại (refresh/reconnect/update). Chưa có công cụ liệt kê credential còn version cũ.

File: `CredentialCryptoPort`, `AesGcmCredentialCrypto`, `CredentialEncryptionProperties` (thêm `previousKeys`, constructor 2 tham số giữ lại), `CompleteConnectionOAuthUseCase`, `ResolveConnectionUseCase`, `SaveCredentialUseCase`, `TestConnectionUseCase`, `RedisWorkspaceAuthorizationCache`, `application.properties`; `.env.example`, `.env`, `compose.dev.yml` (biến mới). Test: `AesGcmCredentialCryptoTest` (round trip format 2, hoán đổi connection thất bại, legacy giải mã được, xoay key + ghi lại bằng key mới, version lạ fail closed, previous keys sai), `RedisWorkspaceAuthorizationCacheLoggingTest` (retry rồi thành công; thất bại hẳn log ERROR, không ném lỗi), các test cũ cập nhật chữ ký mới.
