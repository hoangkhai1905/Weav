# Web Workspace read + switch foundation

## Metadata

- Date: 2026-09-21
- Branch: `api-gateway`
- Scope: Web workspace list/detail/members read, active-workspace switch, user/cache isolation, OCR workspace binding.
- Out of scope: mobile, create/rename workspace, member mutations, Workflow execution, AI, Bot, backend contracts.
- Status: Complete for this batch — awaiting user review; no commit/merge/push.

## Brainstorming decision

The smallest safe slice is to make the existing Workspace page the single workspace-selection surface, move active workspace state out of auth into one dedicated in-memory store, and put list/members reads behind React Query keys scoped by `userId` and `workspaceId`. HTTP is the default; local mock data is available only when `VITE_API_MODE=mock`. Member mutation controls stay visibly disabled in HTTP mode until a real adapter is intentionally added.

## Implementation plan

1. API contract adapter: update `apps/web/src/api/workspace.api.ts` with authenticated Gateway list/detail/members reads, PageResult/MemberView mapping, explicit mock branch, and no HTTP-to-localStorage fallback.
2. Session state/query boundary: add `apps/web/src/store/useWorkspaceStore.ts` and `apps/web/src/hooks/useWorkspace.ts`; remove the duplicate `activeWorkspace` field from `apps/web/src/store/useAuthStore.ts`; clear workspace state and cache on logout/user change from `apps/web/src/components/layout/AppLayout.tsx`.
3. UI: update `apps/web/src/pages/WorkspacePage.tsx` with a real workspace selector, loading/error/empty/403/404 states, member query by selected ID, and disabled unsupported member mutations in HTTP mode.
4. OCR: update `apps/web/src/pages/WorkflowBuilderPage.tsx` and `apps/web/src/api/ocr.api.ts` so extraction requires the selected workspace ID and never defaults to `ws-main`.
5. Verification: add focused Playwright fixture coverage for mapping, switch/member isolation, empty/error/403, user cache isolation, and OCR URL/no-request behavior; run focused E2E, web build, lint, and `git diff --check`.

## Acceptance criteria

- Gateway requests are made only to `/api/v1/workspaces`, `/api/v1/workspaces/{workspaceId}`, and `/api/v1/workspaces/{workspaceId}/members` with contract pagination fields.
- HTTP failures remain errors; they never return mock/localStorage data.
- Only an ID returned by the current user's list can become active; a stale/forbidden/not-found workspace is cleared and explained.
- Workspace list and member query keys include the authenticated user ID; member keys also include the selected workspace ID; previous members are not rendered during a switch.
- Logout/user change clears workspace state and workspace query cache.
- OCR uses the selected real workspace ID; missing selection blocks before any request.
- HTTP member invite/permission/remove controls are disabled with a clear unsupported message; no fake success is persisted.

## Pre-edit GitNexus impact

- `useAuthStore`: HIGH; 8 direct callers and downstream App/Notifications/Settings/WorkflowBuilder paths. Only `activeWorkspace` is removed; auth behavior remains.
- `WorkspacePage`, `WorkflowBuilderPage`, `AppLayout`: LOW direct impact through `App`.
- `workspaceApi`, `ocrApi`: UNKNOWN from graph due unresolved module/property edges; confirmed by source search that WorkspacePage calls workspace methods and WorkflowBuilder calls OCR.
- `ocrApi.extractText`: LOW; direct caller is `WorkflowBuilderPage.handleRunOcr`.
- `workspaceApi.getMembers`: LOW; direct caller is the current WorkspacePage fetch path.

## Test plan

- Playwright fixture tests in `apps/web/e2e/workspace-read-switch.spec.ts` and focused OCR assertions in the same spec.
- Commands are taken from `apps/web/package.json`: `pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts`, `pnpm --dir apps/web build`, `pnpm --dir apps/web lint`.
- Fixture green is not live authenticated runtime proof; real browser/service prerequisites will be reported separately.

