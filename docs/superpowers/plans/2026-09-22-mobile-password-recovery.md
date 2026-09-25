# Mobile Password Recovery Implementation Plan

> **For agentic workers:** This plan is executed inline by Hubble with user review after handoff. Do not commit, merge, push, mutate stash, or touch Web/backend/shared/root config/lock files.

**Goal:** Nối Mobile với password recovery contract hiện có: forgot request, OTP verify và reset password, không invent email-link/deep-link flow.

**Architecture:** Thêm contract mapper thuần cho `POST /api/auth/forgot-password`, `POST /api/auth/otp/verify` và `POST /api/auth/reset-password`; mở rộng `AuthRepository` cho HTTP/mock explicit modes. Thêm một Expo Router auth screen theo state machine email → OTP + new password → success, với cooldown server-provided, gate chống duplicate và flow-generation guard để bỏ stale response; reset token chỉ giữ trong memory của screen.

**Tech Stack:** React Native/Expo 57, Expo Router, Axios shared client, Zustand auth store, Node CJS focused harness, TypeScript, Expo Web export.

**Spec:** User request đợt 15/15B và source contract `packages/contracts/http/auth/openapi.yaml`.

## Global Constraints

- Chỉ sửa `apps/mobile` và focused plan/log; không sửa Web/Tesla, backend, shared package, root config/lockfile hoặc stash.
- Dùng contract flow thật: forgot `202` receipt → OTP ngoài client → verify `200` reset grant → reset `204`; không tạo OTP/email/deep-link infrastructure mới.
- Receipt không chứng minh email delivery; không hiển thị challenge ID, reset token, password hay dữ liệu error chứa chúng.
- OTP/challenge lifetime là `300s`, resend cooldown là `retryAfter` server trả (contract hiện tại `60s`); không retry mutation tự động.
- Reset grant chỉ ở memory screen, gửi duy nhất trong JSON `resetToken`, không URL/storage/analytics/history/referrer.
- Reset success revokes all existing backend sessions nhưng không cấp session mới; Mobile chỉ clear local auth state nếu local session còn tồn tại rồi chuyển sign-in, không auto-login.
- Mock chỉ chạy khi `EXPO_PUBLIC_API_MODE=mock` explicit; HTTP lỗi không fallback mock/demo.

---

### Task 1: Lock recovery contract and stale-flow helpers with failing tests

**Files:**
- Create: `apps/mobile/src/infrastructure/http/password-recovery.http.contract.test.cjs`
- Create: `apps/mobile/src/features/auth/password-recovery.utils.test.cjs`
- Create during green step: `apps/mobile/src/infrastructure/http/password-recovery.http.contract.ts`
- Create during green step: `apps/mobile/src/features/auth/password-recovery.utils.ts`

**Interfaces:**
- `buildForgotPasswordRequest(email)` → `POST /api/auth/forgot-password`, body `{ email }` only.
- `buildVerifyOtpRequest(challengeId, code)` → `POST /api/auth/otp/verify`, body `{ challengeId, code }` only.
- `buildResetPasswordRequest(resetToken, newPassword)` → `POST /api/auth/reset-password`, body `{ resetToken, newPassword }` only.
- `mapPasswordResetReceipt(data)` accepts only `challengeId`, `expiresIn`, `retryAfter` with contract bounds.
- `mapPasswordResetVerification(data)` accepts only `purpose: PASSWORD_RESET`, 43-char grant and `expiresIn`.
- `assertPasswordRecoveryResponse(status, expected)` accepts only `202`, `200`, or `204` for the matching operation; `mapPasswordRecoveryError(status, operation)` exposes safe messages for `400/401/429/503` and generic fallback.
- `validatePasswordRecoveryInput(...)` covers email, six-digit OTP and 8–72 password/confirmation; `createPasswordRecoverySubmissionGate()` blocks duplicate submit; `isPasswordRecoveryFlowCurrent(capturedGeneration,currentGeneration,isMounted)` rejects stale/unmounted work.

- [x] Write tests for exact routes/body, no confirm/token leakage, receipt/verification mapping, strict statuses, validation, duplicate gate and stale-flow guard.
- [x] Run both new test files and confirm expected RED because the modules do not exist.
- [x] Implement only the mapper, safe error mapping and flow helpers required by tests.
- [x] Re-run both files and confirm GREEN.

### Task 2: Extend AuthRepository with HTTP and explicit mock recovery methods

**Files:**
- Modify: `apps/mobile/src/domain/auth/auth.types.ts`
- Modify: `apps/mobile/src/infrastructure/http/http-auth.repository.ts`
- Modify: `apps/mobile/src/infrastructure/mock/mock-auth.repository.ts`
- Extend: `apps/mobile/src/infrastructure/http/password-recovery.http.contract.test.cjs`

**Interfaces:**
- `requestPasswordReset(email: string): Promise<PasswordResetReceipt>`.
- `verifyPasswordResetOtp(challengeId: string, code: string): Promise<PasswordResetVerification>`.
- `resetPassword(resetToken: string, newPassword: string): Promise<void>`.

- [x] Add pure tests for repository-facing request configs and response status/mapping behavior.
- [x] Add HTTP methods using the shared client; verify `202/200/204`, map only safe status errors, preserve optional current auth transport for OTP verify, and never log/persist secrets.
- [x] Add explicit mock parity without localStorage or HTTP fallback; keep demo behavior isolated to mock factory mode.
- [x] Run contract tests and mobile typecheck for the repository surface.

### Task 3: Add bounded Mobile recovery screen and Login entry point

**Files:**
- Create: `apps/mobile/src/app/(auth)/forgot-password.tsx`
- Modify: `apps/mobile/src/app/(auth)/login.tsx`

**Interfaces:**
- Screen state transitions only through `email`, `challengeId`, `retryAfter`, `code`, `newPassword`, `confirmPassword`, `resetToken`, `success/error`, and pending gate.
- Forgot success shows generic accepted/cooldown copy, never delivery proof or account existence.
- Reset submit verifies OTP and immediately redeems returned grant; success clears local auth only if an authenticated local session still exists, then replaces route with `/(auth)/login`.
- Cleanup increments flow generation on unmount and when starting a new request; stale results cannot update the screen.

- [x] Add Login link to `/(auth)/forgot-password` without changing login/session persistence behavior.
- [x] Implement masked new-password/confirm fields, numeric six-digit OTP, validation, pending disabled state, inline safe errors, resend cooldown from receipt and user-initiated retry only.
- [x] Keep reset grant in memory only; do not put it in route params, storage, logs, analytics or error text.
- [x] Handle invalid/expired/used grant and rate-limit/service errors with clear recovery copy; preserve input and offer a new request path.

### Task 4: Regression, build and handoff

**Files:**
- Update: `docs/work_logs/2026-09-22-mobile-password-recovery.md`

- [x] Run focused recovery tests plus login/change-password/session auth regression tests from the existing CJS harness.
- [x] Run `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false`.
- [x] Run Expo Web export using the existing manifest command; distinguish export/fixture from live/native.
- [x] Check native deep-link/runtime prerequisites without reading secrets or sending email; do not create/reset any unapproved account.
- [x] Run `git diff --check`, inspect scoped status, update the log, and stop for user review without commit/push.
