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

## Step 3 / Low (WS-8, WS-9, WS-11, WS-13, WS-3)

| Mục | Quyết định | Ghi chú |
| --- | --- | --- |
| WS-8 | `POST /workspaces` nhận header tùy chọn `Idempotency-Key` (`[A-Za-z0-9._:-]{8,128}`, sai định dạng: 400). Bảng mới `workspace_idempotency (user_id, idem_key)` (V5), hàng được ghi cùng transaction với workspace. | Cùng key + cùng body: trả lại workspace gốc (201). Khác body: 422 `IDEMPOTENCY_KEY_REUSED`. Race: `INSERT ... ON CONFLICT DO NOTHING`, request thua đọc lại và trả workspace của request thắng. Không có header: hành vi cũ. FK `ON DELETE CASCADE DEFERRABLE` tới `workspaces`. Gateway đã chuyển tiếp `Idempotency-Key`, không sửa gateway. |
| WS-9 | `ListConnectionsUseCase`: một query `findAllByConnectionIdIn` thay cho N query; danh sách giới hạn 200 connection (cũ nhất trước). | Chưa có tham số phân trang (contract không đổi). Thêm `page/size` tùy chọn khi workspace cần hơn 200 connection. |
| WS-11 | `POST /internal/.../auth-failure` nhận thêm `credentialId` tùy chọn; nếu có và khác credential hiện tại thì bỏ qua (vẫn 204). | Follow-up (đã làm): `resolve` trả thêm `credentialId` và `credentialVersion` (= `updatedAt` của credential, epoch millis; null khi authType NONE). `auth-failure` nhận thêm `credentialVersion` tùy chọn; nếu có và khác version hiện tại thì bỏ qua (204), so sánh trong transaction đã khóa workspace, đọc credential bằng `findByConnectionIdForUpdate`. Không gửi: hành vi cũ. `updatedAt` đổi ở mọi lần refresh/lưu/reconnect (`@PreUpdate`); sau refresh version được đọc lại sau commit. Test: `InternalConnectionUseCasesTest` (version cũ bị bỏ qua sau refresh, version đúng/không gửi thì invalid). Contract `openapi.yaml` thêm hai trường resolve và `credentialVersion`. |
| WS-13 | Outbox notification: thêm cột `failed_at` (V6). Sau `weav.workspace.notification-outbox.max-attempts` (mặc định 10) lần lỗi: đặt FAILED, log ERROR một lần, không thử lại, giữ hàng. | Job `WorkspaceRetentionPurgeJob` (mỗi giờ, batch 1000, advisory lock): xoá hàng đã publish quá 14 ngày (`weav.workspace.retention.outbox-days`) và key idempotency quá 7 ngày (`idempotency-days`). Không xoá FAILED. |
| WS-3 | Bỏ qua. | `findCandidates` chỉ tải thành viên của một workspace (đã bị chặn bởi kích thước workspace) và Identity cần đủ danh sách id để lọc/sắp xếp theo tên; giới hạn sẽ đổi kết quả. Giữ nguyên, comment `ponytail:` trong `ListMembersUseCase` đã nêu lý do. |

Test mới: `WorkspaceUseCasePersistenceIntegrationTest` (replay, khác body 422, 3 thread cùng key ra 1 workspace), `ConnectionUseCasesTest` (1 query credential, cap 200), `InternalConnectionUseCasesTest` (credentialId cũ bị bỏ qua), `WorkspaceNotificationRuntimeIntegrationTest` (FAILED sau 10 lần, purge giữ FAILED và hàng mới). Contract: `packages/contracts/http/workspace/openapi.yaml` thêm header và `credentialId`.

| Lệnh | Kết quả |
| --- | --- |
| `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (workspace-service) | PASS, 409 chạy, 0 failures, 0 errors (baseline 403); sau WS-11 follow-up: 411 chạy, 0 failures |

Rủi ro: thêm phương thức vào `CredentialRepository` (port) và tham số `maxAttempts` vào constructor `NotificationOutboxPublisher`; mọi nơi gọi trong repo đã cập nhật.
