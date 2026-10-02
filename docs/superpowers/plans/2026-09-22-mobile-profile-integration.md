# Mobile Profile Integration Implementation Plan

> **For agentic workers:** Keep this plan bounded to `apps/mobile` and the focused mobile work log. Do not edit Web, shared packages, backend services, root configuration, or lockfiles.

**Goal:** Connect the existing mobile profile surface to the authenticated Identity/Gateway `GET/PATCH /api/auth/me` alias, allowing only the contract-supported `displayName` field to be viewed and edited without changing tokens or session persistence.

**Architecture:** Keep `useAuthStore` as the sole in-memory current-user source. Add a user-scoped React Query read key for the server-authoritative profile and a non-retrying mutation. Apply GET/PATCH results only when the captured user ID is still the authenticated user; never persist profile data or tokens in a new storage path. Explicit mock mode keeps interface parity; HTTP mode never falls back to mock/local data.

**Tech Stack:** Expo 57, React Native, Expo Router, Zustand, TanStack Query, Axios, TypeScript, Node `--test` CJS contract/state harness.

## Scope and acceptance

- Confirmed source contract: Identity `/users/me`; Gateway aliases `GET/PATCH /api/auth/me` and `GET/PATCH /api/users/me`.
- PATCH body is exactly `{ displayName }`; `displayName` is required, `null`/blank clears, non-blank is trimmed, maximum 120 characters. Email, password, avatar, role, status, IDs and timestamps are not editable here.
- Profile loads with loading/error/retry states and shows the server response when available.
- Save validates locally, disables duplicate submission, preserves draft on HTTP/validation errors, uses no automatic mutation retry, and does not show success on failure.
- Success updates the same auth-store user used by Home/Profile/current-user and leaves access/refresh tokens unchanged.
- Logout, account switch, or a stale response cannot publish a previous account's profile or resurrect a session.
- Regression remains green for session restore, workspace cache isolation, and notification auth paths when relevant.

## Planned files and symbols

1. `apps/mobile/src/domain/auth/auth.types.ts`
   - Extend `AuthRepository` with `updateCurrentUser(displayName: string | null)`.
   - Preserve the existing `UserProfile` shape and token/session contracts.
2. `apps/mobile/src/infrastructure/http/http-auth.repository.ts`
   - Reuse the authenticated Axios client and existing `/api/auth/me` alias.
   - Add contract-grounded profile request/error mapping and PATCH response mapping.
3. `apps/mobile/src/infrastructure/mock/mock-auth.repository.ts`
   - Add explicit mock-mode parity for the new repository method only; no HTTP fallback.
4. `apps/mobile/src/stores/auth.store.ts`
   - Add an account-guarded profile update action that cannot modify tokens.
5. `apps/mobile/src/features/auth/useAuthSession.ts`
   - Include the user-scoped current-user query in logout/account-switch cleanup.
6. `apps/mobile/src/features/profile/profile.utils.ts` and `hooks/useProfile.ts`
   - Keep display-name normalization/validation, user-scoped GET, guarded PATCH, and pending/error behavior in one reusable feature path.
7. `apps/mobile/src/app/(app)/(tabs)/profile.tsx`
   - Add the editable display-name field and inline loading/error/save states while preserving the existing profile/workspace/tools UI.
8. Focused mobile tests under `apps/mobile/src/features/profile/` and `apps/mobile/src/infrastructure/http/`
   - Cover route/body/response mapping, validation, duplicate submission, server failure/input preservation, and account/logout race guards.
9. `docs/work_logs/2026-09-22-mobile-profile-integration.md`
   - Record actual contract sources, impact results, commands, runtime evidence/blockers, and review checklist.

## Verification commands

- `node --test` for the focused profile/auth CJS tests, then all `apps/mobile/src/**/*.test.cjs` tests.
- `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false`.
- `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <temporary-dir> --no-minify`.
- `pnpm --dir apps/mobile lint` only as a baseline check; do not install tooling or alter lockfiles when the known mobile lint config is absent.
- `git diff --check -- apps/mobile docs/superpowers/plans/2026-09-22-mobile-profile-integration.md docs/work_logs/2026-09-22-mobile-profile-integration.md`.

## Review boundary

- No commit, merge, push, stash mutation, stage-all, formatter-wide rewrite, Web/mobile-backend contract change, avatar/email/password/OAuth work, or Workflow/AI/Bot work.
- Fixture/Node tests, Expo Web export, native-device evidence, and live authenticated Gateway evidence must be reported separately.
