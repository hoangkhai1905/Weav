# Web Workspace Google Connections Design

## Status and goal

Proposed design for review, 2026-09-24. Deliver real, workspace-scoped Gmail and Google Sheets connection management on web. Mobile follows in a separate phase. Gmail uses the existing `gmail.metadata` scope; this work does not request permission to send mail. Google Sheets keeps the backend's existing `spreadsheets` scope.

## Current state

- `apps/web/src/components/layout/Topbar.tsx` renders a fixed “WEAV · Production” label with no switch behavior. The actual workspace selector and active ID live in `WorkspacePage.tsx` and `useWorkspaceStore.ts`.
- `apps/web/src/pages/ConnectionsPage.tsx` renders hardcoded providers and local timer-driven create, test, sync and delete outcomes. `apps/web/src/api/connection.api.ts` is a separate localStorage mock and is not imported by that page.
- Workspace Service implements workspace-scoped connection persistence, membership checks, `GMAIL` and `GOOGLE_SHEETS` OAuth, status lifecycle and safe metadata responses. The Gateway currently exposes only workspace and member routes, so the web client cannot use those connection operations through its existing public API.
- Workspace's Google callback redirects to the configured `/connections` URL with `oauth=success|failed`, optional `reason`, and optional `connectionId`. This is separate from Identity's Google login callback.
- The local OAuth frontend return URL in `.env.example` and `compose.dev.yml` is `http://localhost:3000/connections`, while Vite's web app uses `http://localhost:5173`; local consent can therefore return to the Gateway instead of the web page. The local development return URL must point to the actual web origin. Keep the Workspace Service's direct-run default unchanged unless a separate compatibility decision is made.

## Chosen approach

Expose only the existing public Workspace Connection routes needed by the Google web flow through the Gateway's explicit route allowlist. Keep those route request schemas compatible with the Workspace contract; the web creation UI offers Google providers only. Use the existing Workspace Service as the authority for connection state, provider verification, authorization and secrets. Bind both the topbar selection and Connections page to the same active workspace store. Replace the demo Connections page with a real list and Google OAuth lifecycle.

Alternatives considered:

1. Keep the demo page and add Gmail/Sheets cards: fast visually but still reports false success and has no persistence.
2. Call Workspace Service directly from web: bypasses the established Gateway boundary and creates another public origin/auth path.
3. Gateway allowlist plus real web adapter: selected because it reuses the implemented service and existing authentication path.

## User flow and behavior

1. The topbar shows the actual selected workspace name. Selecting another accessible workspace changes the shared active ID and the Connections list. An empty workspace list shows a clear route to create one. “Production” is not presented as live environment state.
   The Workspace overview also links to its scoped Connections page.
2. `/connections` shows data only from `GET /api/v1/workspaces/{workspaceId}/connections`. It displays provider, name, `DISABLED|ACTIVE|INVALID`, verification time and allowed actions. It never invents latency, workflow usage, health or other fields absent from the API. Existing `TELEGRAM`/`HTTP` records remain visible as metadata; the creation flow in this phase offers Gmail and Google Sheets only.
3. An authorized user creates a `GMAIL` or `GOOGLE_SHEETS` connection with `authType: OAUTH2` and no provider config. It starts as `DISABLED`. The user then chooses Connect Google. The web client calls `POST .../oauth/authorize` and navigates to the server-built authorization URL. It never builds scopes or callback URLs itself.
4. On return to `/connections`, the page displays the allowlisted OAuth outcome, refreshes the selected workspace's list/detail and shows the persisted status. A short-lived, non-secret pending context in session storage associates the return with the initiating user/workspace/connection. If that context is missing or belongs to another user, do not select a workspace based only on query parameters; show a generic outcome and let the user choose a workspace. Clear pending context and safe query parameters after handling.
5. The UI offers rename, provider test, disable and delete only where `canManage` is true. A member without permission can view allowed metadata but cannot mutate. Deletion requires confirmation; `409` in-use and `503` Workflow-unavailable responses leave the row visible and explain the failure. `AUTH_INVALID` is a failure, not a successful test toast.

## API and boundaries

Gateway adds exactly eight method/path pairs: `POST`/`GET` collection; `GET`/`PATCH`/`DELETE` item; `POST` item `/test`, `/disable` and `/oauth/authorize`. It validates UUIDs and request bodies against the Workspace contract, requires the existing bearer policy, forwards with existing correlation/no-store behavior and retains downstream status/body semantics. It does not expose `/internal/...`, the unauthenticated Workspace callback, or manual credential `PUT`/`DELETE` routes in this Google-only phase. There is no schema or Workspace Service change planned.

Google authorization URLs and credentials are sensitive. Do not log, persist long term, or include them in analytics. The frontend stores only user/workspace/connection IDs as temporary return context. Public responses contain `hasCredential` and safe metadata, never credential values.

## Acceptance criteria

- An authenticated user can switch between two accessible workspaces; Connections shows only the selected workspace's records and does not flash the previous workspace's rows.
- With no selected workspace, Connections sends no connection request and offers a route to create/select one.
- Creating Gmail and Google Sheets connections produces real `DISABLED` records, starts Google OAuth via the backend URL, and displays the persisted `ACTIVE` result only after successful server verification. Denial, invalid state, failed verification and lost access are explicit error states.
- Owner or creator may manage a connection according to `canManage`; other members can view permitted metadata without seeing config/secrets or mutation controls. Server authorization remains authoritative.
- Test, disable, rename and delete reflect server responses; failed requests never report success. In-use delete `409` and dependency `503` preserve the visible record.
- Gateway contract and integration tests cover all eight routes, status forwarding, bearer protection and rejection of unlisted/internal routes. Web browser tests cover workspace isolation, OAuth return and failure paths. A real authenticated browser run with live services is required before claiming end-to-end completion; real Google consent requires configured test credentials and a test account.
- Local dev config returns OAuth to the web origin, and deployment checks the actual registered Google callback URI plus the web return URL before live consent testing.

## Deferred scope

- Mobile connections UI and repository alignment: separate phase after web is stable.
- Manual credential flows for Telegram/HTTP, additional providers, Gmail send permission, new workflow nodes, and a workflow usage-count endpoint.
- Production Google consent verification if the required test account or OAuth configuration is unavailable; report that limitation explicitly.

## Planning risks

The worktree has substantial uncommitted web/mobile changes. Before implementation, review ownership and make an isolated checkout for this cross-service work; do not overwrite existing changes. GitNexus graph impact is LOW for the named `Topbar`, `ConnectionsPage`, `WorkspaceController`, `WorkspaceProxyService` and `useWorkspaceContext` symbols, but the current index is at HEAD while the working tree is dirty. Re-run impact on the exact symbols before edits and confirm unresolved property/dynamic callers by text search. The Connections page must be redesigned around the backend response rather than superficially mapping the old demo fields.
