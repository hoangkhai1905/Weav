# Admin web (`apps/admin`): design

Status: draft for review (2026-10-21). Branch: `feature/admin-web` from `dev` 09816f60.

## 1. Goal and decisions

System administrators get their own web app, separate from the user web (`apps/web`), covering the rulebook's System Admin use cases: UC025 list users, UC026 lock/unlock accounts, UC027 list all workspaces, UC028 monitor all executions. It also exposes two admin abilities the backend already has: taking a PUBLIC template down and reading upstream health.

Decided (2026-10-21):

- Separate app `apps/admin` (own build, own dev port `5174`, own login), not an area inside `apps/web`.
- Standalone: no shared UI or auth package. Design tokens are copied from `apps/web/src/index.css`; the admin app has its own small API client and VI/EN dictionary.
- Scope: all four UCs plus the existing admin APIs. UC027 and UC028 need new read-only admin endpoints in workspace-service and workflow-service.
- Once `apps/admin` works, `/admin/users` and its Settings link are removed from `apps/web` (UI only; no API change).

Out of scope: editing or deleting other users' workspaces, re-running or stopping executions, changing USER/ADMIN roles, an admin audit log, charts, health probes for services the Gateway does not probe today (workflow, notification, ai, ocr), a Compose service for the admin app (the user web is not in Compose either).

## 2. App structure and sign-in

- Stack and versions match `apps/web`: Vite, React 19, Tailwind v4, React Query, react-router, lucide-react, axios. Dev server `localhost:5174`.
- `src/styles/tokens.css`: copy of the colour, font and dark-mode tokens from `apps/web/src/index.css`, headed by a comment naming the source file so a web palette change is mirrored here.
- `src/api/`: one axios client for the Gateway (`VITE_API_GATEWAY_URL`) plus modules `users`, `workspaces`, `executions`, `templates`, `health`.
- Shell: sidebar, topbar with breadcrumb, VI/EN switch, light/dark toggle, sign-out. A "Weav Admin" label so it is never mistaken for the user web. Visual language follows the user web's monitoring page: `th`/`td` table classes, `statusBadgeClass`-style pills, error box with Retry, "Page x/y · n items" pagination.

Sign-in:

- `POST /api/auth/login` (same as web). If the returned profile's `systemRole` is not `ADMIN`, call `POST /api/auth/logout` and show "This account has no admin access".
- Access token in `sessionStorage` (gone when the tab closes); refresh token in memory only, as the user web already requires. On a 401 the client refreshes once via `POST /api/auth/refresh`; on failure it returns to `/login`. A reload keeps the session until the access token expires, then the admin signs in again.
- No registration, password recovery or Google sign-in. Admins use the user web for their own account settings.

