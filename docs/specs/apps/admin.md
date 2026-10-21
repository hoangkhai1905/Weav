# Admin App (`apps/admin`)

> Status: Implemented (V1). Admin-only web app for system administrators: users, workspaces, executions, public templates, system health. Owner: T for now. Last verified: 2026-10-22 against `feature/admin-web`.

## Purpose and scope

Vite + React + TypeScript single-page app, separate from the user web (`apps/web`). It talks to the API Gateway only and owns no server data. It is read-only except for account status (disable/enable) and template takedown.

- Covers UC025-UC028: users and account status, all workspaces, all executions. Design: [admin web design](../../superpowers/specs/2026-10-21-admin-web-design.md).
- Not responsible for any authorization decision: the Gateway and the target services enforce the ADMIN role.

## Routes

| Route | Purpose | Gateway calls |
| --- | --- | --- |
| `/login` | Email + password; non-admin accounts are signed out again | `POST /api/auth/login`, `/api/auth/logout` |
| `/` | Overview tiles, latest failed executions, health | `/api/admin/*`, `/api/admin/executions/summary`, `/ready/upstreams` |
| `/users`, `/users/:id` | Search, filter, disable/enable; user detail | `/api/admin/users...`, `/api/admin/workspaces?ownerId=` |
| `/workspaces` | All workspaces, owner, member count | `/api/admin/workspaces` |
| `/executions` | All executions with filters and a read-only detail panel | `/api/admin/executions`, `/api/admin/executions/{id}` |
| `/templates` | Public templates, take down | `/api/v1/templates` |
| `/system` | Identity and Workspace up/down | `/ready/upstreams` |

## Security

- Admin-only sign-in: after login the profile must have `systemRole=ADMIN`, otherwise the app logs out and shows "no admin access". No registration, password recovery or Google sign-in.
- Access token in `sessionStorage`; refresh token in memory only. One refresh attempt on 401, then back to `/login`.
- Three layers: route guard in the app, Gateway edge check (403 before any upstream call), service re-check (Identity from its DB; workspace-service and workflow-service from the JWT claim).
- Known limit: a demoted admin's existing access token keeps working until it expires (workspace-service and workflow-service trust the JWT claim).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_GATEWAY_URL` | `http://localhost:3000` | Gateway base URL |

The Gateway `CORS_ALLOWED_ORIGINS` must include `http://localhost:5174` and `http://127.0.0.1:5174` (set in `.env.example`).

## Run and verify

```powershell
pnpm install --frozen-lockfile
pnpm --dir apps/admin dev            # http://localhost:5174
pnpm --dir apps/admin exec tsc --noEmit -p tsconfig.app.json
pnpm --dir apps/admin build
pnpm --dir apps/admin exec eslint .
pnpm --dir apps/admin exec playwright test --project=chromium   # stubbed backend
```

## Status and known gaps

- Design tokens are copied from `apps/web/src/index.css`; they can drift and are not shared through a package.
- No workflow-count column on workspaces (the count lives in workflow-service).

## References

- [App root](../../../apps/admin), [Web app spec](web.md), [Gateway spec](../services/api-gateway.md)
