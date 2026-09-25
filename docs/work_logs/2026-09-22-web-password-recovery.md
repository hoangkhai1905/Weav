# Nhật ký ngày `2026-09-22`

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `api-gateway` / `7e14de0` (theo bàn giao đợt 14) |
| Người thực hiện | `Tesla / Luna Max worker - đợt 15A Web password recovery` |
| Người review / nhận bàn giao | `USER reviewer qua Astra` |
| Trạng thái cuối ngày | `Hoàn thành, chờ review` |
| Phạm vi session | Nối quên/đặt lại mật khẩu Web với Gateway/Identity OTP APIs đã có. |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-22-web-password-recovery.md` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Giữ route Web `/forgot-password` hiện có và hoàn thiện flow contract: forgot request -> OTP verify -> reset password; không tạo reset-link/deep-link hoặc backend contract mới.
- UI không khẳng định email đã gửi/account tồn tại, validate email/OTP/password/confirm, masked password, chống double-submit, giữ draft khi lỗi, map lỗi recovery an toàn và cooldown theo `retryAfter`.
- Late response sau unmount bị bỏ qua; thành công clear password fields và điều hướng về `/login` không auto-login, phù hợp backend revoke toàn bộ sessions và không cấp session mới.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | `pnpm --dir apps/web build`; chỉ còn warning bundle >500 kB hiện hữu. |
| Unit / integration test | `PASS` | Focused Playwright 21/21; regression profile/change-password/session 29/29 Chromium. |
| Migration / database | `Không áp dụng` | Không sửa backend/shared/database. |
| Health check | `Chưa kiểm tra live` | Không có runtime/mail sink/test account được phê duyệt trong scope. |
| Review thay đổi | `Đã kiểm tra` | Scoped ESLint PASS; `git diff --check` exit 0. |
| Commit / PR | `Chưa tạo` | Không stage/commit/merge/push theo yêu cầu. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Xác minh actual forgot/reset/OTP contract từ Gateway + Identity source/tests trước khi sửa Web.
2. Khép gap recovery Web với payload, validation, error, cooldown, stale-response và session semantics đúng contract.
3. Bàn giao bằng focused Playwright/build/lint/diff evidence, tách fixture khỏi live.

### Trong phạm vi

- `apps/web/src/pages/ForgotPasswordPage.tsx`
- `apps/web/e2e/password-recovery.spec.ts`
- `docs/superpowers/plans/2026-09-22-web-password-recovery.md`
- `docs/work_logs/2026-09-22-web-password-recovery.md`

### Ngoài phạm vi / chủ động chưa làm

- Không sửa `apps/mobile`, backend services, `packages/shared`, root config/lockfile, Gateway/Identity contract, SMTP, OTP endpoint, reset URL/deep-link hoặc deployment config.
- Không gửi email, đọc inbox, lấy reset token từ DB, đổi password tài khoản thật, hoặc gọi live authenticated flow.
- Không triển khai Workflow/AI/Bot và không tự mở đợt sau.

### Tiêu chí hoàn thành

- [x] Request/verify/reset dùng actual payload/status và không lộ sensitive values.
- [x] Generic forgot copy, validation, pending guard, cooldown, 400/429/network mapping, draft preservation và stale-response coverage.
- [x] Focused Playwright, regression Playwright, build, scoped lint, diff check và work log hoàn tất.
- [x] Fixture/live limitation được tách rõ; không commit/stage.

## 4. Bối cảnh và contract evidence

- **Gateway:** `services/api-gateway/src/identity/identity.module.ts` public-proxy routes `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, optional-bearer `POST /api/auth/otp/verify`; README route table xác nhận public/optional auth policy.
- **Forgot request:** Identity `ForgotPasswordRequest` chỉ nhận `{ email }`; `PasswordController` trả `202 Accepted`, `OtpReceiptResponse`, `Cache-Control: no-store`.
- **Receipt:** Identity `OtpReceiptResponse` là `{ challengeId, expiresIn, retryAfter }`; source/tests validate opaque 43-character challenge, default 300-second challenge TTL và 60-second resend cooldown. Unknown/disabled/OAuth-only account vẫn nhận opaque accepted receipt, nên Web dùng copy generic.
- **OTP delivery:** `RequestOtpUseCase` tạo 6-digit code và SMTP message; message không chứa reset grant. Không có source contract cho Web reset-link/deep-link callback.
- **Verify:** `VerifyOtpRequest` nhận 43-character `challengeId` + 6-digit `code`; response `PasswordResetVerificationResponse` chứa `purpose=PASSWORD_RESET`, opaque 43-character `resetToken`, `expiresIn`.
- **Reset:** `ResetPasswordRequest` nhận `{ resetToken, newPassword }`, password 8-72 chars; `PasswordController` trả `204 No Content` + `no-store`.
- **Session semantics:** `ResetPasswordUseCase` consume grant một lần/expiry-bound, đổi password, revoke all sessions của user; reset không cấp session mới. Web điều hướng sign-in và không tự logout/token mutate.
- **Errors:** backend tests cover invalid/stale/consumed grant and OTP as `400`, rate limit as `429`; Web chỉ hiển thị safe copy, không passthrough body.

