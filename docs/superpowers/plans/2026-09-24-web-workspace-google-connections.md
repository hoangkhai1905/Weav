# Web Workspace Google Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web workspace selector and Gmail/Google Sheets connection management real, using the existing Workspace Service through API Gateway.

**Architecture:** Add an explicit Gateway allowlist for the eight Google connection operations already implemented by Workspace Service. Replace web demo state with a typed HTTP adapter, user/workspace-scoped queries and an OAuth return flow bound to the selected workspace. Workspace Service remains the source of truth for permissions, status and credentials.

**Tech Stack:** NestJS/Fastify/Zod Gateway; Spring Boot Workspace Service; React/Vite/TypeScript; Zustand; TanStack Query; Playwright; pnpm 11.22.0.

**Spec:** `docs/superpowers/specs/2026-09-24-web-workspace-google-connections-design.md`

## Global constraints

- Web first; mobile is a later phase.
- Gmail uses existing `gmail.metadata` scope only; no Gmail send. Google Sheets keeps the backend's existing `spreadsheets` scope.
- Use existing Workspace HTTP contract and service. Do not change persisted data or expose `/internal/...` or manual credential routes for this phase.
- Keep all public credential data write-only and all OAuth authorization URLs out of logs and persistent storage.
- The local Vite web origin is `http://localhost:5173`; the current local OAuth frontend return URL points to port 3000 and must be corrected in development configuration without silently changing the service's direct-run default.
- Preserve the user's dirty worktree. Before any code edit, inspect `git status`, the relevant diff and GitNexus upstream impact for each existing symbol. Treat `UNKNOWN` as unresolved, confirm by text search and warn before any HIGH/CRITICAL edit.
- Keep API and UI copy in Vietnamese and English. Do not display unsupported health, latency, workflow-count or environment claims.
- For every implementation milestone, run focused verification, review `git diff`, run `git diff --check`, update a dated work log, then run GitNexus `detect-changes --scope all --repo .` before any commit. `partial` or `truncated` is not a clean result.

## File map and ownership

| Area | Files | Responsibility |
| --- | --- | --- |
| Gateway | `services/api-gateway/src/workspace/workspace.controller.ts`, `services/api-gateway/test/workspace.e2e-spec.ts`, `packages/contracts/http/gateway/openapi.yaml`, `services/api-gateway/README.md` | Public route allowlist, validation and contract tests |
| Web data | `apps/web/src/api/connection.api.ts`, new `apps/web/src/hooks/useConnections.ts` | Typed Workspace response and authenticated, scoped query/mutation calls |
| Workspace control | `apps/web/src/components/layout/Topbar.tsx`, `apps/web/src/hooks/useWorkspace.ts`, `apps/web/src/pages/WorkspacePage.tsx` | Shared active workspace and useful navigation |
| Connections UI | `apps/web/src/pages/ConnectionsPage.tsx`, `apps/web/src/lib/i18n/translations.ts` | Real list, Google OAuth, permitted actions and errors |
| OAuth config | `.env.example`, `compose.dev.yml`, `services/workspace-service/README.md` | Safe local return URL and setup documentation |
| Browser checks | new `apps/web/e2e/workspace-connections.spec.ts`, existing `apps/web/e2e/localization.spec.ts` | User-visible isolation, lifecycle and translated copy |

Implementation can assign Gateway and web data investigation to separate owners, but no two writers may edit the same file at the same time. Review and merge the Gateway contract before the frontend relies on it.

### Task 1: Expose the Google connection route subset through Gateway

**Files:** Modify `services/api-gateway/src/workspace/workspace.controller.ts`, `packages/contracts/http/gateway/openapi.yaml`, `services/api-gateway/README.md`; test `services/api-gateway/test/workspace.e2e-spec.ts`.

**Interfaces:** `POST|GET /api/v1/workspaces/:workspaceId/connections`; `GET|PATCH|DELETE /api/v1/workspaces/:workspaceId/connections/:connectionId`; `POST` item `/test`, `/disable`, `/oauth/authorize`. Input/output schemas reference `packages/contracts/http/workspace/openapi.yaml` (`CreateConnectionRequest`, `UpdateConnectionRequest`, `ConnectionResponse`, `ConnectionTestResponse`, `OAuthAuthorizationHttpResponse`).

