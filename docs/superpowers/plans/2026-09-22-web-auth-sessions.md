# Web auth session management Implementation Plan

> **For agentic workers:** Execute this plan in the current shared workspace. Preserve unrelated changes and stop after the bounded handoff; do not create another subtask.

**Goal:** Connect the existing Web Settings security UI to the verified Gateway/Identity session APIs so users can inspect paginated active sessions and revoke one session or all sessions using only backend-provided metadata and semantics.

**Architecture:** Keep `apps/web/src/api/auth.api.ts` as the HTTP boundary and extend only its safe error-status access if the UI needs status-specific messaging. Keep session state and request guards in `SettingsPage.tsx`, keyed by authenticated user and request generation so late responses cannot affect a switched account. Reuse `ConfirmButton`/`ConfirmModal`, the existing auth store, i18n, and API methods; do not change Gateway, Identity, shared contracts, Mobile, or root configuration.

**Tech Stack:** React + TypeScript + Vite, Zustand auth store, Axios API boundary, Playwright HTTP UI fixtures, pnpm scripts from `apps/web/package.json`.

**Verified contract:** Gateway `GET /api/auth/sessions?page=&size=`, `DELETE /api/auth/sessions`, and `DELETE /api/auth/sessions/{sessionId}` forward to Identity `/users/me/sessions`. Identity returns active sessions with only `id`, `createdAt`, `lastUsedAt`, `expiresAt`, `current`, and `userAgent`; page is zero-based, default size 20, size 1–100. Individual revoke of another user/missing target is 404; repeat owned revoke is 204. Revoke-all includes the current session and returns 204. Server-side active-session checks reject subsequent protected requests after revocation; the Web client must not claim cryptographic access-token invalidation.

## Global constraints

- Ownership is limited to `apps/web` and this focused plan/log pair.
- Do not touch Mobile, backend, shared packages, root config, lockfiles, or unrelated worker changes.
- Do not stage, commit, merge, push, stash, pop, restore, drop, or reset workspace changes.
- No avatar/email/password/OAuth/session-contract changes beyond this session-management slice; no Workflow/AI/Bot work.
- Do not invent IP, location, device, current-session, pagination, or revocation semantics; render only the verified response fields.
- No HTTP mock fallback in production code, no token/secret logging or persistence, and no automatic mutation retry.

## Tasks

### 1. Add RED focused Web coverage first

**Files:** `apps/web/e2e/session-management.spec.ts`

- Reuse the existing deterministic authenticated HTTP fixture pattern without changing shared test helpers.
- Cover actual API payload mapping and query pagination, contract metadata only, loading/empty/error/retry, confirm-cancel with zero DELETE, single-session revoke and refetch, revoke-all/current-session behavior, duplicate-submit prevention, safe 401/403/404/429/network errors, expired auth, and late list/mutation responses after account switch.
- Keep fixture evidence separate from live evidence; do not use a real account or revoke a real user session.
- Run the focused spec before production edits and record the expected RED baseline.

### 2. Implement the smallest Settings/API/i18n changes

**Files:**

- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/api/auth.api.ts` (only if needed for status-safe UI mapping)
- `apps/web/src/lib/i18n/translations.ts`

- Add page state and controls for the verified zero-based session pagination.
- Add retry and stable loading/empty/error states; map known HTTP statuses to safe localized messages without exposing upstream bodies.
- Reuse `ConfirmButton`; ensure cancel closes without a request, confirm is scoped, all session mutations are pending-guarded, and no mutation auto-retry occurs.
- Refetch the active list after a successful non-current revoke. After a verified current/all revoke, clear local auth only when the request still belongs to the same authenticated account; do not assert immediate JWT invalidation.
- Capture user/token identity for each async list/mutation request and ignore late responses after logout/account switch.
- Preserve existing profile/password/OAuth settings behavior and do not rewrite unrelated Settings UI.

### 3. Verify regressions and handoff

- Run the focused session Playwright spec, then existing profile and change-password specs.
- Run the Web build and the manifest-defined scoped lint command; report any full-lint baseline separately if applicable.
- Run `git diff --check` and inspect only owned paths; distinguish pre-existing/out-of-scope failures.
- Update `docs/work_logs/2026-09-22-web-auth-sessions.md` with contract evidence, exact files, commands/results, fixture vs live evidence, limits, and reviewer checklist.
- Do not commit or stage. Stop after the handoff and wait for the user’s next `work done`.