## 5. Nhật ký theo session

### Session 1 - Contract, graph và test RED

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| `2026-09-22` | Đọc `AGENTS.md`, git status, plan/log đợt 14 | Shared worktree có thay đổi Mobile/Web; giữ nguyên toàn bộ ngoài ownership | Xong |
| `2026-09-22` | Đọc Gateway/Identity controllers, DTOs, use cases và recovery integration tests | Xác nhận OTP flow, payload/status/TTL/cooldown/mail/session semantics | Xong |
| `2026-09-22` | Chạy GitNexus upstream impact trước sửa | Initial index version mismatch; rebuild thành công; Web page/Login risk LOW; method names ambiguous/UNKNOWN, đã source-confirm | Xong |
| `2026-09-22` | Thêm focused Playwright fixtures | RED ban đầu do UI chưa có test id/confirm/state; late response test đã chứng minh yêu cầu cần guard | Xong |

### Session 2 - Implementation và verification

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| `2026-09-22` | Sửa recovery page tối thiểu trong ownership | 2-step OTP UI, safe errors, validation, confirm, pending ref, cooldown, unmount guard, no persistence | Xong |
| `2026-09-22` | Bổ sung tests payload/error/race | 7 focused scenarios x 3 browsers = 21/21 PASS | Xong |
| `2026-09-22` | Chạy regression đợt trước | `profile-integration + change-password + session-management` Chromium 29/29 PASS | Xong |
| `2026-09-22` | Chạy build/lint/diff | Build PASS; scoped ESLint PASS; diff check exit 0 | Xong |

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Giữ một route `/forgot-password`, không thêm reset URL | Backend chỉ phát OTP challenge và reset grant sau verify; không có link callback | Tạo `/reset-password?token=...` | Không có token trong URL/history/referrer; nếu backend sau này có link contract thì cần đợt riêng |
| Copy forgot generic dù response có challengeId | Identity trả opaque accepted receipt cho cả account không eligible để chống enumeration; SMTP async | Hiển thị “email sent” | Người dùng không được coi HTTP accepted là proof delivery |
| `resetToken` chỉ sống trong local async flow | Reset token là credential; backend cấp sau OTP và reset one-use | sessionStorage/localStorage hoặc analytics | Không persist/log token; retry không tự động |
| Cooldown lấy từ `retryAfter` | Receipt là nguồn contract; frontend không invent 60s | Hard-code UI cooldown | Countdown state khởi tạo từ response, interval chỉ cập nhật callback và cleanup |
| Map lỗi theo phase | Shared `AuthApiError` status không đủ ngữ cảnh cho OTP/reset | Hiển thị raw `Error.message` | Không lộ upstream body; draft giữ nguyên khi mutation fail |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `apps/web/src/pages/ForgotPasswordPage.tsx`: giữ route/page hiện có, bổ sung validate actual shape, generic accepted copy, confirm masked password, OTP/reset payload flow, safe status mapping, resend cooldown, duplicate-submit guard, operation/mounted guard và success navigation.
- `apps/web/e2e/password-recovery.spec.ts`: thêm HTTP UI fixtures cho exact payload, generic response, validation, duplicate submit, invalid OTP, cooldown, 429, invalid reset grant, successful 204 và late response after unmount.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không áp dụng.
- **Tính tương thích:** Chỉ consume existing Gateway/Identity APIs.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi config, lockfile, dependency, route deployment hoặc mail transport.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Giữ `POST /api/auth/forgot-password`, `POST /api/auth/otp/verify`, `POST /api/auth/reset-password` và exact field names từ Identity source.
- **Security:** Không lưu/log password, OTP, challenge hoặc reset grant; không đưa token vào URL/analytics/error copy; không auto-login sau reset.
- **Validation/error:** UI chặn invalid email/OTP/password/confirm; 400/429/401/403/502/503/network được map safe.
- **Health/metrics/logging:** Không thêm logging; live delivery chưa kiểm tra.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `apps/web/src/pages/ForgotPasswordPage.tsx` | Hoàn thiện OTP recovery UI/guards/error/cooldown | Chỉ Web recovery; không reset-link |
| `Thêm` | `apps/web/e2e/password-recovery.spec.ts` | Focused Playwright HTTP fixture tests | Fixture-only, không chứng minh SMTP live |
| `Thêm` | `docs/superpowers/plans/2026-09-22-web-password-recovery.md` | Bounded plan + contract evidence | Đọc trước khi tiếp tục |
| `Thêm` | `docs/work_logs/2026-09-22-web-password-recovery.md` | Session evidence/handoff | Không chứa secret/token/PII |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Focused Playwright | `pnpm --dir apps/web test:e2e -- e2e/password-recovery.spec.ts --workers=1` | `PASS; 21/21` | Chromium/Firefox/WebKit; HTTP fixtures, không live SMTP |
| Regression Playwright | `pnpm --dir apps/web test:e2e -- e2e/profile-integration.spec.ts e2e/change-password.spec.ts e2e/session-management.spec.ts --project=chromium --workers=1` | `PASS; 29/29` | Profile/password/session regression từ đợt trước |
| Scoped lint | `pnpm --dir apps/web exec eslint src/pages/ForgotPasswordPage.tsx e2e/password-recovery.spec.ts` | `PASS` | Chỉ files ownership mới |
| Web build | `pnpm --dir apps/web build` | `PASS` | Vite warning bundle >500 kB; không phải failure |
| Static/diff check | `git diff --check` | `PASS; exit 0` | Có warning CRLF conversion trên Mobile file ngoài scope |
| GitNexus pre-edit | `node .gitnexus/run.cjs analyze --index-only`; impact Web symbols | Rebuild PASS; `ForgotPasswordPage`/`LoginPage` risk LOW; ambiguous recovery method names source-confirmed | No HIGH/CRITICAL Web symbol identified |
| GitNexus change map | `node .gitnexus/run.cjs detect-changes --scope all --repo .` | `CRITICAL`, 39 files/31 flows | Shared worktree includes other workers/previous batches; ngoài scope, chưa commit |

