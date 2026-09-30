# Nhật ký làm việc - 2026-09-22

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày / múi giờ | `2026-09-22` / `Asia/Saigon` |
| Repository / branch | `Weav` / `api-gateway` |
| Commit đầu ngày | `7e14de0` |
| Người thực hiện | Luna Max / Hubble |
| Người review / điều phối | User / Astra |
| Trạng thái | `Hoàn tất trong scope; native/live blocked` |
| Phạm vi | Mobile forgot/reset password qua Identity/Gateway hiện có |
| Plan | `docs/superpowers/plans/2026-09-22-mobile-password-recovery.md` |
| Ownership | Chỉ `apps/mobile` và focused plan/log này; không chạm Web/Tesla, backend, shared, root config/lockfile hoặc stash |

## 2. Tóm tắt điều hành

- Đã đọc và xác nhận đợt 14 hoàn tất trong scope; blocker còn lại là native/live evidence, không có tồn đọng chức năng trước khi mở đợt 15.
- Mobile Login có entry point tới màn `forgot-password`. Flow dùng contract thật: forgot request `202` → người dùng nhập OTP nhận qua email → verify `200` nhận reset grant → reset `204`.
- Receipt chỉ là accepted receipt, không chứng minh email delivery và không dùng để suy account existence. Reset grant chỉ nằm trong memory của màn hình, không đưa vào URL, storage, logs, analytics hoặc error copy.
- Reset thành công không auto-login. Nếu local auth session đang tồn tại, Mobile clear local auth sau backend `204`; backend đã revoke toàn bộ session theo source/test.

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- `apps/mobile`: AuthRepository types, HTTP contract/error mapping, explicit mock parity, Login link và Expo Router recovery screen.
- Focused CJS contract/validation/stale-flow tests, mobile typecheck, Expo Web export và prerequisite checks.
- Focused plan/log ngày này.

### Ngoài phạm vi

- Không sửa Web/Tesla, backend Identity/Gateway, shared package, root config/lockfile hoặc stash.
- Không tạo OTP endpoint, email transport, mail sink, deep-link scheme/interception hay reset-link callback mới.
- Không đổi SecureStore/session persistence ngoài việc clear local session nếu reset backend đã revoke sessions.
- Không gửi email/reset password cho account thật ngoài approved test account; không commit/merge/push/stage toàn bộ/restore/pop/drop stash.

### Tiêu chí hoàn thành

- [x] Request/response schema, OTP/reset grant, delivery/cooldown/expiry và session semantics được kiểm chứng từ source/OpenAPI/tests.
- [x] Login entry point và recovery UI có validation, masked password, pending/double-submit, generic copy, cooldown, error/retry và stale-flow guard.
- [x] HTTP/mock repository parity không fallback HTTP→mock, không persist secret.
- [x] Focused tests, typecheck, Expo Web export và diff check đã chạy.
- [ ] Native/live flow với approved mail sink/test account — bị chặn bởi môi trường, xem phần 10.

## 4. Contract và nguồn sự thật đã kiểm chứng

