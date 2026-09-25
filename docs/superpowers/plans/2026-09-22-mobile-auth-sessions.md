# Mobile Auth Sessions Implementation Plan

> **For agentic workers:** This plan is executed inline by Hubble with user review after handoff. Do not commit, merge, push, mutate stash, or touch Tesla/Web/backend files.

**Goal:** Nối Mobile Settings với các API quản lý phiên Identity/Gateway hiện có, hiển thị đúng metadata contract và revoke một/tất cả session theo semantics backend.

**Architecture:** Mở rộng `AuthRepository` bằng page/list và revoke operations, dùng một HTTP contract mapper strict cho `SessionPageResponse` và `204`. Hook React Query dùng key `['auth-sessions', userId, ...]`, server-provided `current`, manual pagination/refetch, mutation `retry:false`, và scope guard theo user + refresh token. Settings chỉ render metadata contract, confirm trước DELETE, local-expire khi current/all bị revoke, và invalidate/refetch khi revoke session khác.

**Tech Stack:** React Native/Expo 57, Expo Router, React Query, Zustand auth store, Axios shared client, Node CJS focused harness, TypeScript, Expo Web export.

**Spec:** User request đợt 14/14B và source contract `packages/contracts/http/auth/openapi.yaml` session endpoints.

## Global Constraints

- Chỉ sửa `apps/mobile` và `docs/superpowers/plans/2026-09-22-mobile-auth-sessions.md` cùng focused work log.
- Không sửa Web/Tesla, backend, shared package, root config/lockfile hoặc stash; không restore/pop/drop/stage toàn bộ/commit/merge/push.
- Không hiển thị hoặc persist access token, refresh token, token hash, raw IP, hoặc dữ liệu ngoài `SessionResponse`.
- Không suy diễn location/device/current session; dùng duy nhất `current` từ server.
- GET query có `page` zero-based, `size` 1–100; UI giữ page state và không coi page đầu là toàn bộ.
- Mutation không auto-retry; HTTP không fallback mock. Mock parity chỉ chạy khi API mode mock explicit.
- DELETE one/all thành công `204`; one current và collection đều revoke current theo contract, nên local session phải clear mà không gọi thêm logout/revoke.
- Late query/mutation response sau logout/đổi account không được ghi/invalidate cache của account mới.

---

### Task 1: Lock session contract, mapping and scope behavior with failing tests

**Files:**
- Create: `apps/mobile/src/infrastructure/http/session.http.contract.test.cjs`
- Create: `apps/mobile/src/features/auth/session-management.utils.test.cjs`
- Create during green step: `apps/mobile/src/infrastructure/http/session.http.contract.ts`
- Create during green step: `apps/mobile/src/features/auth/session-management.utils.ts`

**Interfaces:**
- `buildListSessionsRequest(page, size, signal?)` returns GET `/api/auth/sessions` with query `page,size`.
- `buildRevokeSessionRequest(sessionId, signal?)` returns DELETE `/api/auth/sessions/{encodedSessionId}`.
- `buildRevokeAllSessionsRequest(signal?)` returns DELETE `/api/auth/sessions`.
- `mapSessionPageResponse(data)` returns only `AuthSessionPage` fields from the contract and rejects malformed pagination/items.
- `assertSessionMutationResponse(status)` accepts only `204`; `mapSessionError(status)` maps safe `401/403/404/400/500/unknown` errors.
- `isAuthSessionScopeCurrent(capturedUserId, capturedRefreshToken, currentUserId, currentRefreshToken, isAuthenticated)` guards late responses.

- [x] Write tests for exact routes/query, safe metadata mapping without token/IP fields, pagination, strict `204`, status mappings, current/other scope and account-switch scope.
- [x] Run the two new test files and confirm expected RED because modules do not exist.
- [x] Implement only the contract mapper, strict response assertion, safe errors and scope predicate needed by tests.
- [x] Re-run the two files and confirm GREEN.

### Task 2: Add AuthRepository HTTP/mock operations

**Files:**
- Modify: `apps/mobile/src/domain/auth/auth.types.ts`
- Modify: `apps/mobile/src/infrastructure/http/http-auth.repository.ts`
- Modify: `apps/mobile/src/infrastructure/mock/mock-auth.repository.ts`
- Extend: `apps/mobile/src/infrastructure/http/session.http.contract.test.cjs`

**Interfaces:**
- `listSessions(page?: number, size?: number, signal?: AbortSignal): Promise<AuthSessionPage>`.
- `revokeSession(sessionId: string, signal?: AbortSignal): Promise<void>`.
- `revokeAllSessions(signal?: AbortSignal): Promise<void>`.

- [x] Add pure contract tests for list/revoke request payloads and page mapping before repository implementation.
- [x] Add authenticated HTTP methods using the shared client, captured access-token guard for 401 local expiry, strict `204`, no retry and no raw Axios error propagation.
- [x] Add explicit mock parity without writing localStorage or pretending HTTP success.
- [x] Re-run focused contract tests and typecheck the repository surface.

### Task 3: Add scoped React Query hook and cache cleanup

**Files:**
- Create: `apps/mobile/src/features/auth/hooks/useAuthSessions.ts`
- Modify: `apps/mobile/src/features/auth/useAuthSession.ts`

**Interfaces:**
- `authSessionKeys.all(userId)` and `.list(userId,page,size)` are user-scoped.
- `useAuthSessions()` exposes page data/loading/error/refetch, page navigation, `revokeSession` and `revokeAllSessions` mutations.
- List retry is bounded/manual-error aware; mutations use `retry:false`.
- Non-current revoke invalidates `authSessionKeys.all(userId)` after a still-current scope; current/all revoke calls `expireAuthSession()` only after success.

- [x] Add query with `page,size`, `signal`, `enabled` auth/token gate and `gcTime:0`.
- [x] Add mutation context capturing user ID + refresh token; skip invalidation/local expiry if scope changed.
- [x] Add `auth-sessions` to account-scoped cache cleanup so logout/account switch removes old data.
- [x] Keep list 401 behavior aligned with existing `expirePersistedAuthSession` flow and do not retry mutations.

### Task 4: Add Settings session list and confirm actions

**Files:**
- Modify: `apps/mobile/src/app/(app)/settings/index.tsx`

- [x] Render loading, empty, error/retry, page controls and contract-safe metadata (`userAgent`, timestamps, `current` only).
- [x] Confirm single revoke with consequence text; cancel must not call repository. Allow current session revoke only with explicit current-session warning.
- [x] Confirm revoke-all with explicit “includes current session / sign in again” consequence; disable duplicate actions while pending.
- [x] Show safe mutation errors for `401/403/404/400/500`; do not fake success or infer device/location/IP.

### Task 5: Regression, build and handoff

**Files:**
- Update: `docs/work_logs/2026-09-22-mobile-auth-sessions.md`

- [x] Run focused session tests plus auth/profile/password regression tests from the existing CJS harness.
- [x] Run `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false`.
- [x] Run Expo Web export to a temp directory using the existing manifest command.
- [x] Check native/live prerequisites and separate fixture, Expo Web, native and live evidence; never revoke a non-test account.
- [x] Run `git diff --check`, inspect scoped status, and stop for user review without commit/push.