The create body validated at the Gateway has this shape; Workspace Service decides whether a provider/auth combination and config is valid:

```ts
type CreateConnectionBody = {
  name: string; // trimmed, 1–120 characters
  provider: 'TELEGRAM' | 'HTTP' | 'GMAIL' | 'GOOGLE_SHEETS';
  authType: 'NONE' | 'TOKEN' | 'API_KEY' | 'BASIC' | 'OAUTH2';
  config?: Record<string, unknown>;
};
```

- [ ] Add Gateway contract tests for each of the eight method/path pairs using the existing Workspace HTTP fixture. Assert bearer is required, UUID/body failures return 400, the upstream receives exactly `/workspaces/{workspaceId}/connections...`, and `201`, `200`, `204`, `403`, `404`, `409`, `422`, `503` are forwarded as appropriate. Assert no internal, manual credential or arbitrary nested route is exposed. Run the focused suite and confirm these tests fail for the missing routes.
- [ ] Add explicit handlers in the existing controller. Validate both UUID parameters with the existing UUID parser. Validate create and update against the existing Workspace request schema, including the full four-value provider enum and five-value auth type enum; the web UI itself offers only `GMAIL` and `GOOGLE_SHEETS` creation. The Gateway must not silently coerce unknown fields. Keep provider/auth combination and config business validation in Workspace Service.
- [ ] Add the eight operations to Gateway OpenAPI by referencing Workspace schemas and response definitions; update the exact-nine operation assertion and Gateway README route table. Do not add a callback proxy or `PUT` to `WorkspaceProxyService` because Google OAuth does not use those routes.
- [ ] Run `pnpm --dir services/api-gateway test:e2e -- --runInBand workspace.e2e-spec.ts` and `pnpm --dir services/api-gateway build`; inspect response headers and ensure the existing `no-store`, correlation ID and safe error behavior remain intact. Review the diff before starting web work.

### Task 2: Replace the web connection mock adapter with Workspace HTTP semantics

**Files:** Modify `apps/web/src/api/connection.api.ts`; create `apps/web/src/hooks/useConnections.ts` and `apps/web/e2e/workspace-connections.spec.ts`.

**Interfaces:** Define `ConnectionResponse` with exact contract fields (`id`, `workspaceId`, `name`, `provider`, `authType`, `status`, `config`, `hasCredential`, `credentialExpiresAt`, `lastVerifiedAt`, `canManage`, `canAttach`, `createdAt`, `updatedAt`). Export methods `list(workspaceId, signal)`, `create(workspaceId, {name,provider,authType:'OAUTH2'})`, `get`, `rename`, `test`, `disable`, `remove`, `startGoogleOAuth`; every method targets `/api/v1/workspaces/{workspaceId}/connections...` and uses the current bearer token. Query keys include `userId` and `workspaceId`.

```ts
type GoogleProvider = 'GMAIL' | 'GOOGLE_SHEETS';
type ConnectionStatus = 'DISABLED' | 'ACTIVE' | 'INVALID';
type ConnectionTestResponse = { outcome: 'VERIFIED' | 'AUTH_INVALID' };
type OAuthStartResponse = { authorizationUrl: string };
// The public list is ConnectionResponse[], not a paged WorkspacePage.
```

- [ ] Add adapter-level Playwright tests named `adapter: list uses selected workspace` and `adapter: 403 rejects`. Sign in with the existing fixture helper, intercept `/api/v1/workspaces/{workspaceId}/connections`, import the web API module in the Vite page, and invoke `list(workspaceId)`. Assert the selected ID, bearer header and parsed `GMAIL`/`GOOGLE_SHEETS` fields; separately assert a 403 rejects. Confirm both fail while `connection.api.ts` still reads localStorage.
- [ ] Replace localStorage/delay behavior in `connection.api.ts` with an authenticated API client patterned on `workspace.api.ts`. Parse and validate response shape; return a typed error with status/code/request ID. Accept both Workspace's top-level error `{code,message,requestId}` and the Gateway's nested `{error:{code,message},requestId}` envelope. Do not fall back to local data after HTTP errors. The existing `ConnectionItem` demo type in `workflow.types.ts` is not the Workspace contract and must not be reused here.
- [ ] Add TanStack Query keys `['connections', userId, workspaceId, 'list']` and item keys scoped the same way. Disable requests when user or selected workspace is absent; clear user-scoped cache on logout/account change; invalidate/refetch only the affected workspace after mutations. Prevent an in-flight response for workspace A from showing under B.
- [ ] Run `pnpm --dir apps/web test:e2e -- e2e/workspace-connections.spec.ts --project=chromium --workers=1 --grep "adapter:"`, then `pnpm --dir apps/web build` and focused ESLint. Confirm requests carry the selected workspace ID and that HTTP failures remain errors, not an empty-success list.

