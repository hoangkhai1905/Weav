# Web change-password integration plan

## Goal

Connect the existing Web Settings password form to the existing Gateway/Identity `POST /api/auth/change-password` contract with the smallest behavior-preserving change. Keep backend, mobile, shared packages, root configuration, lockfiles, and unrelated Web work out of scope.

## Verified contract and acceptance criteria

- Request JSON is exactly `{ currentPassword, newPassword }`; the confirmation value is UI-only.
- Both submitted passwords follow Identity's policy: 8–72 Java characters and no more than 72 UTF-8 bytes. Password values are never logged or persisted by the change.
- Authenticated success is `204 No Content`; Identity changes the hash and revokes every user session, including the current bearer/refresh session. Web therefore clears the fields and clears the local auth session through the existing logout/store flow after a guarded success.
- `400`, generic `401` (`Authentication failed` for a wrong current password), `429`, `503`, and network failures remain safe, do not echo response bodies/passwords, and preserve input.
- A pending request disables the submit path and cannot be retried automatically or duplicated by repeated clicks.
- A response from a previous user/session cannot update or log out a current account after logout or account switch.

## Bounded implementation tasks

1. Add focused Playwright HTTP fixtures/tests before implementation for exact payload and 204/session handoff, contract validation, wrong-current-password/401 safety, 429/network failure preservation, duplicate-submit prevention, and logout/account-switch late-response isolation.
2. In `apps/web/src/pages/SettingsPage.tsx`, add exact client validation for the verified length/UTF-8-byte policy, remove the existing mock-only success branch, add stable password test locators, capture user/token identity for the mutation, and guard success/error/finally state against a changed account. On valid 204, clear fields then use the existing auth-store logout/navigation behavior required by Identity's revocation semantics.
3. Update only the existing Web VI/EN password-length copy needed to describe the backend policy; do not alter the auth API payload or contract.
4. Run the focused Playwright spec to establish GREEN, then run the Web build, scoped lint, full Web lint baseline, and scoped/full `git diff --check` without touching unrelated worktree changes.
5. Update `docs/work_logs/2026-09-22-web-change-password.md` with ownership, source evidence, exact files, commands/results, fixture-vs-live limits, risks, and review checklist. No commit, stage, stash, merge, push, or next task.

## Verification commands

- `pnpm --dir apps/web test:e2e -- e2e/change-password.spec.ts --project=chromium --workers=1`
- `pnpm --dir apps/web build`
- `pnpm --dir apps/web exec eslint src/pages/SettingsPage.tsx src/lib/i18n/translations.ts e2e/change-password.spec.ts`
- `pnpm --dir apps/web lint`
- `git diff --check`

Live authenticated verification is only allowed with an explicitly approved test account/runtime. Fixture tests must be reported as fixture evidence, not live backend evidence.