| Nguồn | Kết luận |
| --- | --- |
| `packages/contracts/http/auth/openapi.yaml` `/auth/forgot-password` | Public `POST`; request `{ email }`; success `202` với `OtpReceipt { challengeId, expiresIn, retryAfter }`; receipt generic, không đảm bảo delivery. |
| OpenAPI `OtpReceipt` | `challengeId` opaque 43-char base64url; `expiresIn=300`; `retryAfter=60`; không có OTP/code trong response. |
| `services/api-gateway/src/identity/identity.module.ts` | Forward `/api/auth/forgot-password` → Identity `/auth/forgot-password`; `/api/auth/otp/verify` → Identity `/auth/otp/verify`; `/api/auth/reset-password` → Identity `/auth/reset-password`; các route public/optional theo policy hiện có. |
| `PasswordController.java` / `OtpController.java` | Forgot tạo `PASSWORD_RESET` challenge; verify nhận `{ challengeId, code }` và trả `PASSWORD_RESET` + opaque `resetToken`; reset nhận `{ resetToken, newPassword }`, success `204`. |
| `RequestOtpUseCase.java` | Unknown/disabled/OAuth-only và eligible accounts dùng accepted receipt shape generic; SMTP dispatch asynchronous; account/IP admission; cooldown 60 giây. |
| `VerifyOtpUseCase.java` | OTP 6 chữ số, challenge/credential binding, grant at-most-once, reset grant TTL 300 giây; invalid/expired/consumed challenge trả generic invalid challenge. |
| `ResetPasswordUseCase.java` | Reset grant bị consume at-most-once trước hash; kiểm tra ACTIVE/current credential binding; đổi password, mark email verified và revoke all sessions; không cấp session. |
| `OtpRecoveryHttpIntegrationTest.java`, `PasswordRecoveryConcurrencyIntegrationTest.java`, `SmtpFailureHttpIntegrationTest.java` | Xác nhận flow end-to-end với Mailpit, generic receipts, stale grant rejection, concurrent at-most-once, SMTP async/failure semantics và `204` session revocation. |

Không có email-link/deep-link/token-in-URL contract. Client dùng OTP manual flow hiện có; delivery chỉ được backend/mail test sink kiểm chứng, không được Mobile tuyên bố từ `202`.

## 5. GitNexus / impact trước sửa

- Graph-first query: `pnpm dlx gitnexus@latest query "mobile password recovery forgot password OTP reset password login navigation" --repo . --limit 25`; kết quả nối các process forgot/reset/login và backend recovery tests.
- `AuthRepository`: `MEDIUM`, 40 upstream impacts, 2 implementations; lower-bound do interface/dynamic dispatch. Caller graph gồm `repository-factory`, `HttpAuthRepository`, `MockAuthRepository`, Login/Register và feature hooks.
- `HttpAuthRepository`: `LOW`, 24 upstream impacts; lower-bound do interface dispatch.
- `MockAuthRepository`: `LOW`, 24 upstream impacts; lower-bound do interface dispatch.
- `LoginScreen`: `UNKNOWN`, 0 resolved callers; đã source-confirm bằng Expo Router route/import và text search. Không coi UNKNOWN là all-clear.
- Không có HIGH/CRITICAL impact đáng tin cậy. GitNexus skill paths được AGENTS tham chiếu nhưng không tồn tại tại `.claude/skills`; dùng CLI `gitnexus@1.6.12` và source confirmation.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Hệ quả |
| --- | --- | --- |
| Dùng OTP manual thay vì reset link | Backend public contract chỉ trả receipt, OTP verify mới cấp reset grant; reset grant bị cấm đặt trong URL | Không thêm scheme/deep-link/email callback; native link verification vẫn là phần chưa có |
| Tách mapper `202/200/204` | Ba operation có response shape/status khác nhau và `additionalProperties: false` | Mapper reject response lệch contract; error copy không chứa secret |
| Reset grant chỉ local memory | OpenAPI yêu cầu gửi grant duy nhất trong JSON và không trả lại sau consume | Không persist/log/analytics/history token; unmount làm flow mất an toàn |
| `retryAfter` từ server điều khiển resend | Backend contract/source trả cooldown thực tế, hiện là 60 giây | UI disable resend trong cooldown; không tự retry mutation |
| Reset success clear local session nếu đang auth | Backend revoke all sessions, không cấp token/session | Không auto-login; sign-in lại bằng password mới |