### Task 3: Make the topbar workspace control real

**Files:** Modify `apps/web/src/components/layout/Topbar.tsx`, `apps/web/src/hooks/useWorkspace.ts`, `apps/web/src/pages/WorkspacePage.tsx`, `apps/web/src/lib/i18n/translations.ts`; test in `apps/web/e2e/workspace-connections.spec.ts`.

**Interfaces:** Reuse `useWorkspaceStore.activeWorkspaceId` and `selectWorkspace(id)`; keep the Workspace page selector synchronized. A list-only workspace hook should load the accessible list without globally fetching members on every page.

```ts
// Proposed list-only selector result; the existing full workspace context keeps members.
type WorkspaceListContext = {
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
  activeWorkspace: WorkspaceSummary | null;
  workspacesQuery: ReturnType<typeof useQuery>;
};
```

- [ ] Add a browser test with two workspaces. Assert the topbar displays the active name, changes the shared ID on selection, and the Workspace page selector agrees. Add a no-workspace case with a link to `/workspace`. Confirm the current fixed label fails these assertions.
- [ ] Replace the fixed “WEAV · Production” decoration with an accessible selector/menu bound to the returned workspace list. Show loading/error states. Do not imply green operational health or a real Production environment unless a backend field exists. Keep keyboard and small-screen access.
- [ ] Add a link from the Workspace overview to `/connections`, with the active workspace name visible on both pages.
- [ ] Separate workspace-list loading from the member query in `useWorkspace.ts` so the global topbar does not fetch member pages everywhere. Preserve current session cleanup and selection validity.
- [ ] Run the focused selector tests, `pnpm --dir apps/web build`, focused ESLint, and the existing workspace switch/OCR Playwright scenarios. Confirm changing workspace does not leave another workspace's member or OCR state visible.

### Task 4: Render the selected workspace's real connections and create Google records

**Files:** Modify `apps/web/src/pages/ConnectionsPage.tsx`, `apps/web/src/lib/i18n/translations.ts`; create/extend `apps/web/e2e/workspace-connections.spec.ts`.

**Interfaces:** Consume Task 2 query/mutations and Task 3 active workspace. Create body is `{ name, provider: 'GMAIL' | 'GOOGLE_SHEETS', authType: 'OAUTH2' }`; initial server status is `DISABLED`.

```ts
await connectionApi.create(activeWorkspaceId, {
  name: trimmedName,
  provider: selectedGoogleProvider,
  authType: 'OAUTH2',
});
// Render the returned server status; do not fabricate ACTIVE or a test result.
```

- [ ] Add browser tests for empty, loading, 401/403/404, 5xx and successful list states; workspace A/B isolation; visible `TELEGRAM`/`HTTP` metadata; and create returning a `DISABLED` Google connection. Confirm no static demo rows appear.
- [ ] Replace the hardcoded eight-row demo, its misleading 18-connection counter and telemetry/table actions with a workspace-scoped list. Display only backend fields. Show `DISABLED`, `ACTIVE`, `INVALID` accurately. Keep a readable empty state and a route to choose/create a workspace when none is active.
- [ ] Add a create form for Gmail and Google Sheets, with name validation and submit pending/error states. On success, render the persisted response after query invalidation. Use `canManage` for each row's action visibility; a member may see safe metadata without config or secrets.
- [ ] Remove timer-based test/sync/export success and local-only delete behavior from the user path. Update localization checks for the new fields and actions. Run focused Playwright, web build and focused ESLint.

### Task 5: Complete OAuth return and management lifecycle

