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