## 7. Thay đổi đã thực hiện

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `apps/mobile/src/infrastructure/http/password-recovery.http.contract.ts` | Route builders, strict receipt/verification mappers, strict operation statuses và safe error mapping. |
| Thêm | `apps/mobile/src/infrastructure/http/password-recovery.http.contract.test.cjs` | Route/body, response safety, status và error tests. |
| Thêm | `apps/mobile/src/features/auth/password-recovery.utils.ts` | Contract validation, duplicate gate và stale/unmounted flow predicate. |
| Thêm | `apps/mobile/src/features/auth/password-recovery.utils.test.cjs` | Email/OTP/password validation, duplicate submit và stale flow tests. |
| Sửa | `apps/mobile/src/domain/auth/auth.types.ts` | Thêm receipt/verification types và `requestPasswordReset`, `verifyPasswordResetOtp`, `resetPassword`. |
| Sửa | `apps/mobile/src/infrastructure/http/http-auth.repository.ts` | Nối HTTP forgot/verify/reset qua shared client, map `202/200/204`, không retry/fallback. File đã có thay đổi từ các đợt trước. |
| Sửa | `apps/mobile/src/infrastructure/mock/mock-auth.repository.ts` | Mock parity explicit, không localStorage. File đã có thay đổi từ các đợt trước. |
| Thêm | `apps/mobile/src/app/(auth)/forgot-password.tsx` | Recovery state machine, masked fields, cooldown, generic copy, safe errors và in-memory grant. |
| Sửa | `apps/mobile/src/app/(auth)/login.tsx` | Thêm Forgot password entry point; không đổi login/session flow. File đã có thay đổi từ các đợt trước. |
| Thêm | `docs/superpowers/plans/2026-09-22-mobile-password-recovery.md` | Bounded plan và checklist đã hoàn tất. |
| Thêm | `docs/work_logs/2026-09-22-mobile-password-recovery.md` | Log focused này. |

Generated `.expo/types/router.d.ts` được Expo dùng nội bộ trong export/typecheck; không phải source/config được chỉnh thủ công. Vì generated route union stale, Login dùng canonical exported `/forgot-password` với Expo `Href` type; Expo export đã xác nhận route tồn tại.

## 8. Hành vi và giới hạn cần review