**Files:** Modify `apps/web/src/pages/ConnectionsPage.tsx`, `apps/web/src/api/connection.api.ts`, `apps/web/src/hooks/useConnections.ts`, `apps/web/src/lib/i18n/translations.ts`, `.env.example`, `compose.dev.yml`, `services/workspace-service/README.md`; extend `apps/web/e2e/workspace-connections.spec.ts`.

**Interfaces:** `startGoogleOAuth` returns `{ authorizationUrl }`; Workspace callback returns to `/connections?oauth=success|failed&reason=...&connectionId=...`. The page may store only `{userId, workspaceId, connectionId, createdAt}` temporarily in session storage before navigation; never store URL/state/code/token. Allowed failure reasons come from Workspace OpenAPI.

The current callback failure codes are `state_invalid`, `authorization_denied`, `authorization_changed`, `token_exchange_failed` and `verification_failed`; any unknown code displays a generic failure.

```ts
type OAuthPendingContext = {
  userId: string;
  workspaceId: string;
  connectionId: string;
  createdAt: number;
};
// On return, compare userId and accessible workspaceId before selecting or refetching.
```

- [ ] Add browser tests for OAuth start, success, denial, invalid state and changed authorization. Assert the page refreshes server state after return, does not treat `oauth=success` alone as proof of `ACTIVE`, does not switch workspace from an untrusted query ID, and clears transient return context. Assert the Identity Google login callback is unaffected.
- [ ] Implement Connect Google using the returned URL. Restore pending workspace only when the same signed-in user still has it in the accessible list. Show safe callback messages and refetch the row/list; show generic guidance if pending context is absent. Keep callback query values out of logs and analytics.
- [ ] Set the local example and Compose `GOOGLE_OAUTH_FRONTEND_RETURN_URL` to `http://localhost:5173/connections`, matching the Vite origin. Document that deployed environments must set their own web return URL and register the Workspace callback URI with Google. Preserve the Workspace Service's direct-run default to avoid an unrelated compatibility change. Run `docker compose --env-file .env.example -f compose.yml -f compose.dev.yml --profile app config --quiet` without printing resolved secrets.
- [ ] Add rename, test, disable and confirmed delete with real calls. Respect `canManage` in the UI and server 403. Map `ConnectionTestResponse.outcome` (`VERIFIED`, `AUTH_INVALID`) to accurate feedback. Preserve rows after `409` in-use or `503` dependency failures and show retry guidance; never announce successful deletion before `204`.
- [ ] Run focused Playwright scenarios and existing localization checks, `pnpm --dir apps/web build`, focused ESLint and `git diff --check`.

### Task 6: Verify the real user path and hand off

**Files:** Update `docs/work_logs/2026-09-24-web-workspace-google-connections-plan.md` or the focused work log for the actual implementation date; no new behavior required.

- [ ] With running Identity, Gateway, Workspace, PostgreSQL and Redis/Valkey, sign in through the real web UI and inspect the actual browser requests/console. Verify `GOOGLE_OAUTH_FRONTEND_RETURN_URL` points to the web origin and `GOOGLE_OAUTH_REDIRECT_URI` is the registered Workspace callback, without revealing client secrets. Create test workspaces A and B, create a Google connection in A, switch to B and verify isolation. Test a second member's metadata-only view and owner/creator actions. Do not use production accounts or expose credential values in evidence.
- [ ] If a configured Google OAuth test client/account is available, complete real consent for Gmail and Sheets separately and verify persisted `ACTIVE` plus safe failure behavior. If unavailable, label live consent unverified; fixture tests do not substitute for it.
- [ ] Run the focused Gateway and web suites, package builds, relevant Workspace Service integration test only if its contract or behavior changed, and `git diff --check`. Review all changed files for secrets, stale demo claims and unintended mobile changes. Record exact commands/results and remaining limitations in the work log.
- [ ] Before any commit run `node .gitnexus/run.cjs detect-changes --scope all --repo .`; investigate `partial`, `truncated` or `UNKNOWN` rather than treating zero as clean. Commit only an independently tested logical milestone and never stage unrelated user changes.

## Execution handoff

This document is a plan, not implementation. Start with Task 1, then Task 2; Tasks 3 and 4 can be developed in separate files after the shared client shape is stable, and Task 5 depends on the complete list/create path. Mobile alignment should be planned separately after web acceptance.