Authorization stays three-layered: the admin app guards routes; the Gateway rejects a non-`ADMIN` `system_role` with 403 before any upstream call; the target service re-checks (Identity reads the role from its DB; workspace-service and workflow-service read the JWT claim because they own no user table and may not read Identity's). Known limit: a demoted admin's existing access token keeps working until it expires.

## 3. Screens

| Route | Purpose | Data |
| --- | --- | --- |
| `/login` | Email + password, one friendly error for wrong password or disabled account (Identity returns the same 401 for both), a separate one for non-admin | `POST /api/auth/login` |
| `/` Overview | Tiles: users and disabled users, workspaces, executions in the last 24 h by status; 5 latest failed executions; health card | `totalItems` of filtered lists, `GET /api/admin/executions/summary`, health |
| `/users` | Debounced search (300 ms), status filter, disable (with confirmation) / enable; no button for ADMIN rows or self | `GET/PATCH /api/admin/users…` (existing) |
| `/users/:id` | Profile, joined date, email verification, workspaces the user owns | `GET /api/admin/users/{id}` (existing), `GET /api/admin/workspaces?ownerId=` |
| `/workspaces` | Name, owner email, member count, created date; search by name; row opens `/executions?workspaceId=` | `GET /api/admin/workspaces` |
| `/executions` | Status, workflow, workspace, trigger, started, duration, error code; filters status, workspace, date range (≤ 90 days); row opens a read-only side panel with steps and errors | `GET /api/admin/executions`, `GET /api/admin/executions/{id}`, workspace names via one `?ids=` call per page |
| `/templates` | PUBLIC templates: name, author, uses, published date; search; "Take down" (confirm) sets PRIVATE | `GET /api/v1/templates?scope=public`, `PATCH /api/v1/templates/{id}` `{visibility:"PRIVATE"}` (existing admin takedown) |
| `/system` | Identity and Workspace up/down badges, checked-at time, Refresh | Gateway `GET /ready/upstreams` (existing, ADMIN-only) |

The admin app is read-only except for account status and template takedown.

## 4. Backend

### 4.1 workspace-service: `GET /admin/workspaces` (UC027)

- Query: `page` (≥ 0), `size` (1–100, default 20), `q` (name contains, ≤ 100 chars), `ownerId` (UUID), `ids` (≤ 100 UUIDs). Soft-deleted workspaces are excluded.
- Item: `id`, `name`, `ownerId`, `ownerEmail`, `ownerDisplayName`, `memberCount`, `createdAt`. Page envelope matches the existing `PageResult`.
- Owner names come from one batch call per page through the existing `identityDirectory.getUsersByIds`. If Identity fails, the page is still returned with empty owner fields and a WARN log (no personal data in the log).
- Access: JWT `system_role=ADMIN`, else 403. No workspace-membership check applies to this route.
- No "workflow count" column: the count lives in workflow-service and service boundaries forbid cross-service table reads. Add a count endpoint later if needed.

### 4.2 workflow-service: admin executions (UC028)

- `GET /admin/executions`: query `status`, `workspaceId`, `from`/`to` (ISO; range ≤ 90 days, same rule and error as monitoring), `page`, `size` (1–100). `workflow_executions` has no `workspace_id`, so the query joins `workflows` for the workspace filter and column. Item: `executionId`, `workflowId`, `workflowName`, `workspaceId`, `status`, `triggerType`, `startedAt`, `durationMs`, `errorCode`. Sorted by `created_at DESC`.
- `GET /admin/executions/{id}`: the execution plus its node steps (node id/type, status, started/finished, error code and message). Never `input`, `output` or step payloads.
- `GET /admin/executions/summary?hours=24` (1–168): counts by status.
- Access: JWT `system_role=ADMIN`, else 403.
- Flyway `V17`: additive `CREATE INDEX IF NOT EXISTS idx_workflow_executions_created ON workflow_executions (created_at DESC)` for the cross-workspace listing.

### 4.3 API Gateway

- New routes with the existing edge `requireAdmin` check and rate limits: `GET /api/admin/workspaces` → workspace-service `/admin/workspaces`; `GET /api/admin/executions`, `/api/admin/executions/summary`, `/api/admin/executions/{id}` → workflow-service. Query parameters are forwarded as listed above; path ids are UUID-checked.
- `CORS_ALLOWED_ORIGINS` gains `http://localhost:5174` (also in `.env.example`).
- Contracts: add the new routes to the OpenAPI files under `packages/contracts/http/`.

## 5. Testing

- workspace-service and workflow-service (Testcontainers, `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify`): USER gets 403; ADMIN sees rows from several workspaces; filters and paging; `ids` limit; 90-day range rule; no `input`/`output` in responses; Identity failure still returns workspaces.
- API Gateway (`test:e2e`): USER gets 403 with no upstream call; ADMIN requests reach the right upstream path with the right query.
- `apps/admin`: `tsc`, `build`, eslint, Playwright with stubbed backend (non-admin sign-in refused, each screen renders, disable/enable with confirmation, template takedown, filters).
- `apps/web`: after removing the admin page, rerun the affected specs (`account-w5c`, navigation).
- Live check on the Compose stack with the ADMIN test account: every screen, light/dark, desktop and 375 px, console and network clean.

## 6. Delivery order

Each step is a tested commit on `feature/admin-web`:

1. workflow-service and workspace-service admin endpoints, V17 index, tests.
2. Gateway routes, CORS, contracts, e2e tests.
3. `apps/admin` scaffold: tokens, shell, sign-in, Users and user detail.
4. Workspaces, Executions, Templates, System, Overview.
5. Remove `/admin/users` from `apps/web`; update `docs/specs/apps/web.md` and the service specs' UC027/UC028 status.
6. Live check and work log.

## 7. Risks

- JWT-claim authorization in workspace-service and workflow-service trusts the token until expiry (see section 2).
- Cross-workspace execution listing grows with the table; the `created_at` index and the 90-day cap bound it, and `size` is capped at 100.
- Copied design tokens can drift from the user web; move them to a shared package only if that becomes a real problem.