- Forgot form chỉ gửi email; accepted copy không nói chắc email đã gửi và không hiển thị challenge ID.
- Reset form chỉ cho code số 6 chữ số, new/confirm password masked; local validation 8–72 ký tự theo Identity contract.
- Resend chỉ user-triggered sau `retryAfter`; mutation không auto-retry và pending chống duplicate.
- Verify invalid/expired/used code hiển thị lỗi generic. Nếu verify thành công nhưng reset mutation thất bại, grant được coi consumed trong UI và người dùng phải request code mới; password input không bị log/persist.
- Reset grant không nằm trong route params, URL, SecureStore, AsyncStorage, analytics hay error text.
- Backend delivery/link callback không nằm trong client; live email delivery chưa được kiểm chứng vì không có Mailpit/test sink/runtime approved.
- Expo Web export chứng minh bundling/static route, không chứng minh native deep link, authenticated Gateway flow hoặc email delivery.

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| TDD RED | `node --test apps/mobile/src/infrastructure/http/password-recovery.http.contract.test.cjs apps/mobile/src/features/auth/password-recovery.utils.test.cjs` trước implementation | Expected `MODULE_NOT_FOUND` cho hai module mới | Đúng failure do module chưa tồn tại |
| Recovery + auth regression | `node --test apps/mobile/src/infrastructure/http/password-recovery.http.contract.test.cjs apps/mobile/src/features/auth/password-recovery.utils.test.cjs apps/mobile/src/infrastructure/http/password.http.contract.test.cjs apps/mobile/src/features/auth/change-password.utils.test.cjs apps/mobile/src/features/auth/auth-session.coordinator.test.cjs apps/mobile/src/features/profile/profile.utils.test.cjs apps/mobile/src/infrastructure/http/profile.http.contract.test.cjs apps/mobile/src/infrastructure/http/session.http.contract.test.cjs apps/mobile/src/features/auth/session-management.utils.test.cjs` | `34/34 PASS` | CJS contract/state harness; chưa phải native/live/email UI |
| Typecheck | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` | `PASS` | Compile only; route artifact được Expo export refresh |
| Expo Web export | `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <TEMP>/weav-mobile-password-recovery-final-export --no-minify` | `PASS`, 42 static routes gồm `/forgot-password` | Static/export proof; không phải native/deep-link/live Gateway/mail proof |
| Native availability | `adb devices` | Không có thiết bị | Không chạy native flow/deep-link |
| Runtime/harness | Kiểm tra listener `3000,5173,8081,8082,19000-19002` và `rg --files apps/mobile | rg -i '(playwright|detox|maestro|e2e)'` | Không có listener; không có mobile E2E harness | Không chạy authenticated UI/mail sink |
| Diff | `git diff --check` sau khi đóng log | PASS; chỉ warning CRLF/LF trên file worktree cũ | Không có whitespace error trong diff |

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý / bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | Chưa có native device, Gateway/Identity runtime, approved test account và mail sink | `adb devices` không liệt kê device; không có listener; backend Mailpit chỉ có trong service integration test | User review fixture/source; khi có test runtime, chạy recovery với account/test email được phép, không đọc inbox ngoài scope |
| Trung bình | Native reset-link/deep-link không có contract và không được triển khai | Backend flow hiện là OTP manual; reset grant bị cấm trong URL | Không thêm scheme/interception; nếu product cần email link phải mở task backend/client contract riêng |
| Thấp | Mobile lint baseline thiếu ESLint config | Đã biết từ đợt trước; không chạy lại để tránh Expo tự cài tooling | Không thêm dependency/lockfile; tách task lint riêng nếu cần |

## 11. Trạng thái bàn giao

### Đã hoàn thành

1. Mobile recovery flow nối đúng API contract và backend semantics; không sửa Web/backend/shared/root config/lock/stash.
2. `34/34` focused tests, typecheck và Expo Web export 42 routes PASS.
3. Không auto-login, không persist/log secret, không giả delivery, không fallback mock trong HTTP.
4. Không staged/commit/merge/push; stash và thay đổi các worker/đợt trước được giữ nguyên.

### Cần user review

1. Review [password-recovery.http.contract.ts](D:/End/Weav/apps/mobile/src/infrastructure/http/password-recovery.http.contract.ts), [http-auth.repository.ts](D:/End/Weav/apps/mobile/src/infrastructure/http/http-auth.repository.ts) và [forgot-password.tsx](D:/End/Weav/apps/mobile/src/app/(auth)/forgot-password.tsx).
2. Kiểm tra Login entry point, OTP/cooldown copy và behavior khi reset grant invalid/expired/consumed.
3. Khi có native device + approved test account + mail sink, kiểm chứng forgot `202`, nhận code, verify grant, reset `204`, login lại bằng password mới và session revocation; không dùng account thật ngoài test.
4. Xác nhận product có cần mở task riêng cho email reset link/deep-link hay giữ OTP manual flow.

### Bảo toàn worktree

- Final `git status --short` có `103` entries (`39` tracked modified, `64` untracked, `0` staged); package/lockfile không đổi.
- Không restore/pop/drop stash, không stage toàn bộ, không commit/merge/push. Web/Tesla, examples và mobile changes từ các đợt trước được giữ nguyên.

## 12. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22` / `Asia/Saigon` |
| Commit/PR | `Chưa tạo` |
| Người cập nhật | Luna Max / Hubble |
| Tiếp theo | User review; chờ `work done`, không tự mở đợt sau |

## Checklist trước khi đóng log

- [x] Tóm tắt rõ kết quả và phần chưa hoàn thành.
- [x] Contract/source semantics, file ảnh hưởng và giới hạn đã nêu.
- [x] Có lệnh tái lập cho RED/GREEN, test, typecheck, export và runtime checks.
- [x] Rủi ro/blocker và bước tiếp theo rõ ràng.
- [x] Không có secret, token, password, connection string hoặc PII nhạy cảm.
- [x] Trạng thái commit/PR/worktree đúng tại thời điểm ghi.
