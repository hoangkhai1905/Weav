# Plan: Web Workspace member management

> Scope: Web-only member mutations through the existing API Gateway; no backend/mobile/Workflow/AI/Bot changes.

## Goal

Connect the existing Workspace page to the public member APIs while preserving the existing user/workspace-scoped query and active-workspace store boundaries.

## Acceptance

- Add an existing active Identity user by the contract's `email` body; no invitation delivery or user search is invented.
- Update both optional workflow permission booleans through the contract route.
- Remove a non-owner member and let the authenticated member leave through the contract DELETE routes.
- Validate contract-shaped input, block duplicate mutation submits, preserve input/state on errors, show server error messages, and require explicit confirmations for destructive actions.
- Invalidate only the affected `userId`/`workspaceId` list, detail, and member queries; late responses cannot update another account or workspace.
- Leaving clears the selected workspace and lets the existing list query choose a remaining accessible workspace; HTTP never falls back to localStorage/mock mutation behavior.

## Files and symbols

1. `apps/web/src/api/workspace.api.ts`: add the four HTTP adapters and explicit mock-mode implementations; keep `mapMember` aligned with `MemberView`.
2. `apps/web/src/types/workflow.types.ts`: add the optional workflow-state permission field required by the mapped member view without breaking legacy explicit mock fixtures.
3. `apps/web/src/pages/WorkspacePage.tsx`: replace the disabled placeholder controls with email add, two permission controls, remove, and member leave UI; add mutation guards and scoped invalidation/selection cleanup.
4. `apps/web/e2e/workspace-members.spec.ts`: controlled Gateway fixtures through the real page for route/body mapping, gating, pending/error/confirm behavior, leave cleanup, and stale account/workspace responses.
5. `docs/work_logs/2026-09-22-web-workspace-members.md`: bounded plan, evidence, limitations, and handoff.

## Verification

- RED: run the focused Playwright member spec before production changes and record the expected failures.
- GREEN: run the focused member spec, then the workspace/OCR regression specs.
- Run `pnpm --dir apps/web build`, focused ESLint for changed Web files, and the repository's full Web lint for baseline comparison.
- Run `git diff --check`; do not commit, merge, push, restore, pop, or drop stash.
- Live authenticated browser evidence is separate from fixture evidence and is blocked unless Gateway, Identity, Workspace, approved test users, and a test workspace are available.
