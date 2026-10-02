# Nhật ký: Identity - sửa các phát hiện mức High từ backend review (2026-10-01)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-10-01 |
| Nhánh / commit đầu | `refactor/optimize-backend` / `3521cd6` |
| Người thực hiện | AI agent (theo yêu cầu của K) |
| Trạng thái | Hoàn thành code + test, chưa commit |
| Phạm vi | ID-1, ID-2, ID-8, ID-4 trong `services/identity-service`; `compose.dev.yml` cho ID-2 |
| Nguồn | `docs/reviews/2026-10-01-backend-review.md` (ID-1, ID-2/GW-2, §5.1) |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Phương án khác | Hệ quả |
| --- | --- | --- | --- |
| ID-1: lưu `previous_refresh_token_hash` + `rotated_at` (V6), grace 10 s (`weav.auth.refresh-reuse-grace`) | Request retry sau khi mất response không còn bị đăng xuất; replay token cũ ngoài grace bị coi là đánh cắp và thu hồi session | Cache token mới mã hóa 10 s; trả 409 | Trong grace, hai request cùng token đều thành công (tuần tự hoá bằng khoá hàng); token cũ hơn một lần xoay chỉ bị 401 thường (không thu hồi) |
| ID-1: thu hồi session khi reuse được commit rồi mới ném 401 | Ném exception trong transaction sẽ rollback phần revoke | Dùng `noRollbackFor` | `RefreshSessionUseCase` trả null trong transaction rồi ném sau khi commit |
| ID-2: `server.forward-headers-strategy=native`, `internal-proxies=${IDENTITY_TRUSTED_PROXY_PATTERN:^$}` | Mặc định tin không ai; test với Tomcat thật xác nhận giá trị rỗng cũng KHÔNG rơi về regex private-range mặc định, nhưng vẫn dùng `^$` để tường minh | Để mặc định của Tomcat (tin mọi dải private, spoof được) | Pattern phải khớp IP gateway ghim trong compose |
| ID-2: mạng `edge` (172.31.250.0/24), gateway ghim 172.31.250.10, identity có alias `identity-edge` chỉ trên `edge`; gateway gọi `http://identity-edge:8080` (biến tuỳ chọn `GATEWAY_IDENTITY_SERVICE_URL`) | Gateway và identity cùng nằm trên 2 mạng thì DNS có thể trả IP mạng default và IP nguồn không phải IP ghim; alias riêng buộc đi qua `edge`. Không đổi mạng `default` để khỏi recreate network đang chạy | Ghim IP trên `default` | `IDENTITY_SERVICE_URL` trong `.env` không còn áp dụng cho gateway (workspace-service vẫn dùng); `.env` không cần đổi |
| ID-8: verify Valkey ngoài transaction; transaction ngắn khoá user, kiểm tra lại trạng thái/fingerprint rồi mới ghi | Không giữ khoá hàng + connection khi chờ Valkey | - | Rủi ro còn lại: challenge đã bị tiêu thụ nhưng re-check/commit lỗi, người dùng phải xin OTP mới (đã ghi chú trong code) |
| ID-4: claim lô bằng `UPDATE ... WHERE event_id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n) RETURNING` (lease = 2 x confirm-timeout + 10 s qua `next_attempt_at`), publish có confirm ngoài transaction, settle ở transaction thứ hai | Không giữ connection/khoá trong lúc chờ broker; nhiều instance vẫn an toàn | Claim token riêng | At-least-once giữ nguyên: crash giữa publish và settle thì hết lease sẽ gửi lại, `messageId = eventId` |

## 3. File thay đổi chính

- Migration `V6__refresh_token_reuse_detection.sql` (cộng thêm, nullable; rollback an toàn bằng cách bỏ qua cột).
- `UserSession`, `UserSessionJpaEntity`, mapper, `UserSessionRepository` + adapter/Spring Data (tra cứu theo previous hash, có `FOR UPDATE`), `RefreshSessionUseCase`, `IdentityApplicationConfig`.
- `VerifyOtpUseCase`, `IdentityNotificationOutboxPublisher`.
- `application.properties` (main + test), `compose.dev.yml`.
- Test: `RefreshSessionUseCaseTest`, `RefreshConcurrencyIntegrationTest`, `TrustedProxyForwardedHeaderTest` (Tomcat thật, 4 ca), `VerifyOtpUseCaseTest`, `IdentityNotificationOutboxPublisherIntegrationTest` (thêm ca lô 3 sự kiện), `AdminUserHttpIntegrationTest` (stub repo).
- Docs: `docs/specs/services/identity-service.md`, `packages/contracts/http/auth/openapi.yaml` (mô tả refresh, thêm, không đổi schema).

## 4. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Unit/integration | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (từ `services/identity-service`) | 334 test, 0 failure; 3 error Avatar (minio image không pull được, lỗi môi trường đã biết). Lần chạy đầu có 4 failure là hệ quả hành vi grace (test replay ngay lập tức, version Flyway mới nhất) và đã sửa test |
| Compose | `docker compose -f compose.yml -f compose.dev.yml [overlay] --profile app config -q` với ai-local, workflow-smoke, colab-ocr, ocr-models | PASS (cả 6 tổ hợp) |
| Diff | `git diff --check` | PASS (chỉ cảnh báo CRLF/LF) |

## 5. Rủi ro và việc tiếp theo

- IP ghim `172.31.250.10` và `IDENTITY_TRUSTED_PROXY_PATTERN` trong `compose.dev.yml` phải luôn khớp; production cần đặt pattern theo IP/CIDR thật của gateway (hoặc LB) và xác nhận identity không truy cập trực tiếp được (X-6).
- Trong cửa sổ grace, hai refresh đồng thời cùng token đều thành công; client nên luôn lưu token trả về sau cùng.
- Subnet 172.31.250.0/24 chưa bị mạng Docker nào dùng trên máy này lúc kiểm tra; nếu trùng, đổi cả subnet lẫn IP.
- Chưa chạy stack thật qua gateway để xác nhận XFF end to end (không `compose up` theo yêu cầu); đã có test Tomcat thật cho phần identity.
- `user_sessions` chưa có retention (ID-10), ngoài phạm vi.
