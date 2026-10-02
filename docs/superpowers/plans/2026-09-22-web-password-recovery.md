# Plan: Web password recovery via Identity/Gateway OTP contract

- **Goal:** Nối luồng quên/đặt lại mật khẩu Web với các API recovery đã có, giữ đúng contract OTP của Identity qua Gateway và không làm lộ account/token/password.
- **Scope:** `apps/web` recovery API/UI và focused Playwright HTTP fixtures; focused plan/work log `web-password-recovery`.
- **Out of scope:** Backend/shared/Mobile/root config hoặc lockfile; reset-link/deep-link/email transport/OTP endpoint mới; forgot/reset live mail delivery ngoài runtime và test account được phê duyệt; Workflow/AI/Bot.
- **Acceptance criteria:**
  - `POST /api/auth/forgot-password` gửi `{ email }`, xử lý `202 { challengeId, expiresIn, retryAfter }` bằng copy generic, không khẳng định email đã gửi hay account tồn tại.
  - UI thực hiện `POST /api/auth/otp/verify` với `{ challengeId, code }`, sau đó `POST /api/auth/reset-password` với `{ resetToken, newPassword }`; không persist/log token hoặc password.
  - Validate email/OTP/password/confirm ở UI, password masked, pending chống double-submit, cooldown dùng `retryAfter`, không tự retry mutation; lỗi 400/429/network an toàn và reset success quay về sign-in không auto-login.
  - Stale response không cập nhật state sau flow reset/unmount; input vẫn giữ khi request thất bại; success clear sensitive fields qua navigation.
  - Regression login/change-password/session cần thiết không bị đổi.
- **Verification:** focused Playwright HTTP fixtures cho payload/generic response/validation/double submit/429/invalid-or-expired OTP/reset/success; `pnpm --dir apps/web build`; scoped ESLint; `git diff --check`. Live mail/runtime chỉ ghi nhận nếu có sẵn, không coi fixture là live.
- **Rollback:** Xóa/revert riêng các file recovery Web và focused docs của đợt này; không restore/stash/drop hoặc chạm changes ngoài ownership.

## Contract evidence

- Gateway public routes: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`, optional-bearer `POST /api/auth/otp/verify`.
- Identity `PasswordController`: forgot returns `202` + `OtpReceiptResponse`, reset returns `204` + `Cache-Control: no-store`.
- Identity `OtpController`: verify accepts 43-character `challengeId` + six-digit `code`, returns `PASSWORD_RESET`, opaque `resetToken`, and grant `expiresIn`.
- Identity `RequestOtpUseCase`: challenge TTL is five minutes, resend cooldown is 60 seconds in the verified integration defaults; mail contains a six-digit code, never the reset grant. Unknown/disabled/OAuth-only accounts receive an opaque accepted receipt without a deliverable challenge.
- Identity `ResetPasswordUseCase`: grant is one-use/expiry-bound and successful reset revokes every session for that user. The response does not issue a new session, so Web returns to sign-in.
- No backend source/test evidence provides a reset URL/deep-link callback to Web; this slice remains OTP-entry based.

## Graph/tooling note

GitNexus upstream impact was attempted for `requestPasswordReset`, `ForgotPasswordPage`, `resetPassword`, and `LoginPage`, but the local index reported a storage-version mismatch and `risk: UNKNOWN`. Direct source confirmation established the route chain before editing; the work log records this tooling limitation.