## Changes and results

### Complete/tested

- `apps/web/src/api/workspace.api.ts`: authenticated HTTP list/detail/members adapter, contract pagination parsing, `WorkspaceResponse`/`MemberView` mapping, explicit `VITE_API_MODE=mock` branch, and no HTTP localStorage fallback.
- `apps/web/src/store/useWorkspaceStore.ts` + `apps/web/src/hooks/useWorkspace.ts`: one active-workspace source, user/workspace-scoped React Query keys, cache/state cleanup on logout/user change, and access-loss removal.
- `apps/web/src/pages/WorkspacePage.tsx`: selector constrained to returned IDs; loading/error/empty/member loading/403/404 states; previous members hidden during switch; HTTP member mutations visibly disabled.
- `apps/web/src/pages/WorkflowBuilderPage.tsx` + `apps/web/src/api/ocr.api.ts`: deep-link workspace hydration, selected workspace context, required OCR workspace ID, and no `ws-main` fallback/request when missing.
- `apps/web/src/store/useAuthStore.ts`: removed duplicate `activeWorkspace` state; auth behavior otherwise unchanged.
- `apps/web/e2e/workspace-read-switch.spec.ts`: six Chromium fixture tests covering list mapping, switch/member ID, empty, 403, logout/login isolation, and OCR URL/no-request behavior.
- `apps/web/e2e/ocr-builder.spec.ts`: existing OCR fixtures now provide authenticated workspace data and assert a real fixture workspace ID instead of `ws-main`.
- `docs/work_logs/2026-09-21-web-workspace-read-switch.md`: plan, decisions, evidence, risks, and handoff.

### Commands and results

- `pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts --project=chromium --workers=1 --retries=0 --timeout=15000` → **6 passed**.
- `pnpm --dir apps/web test:e2e -- e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=20000` → **7 passed**.
- Focused ESLint over changed web source/spec files → **passed**.
- `pnpm --dir apps/web build` → **passed**; Vite emitted the existing bundle-size warning (>500 kB), no build error.
- `pnpm --dir apps/web lint` → **blocked by pre-existing `apps/web/src/pages/SettingsPage.tsx` findings**: errors at lines 76 and 82 (`react-hooks/set-state-in-effect`) and one missing `t` dependency warning at line 106. Changed files pass focused ESLint; `SettingsPage.tsx` was not changed.
- `git diff --check` → **passed** (no output).
- Gateway suite was not rerun because this batch changes no Gateway/backend contract; fixture routes use the already verified contract paths.

### Browser/runtime evidence

- Browser evidence is fixture-only Chromium, not a live authenticated service run. The six workspace tests and seven OCR tests exercised the browser UI, intercepted Gateway paths, auth headers, workspace switching, cache isolation, and OCR multipart path.
- Live authenticated browser evidence is unavailable in this batch because no real Identity session/credentials and confirmed running Gateway + Workspace/Identity runtime were supplied. No real records were seeded or modified.
- Runtime prerequisites for live verification: web `VITE_API_MODE=http`, Gateway reachable at configured `VITE_API_BASE_URL`/`VITE_API_GATEWAY_URL`, valid Identity bearer session, and Workspace/Identity services reachable behind Gateway.

### In progress

- None in code. Waiting for user review; next batch must not start until the user sends `work done`.

### Blockers/risks

- Existing user-owned untracked directories are preserved: `3dviz-pro-max/`, `examples/motion-primitives-website/`.
- The static Topbar workspace label was intentionally left outside this slice; the authoritative selector is the Workspace page control and the active ID is held only by `useWorkspaceStore`.
- No secrets, `.env` contents, or real data were read or printed.

### Handoff

- Review the diff for the new API/store/hook boundary, selector behavior, 403/404 clearing, and disabled member mutation controls. No commit/merge/push was made in this batch.