### Điều chưa được kiểm tra

- Chưa chạy live Gateway/Identity + SMTP/mail sink vì không có runtime/test account/mail sink được user phê duyệt trong scope. Không coi fixture PASS là live PASS.
- Chưa gửi email hoặc đổi password tài khoản thật.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| `Cao` | Live mail/recovery chưa được kiểm chứng | Không có runtime + mail sink + approved test account trong session | Tách fixture evidence, không claim delivery | Reviewer cung cấp runtime/test setup nếu cần live pass |
| `Cao` | GitNexus all-worktree risk là `CRITICAL` | 39 dirty files/31 flows từ Mobile và các đợt khác; shared workspace | Không đụng/revert; scoped tests/build pass; ghi baseline | Astra/user review ownership trước integration |
| `Trung bình` | Recovery method impact ambiguous/UNKNOWN | Cùng tên `requestPasswordReset`/`resetPassword` ở Web/Gateway/Identity | Source-confirm controllers/DTO/use cases/tests; không sửa backend | Rerun impact với target UID/file nếu tooling cần |
| `Thấp` | Vite báo bundle >500 kB | Existing app bundle composition | Không mở rộng scope để code-split | Theo dõi ở đợt performance riêng |

## 11. Trạng thái bàn giao

### Có thể review ngay

1. Review `apps/web/src/pages/ForgotPasswordPage.tsx`: generic forgot copy, exact payloads, masked inputs, confirm, cooldown/pending guards, safe errors, no persistence, success navigation.
2. Review `apps/web/e2e/password-recovery.spec.ts`: fixture/live distinction và assertions 21 browser runs.
3. Review contract evidence trong `docs/superpowers/plans/2026-09-22-web-password-recovery.md` và kết quả commands phần 9.

### Cần quyết định / quyền truy cập từ người khác

- Nếu cần live acceptance, cần approved test account, running Gateway/Identity và controlled mail sink; không dùng inbox/account thật ngoài scope.
- Cần reviewer quyết định việc tích hợp shared worktree sau khi Mobile/đợt khác hoàn tất; worker này không stage/commit/merge/push.

### Checklist user review

- [ ] Forgot accepted response không bị copy thành “email sent”.
- [ ] OTP verify/reset payload/status đúng backend source.
- [ ] Confirm mismatch, invalid/expired OTP/grant, 429 và network không gửi sai request và giữ input.
- [ ] Double click chỉ có một verify/reset mutation.
- [ ] Resend bị khóa theo `retryAfter`, không auto retry.
- [ ] Reset success về sign-in, không auto-login; session revocation do backend authority.
- [ ] Không có token/password trong URL, storage, error copy hoặc test output.
- [ ] Live limitation được chấp nhận rõ, không nhầm fixture với live.

## 12. Tham chiếu

- `AGENTS.md`
- `docs/superpowers/plans/2026-09-22-web-password-recovery.md`
- `services/api-gateway/README.md`
- `services/api-gateway/src/identity/identity.module.ts`
- `services/identity-service/src/main/java/com/weav/identity/presentation/http/PasswordController.java`
- `services/identity-service/src/main/java/com/weav/identity/presentation/http/OtpController.java`
- `services/identity-service/src/main/java/com/weav/identity/application/usecase/RequestOtpUseCase.java`
- `services/identity-service/src/main/java/com/weav/identity/application/usecase/ResetPasswordUseCase.java`
- `services/identity-service/src/test/java/com/weav/identity/presentation/http/OtpRecoveryHttpIntegrationTest.java`
- `services/identity-service/src/test/java/com/weav/identity/presentation/http/PasswordRecoveryConcurrencyIntegrationTest.java`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi shared chưa commit; batch 15A đã sửa đúng Web recovery + focused docs, không stage |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Tesla / Luna Max worker` |
| Cần đọc trước khi tiếp tục | Phần 4 contract, phần 9 evidence, phần 11 handoff; giữ nguyên scope và live limitation |
