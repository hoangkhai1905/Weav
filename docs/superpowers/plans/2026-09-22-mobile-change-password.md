# Mobile Change Password Implementation Plan

> **For agentic workers:** This plan is executed inline by Luna Max with user review after handoff. No commit, merge, push, stash mutation, or cross-worker file edits are allowed.

**Goal:** Nối Mobile Settings với `POST /api/auth/change-password` qua Gateway bằng contract Identity hiện có và dọn local session đúng semantics `204` + revoke-all.

**Architecture:** Bổ sung một request builder/error mapper thuần cho password-change, thêm method vào `AuthRepository` và cả HTTP/mock implementations. Settings dùng form local với password masking, contract validation, duplicate-submit gate và scope guard theo user/session; thành công gọi `expireAuthSession()` để clear local session mà không gửi revoke/logout thừa, vì backend đã revoke toàn bộ session.

**Tech Stack:** React Native/Expo 57, Expo Router, Zustand auth store, Axios shared client, Node CJS focused harness, TypeScript compiler, Expo Web export.

**Spec:** User request đợt 13/13B và source contract `packages/contracts/http/auth/openapi.yaml` `/auth/change-password`.

## Global Constraints

- Chỉ sửa `apps/mobile` và `docs/superpowers/plans/2026-09-22-mobile-change-password.md` cùng focused work log.
- Không sửa Web, backend, shared package, root config/lockfile hoặc worker Tesla; không restore/pop/drop stash, stage toàn bộ, commit, merge hay push.
- Request body chỉ có `currentPassword` và `newPassword`; không log/persist password, không gửi `confirmPassword`.
- Current/new password validate contract 8–72 ký tự và non-blank; confirm password chỉ là UI validation.
- HTTP errors không fallback mock; mock chỉ chạy khi `EXPO_PUBLIC_API_MODE=mock` explicit.
- Backend `204` revokes every session including current; client clears local session and routes to login, without inventing another server revoke.
- No automatic retry for mutation, no OAuth/forgot/reset password, no auth persistence redesign.

---

### Task 1: Lock contract and pure validation behavior with failing tests

**Files:**
- Create: `apps/mobile/src/infrastructure/http/password.http.contract.test.cjs`
- Create: `apps/mobile/src/features/auth/change-password.utils.test.cjs`
- Create during green step: `apps/mobile/src/infrastructure/http/password.http.contract.ts`
- Create during green step: `apps/mobile/src/features/auth/change-password.utils.ts`

**Interfaces:**
- `buildChangePasswordRequest(currentPassword, newPassword)` returns an Axios request config for `POST /api/auth/change-password` with only the two contract fields.
- `validateChangePassword({ currentPassword, newPassword, confirmPassword })` returns field-safe validation errors for blank/length/mismatch input.
- `createChangePasswordSubmissionGate()` permits one in-flight mutation and blocks duplicates.
- `isChangePasswordScopeCurrent(capturedUserId, capturedRefreshToken, currentUserId, currentRefreshToken, isAuthenticated)` rejects logout/account-switch late responses.

- [x] Write tests for exact route/body, omission of `confirmPassword`, 8–72 validation, confirmation mismatch, duplicate submit, same-session scope and logout/account-switch scope.
- [x] Run the two new test files with `node --test`; confirmed expected RED failures because the pure modules did not exist yet.
- [x] Implement only the request builder, strict `204` response check, safe status mapper (`400`, `401`, `429`, fallback/network), validation, gate and scope predicate needed by those tests.
- [x] Re-run the two files and confirm GREEN.

### Task 2: Add repository operation without changing session lifecycle

**Files:**
- Modify: `apps/mobile/src/domain/auth/auth.types.ts`
- Modify: `apps/mobile/src/infrastructure/http/http-auth.repository.ts`
- Modify: `apps/mobile/src/infrastructure/mock/mock-auth.repository.ts`
- Extend: `apps/mobile/src/infrastructure/http/password.http.contract.test.cjs`

**Interfaces:**
- `AuthRepository.changePassword(currentPassword: string, newPassword: string): Promise<void>`.
- `HttpAuthRepository.changePassword` sends the builder config using the shared authenticated client, resolves only on the backend `204`, maps failures to safe `AuthRepositoryError`, and never retries/falls back.
- `MockAuthRepository.changePassword` exists only for explicit mock mode and preserves the same interface shape.

- [x] Add contract tests for request payload and safe mapping of wrong-current-password `401`, validation `400`, rate limit `429`, and network/no-status failure.
- [x] Run the focused contract tests and verify RED for the missing contract surface, then GREEN after implementation.
- [x] Add the interface and minimal HTTP/mock implementations; do not alter tokens or call logout/revoke.
- [x] Re-run focused contract tests and verify GREEN.

### Task 3: Add bounded Settings form and local session handoff

**Files:**
- Modify: `apps/mobile/src/app/(app)/settings/index.tsx`
- Modify: `apps/mobile/src/stores/i18n.store.ts` only for password form copy if needed

**Interfaces:**
- Settings owns masked current/new/confirm password fields and local form error/pending state.
- Submit captures current user ID and refresh token, validates locally, calls `authRepository.changePassword`, and applies success only if the captured session is still current.
- On valid `204`, clear fields, call `expireAuthSession()`, show safe re-login copy, and navigate to `/(auth)/login`.
- On failure, preserve fields and show the repository’s safe message; no automatic retry or success toast.

- [x] Add the form controls with `secureTextEntry`, accessible labels/test IDs, pending disabled state and inline error.
- [x] Wire validation, gate and captured-session guard; keep success/error state local and do not persist passwords.
- [x] Wire successful backend semantics to local `expireAuthSession()` only; do not call `logoutAuthSession()` or a second revoke endpoint.
- [x] Review source for late response after logout/account switch and confirm it cannot clear or mutate the replacement account.

### Task 4: Focused regression, build and handoff

**Files:**
- Update: `docs/work_logs/2026-09-22-mobile-change-password.md`

- [x] Run focused password tests plus required profile/session regression tests from existing CJS harness: `23/23 PASS`.
- [x] Run `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false`: `PASS`.
- [x] Run Expo Web export to a temp directory using the existing manifest command: `PASS`, 40 routes.
- [x] Check native/live prerequisites without reading secrets; separate fixture, Expo Web export and native/live evidence.
- [x] Run `git diff --check`, report exact status and scoped files, and stop for user review without commit/push.
