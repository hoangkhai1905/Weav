# Web App (`apps/web`)

> Status: Partial. Auth, workspaces, members, connections, workflow Builder, executions, OCR node, notifications and AI generate UI run against the Gateway; Telegram screen is mock-only, workflow delete and admin screens do not exist. Owner: T (partner) for now; shared later (includes web admin). Last verified: 2026-09-30 against `dev`.

## Purpose and scope

React 19 + Vite + TypeScript single-page client for Weav (Tailwind 4, shadcn/Radix, `@xyflow/react` canvas, TanStack Query, Zustand, react-hook-form + zod, axios and `fetch`).

- Responsible for: sign-in/registration/recovery UI, workspace and member management UI, connection management UI, the visual workflow Builder, execution monitoring, in-app notification inbox, AI "generate workflow" UI, VI/EN localization, light/dark theme.
- NOT responsible for: any business rule, authorization decision, persistence, or workflow execution. The client only gates UI affordances (for example publish blockers); the services enforce the rules.
- Talks to the API Gateway only, with one exception (Google OAuth, see Open questions).

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC001 | Sign in | Implemented | `pages/LoginPage.tsx`; email/password and Google OAuth (PKCE, `api/auth.api.ts`). |
| UC002 | Forgot password | Implemented | `pages/ForgotPasswordPage.tsx`: OTP request, verify, reset; resend cooldown. |
| UC003 | Register | Implemented | `pages/RegisterPage.tsx`. |
| UC004 | Change password | Implemented | `pages/SettingsPage.tsx` (security tab); also session list/revoke and Google account link. |
| UC005 | Create workspace | Implemented | `pages/WorkspacePage.tsx`, `api/workspace.api.ts`. |
| UC006 | List workspaces | Implemented | Workspace switcher (`store/useWorkspaceStore.ts`, `hooks/useWorkspace.ts`). |
| UC007 | Manage workspace | Partial | Rename and leave present; no delete/transfer UI found. |
| UC008 | Manage members | Implemented | Add by email, remove, leave (`workspace-members.spec.ts`). |
| UC009 | Manage permissions | Implemented | Publish permission per member (`PATCH .../members/:id/permissions`). |
| UC010 | Manage connections/credentials | Implemented | `pages/ConnectionsPage.tsx`, `api/connection.api.ts`: create, test, disable, delete, Google OAuth authorize. |
| UC011 | Create workflow | Implemented | `pages/CreateWorkflowPage.tsx` then `POST .../workflows`. |
| UC012 | Edit workflow | Implemented | `pages/WorkflowBuilderPage.tsx` (nodes, edges, inspector, mappings). |
| UC013 | Save draft | Implemented | `PUT .../workflows/:id/draft`; executable definition sent separately from editor layout. |
| UC014 | Generate workflow from natural language | Partial | UI complete (`AiGeneratorPage.tsx`, `components/builder/GenerateWorkflowPanel.tsx`); backend Gateway route is a pending partner handoff. Mock mode returns `unsupported`. |
| UC015 | Publish workflow | Implemented | Client publish blockers from `lib/nodeReadiness.ts`; webhook key/secret shown once after publish. |
| UC016 | Pause/Resume workflow | Implemented | `WorkflowsPage.tsx` row action. |
| UC017 | Delete workflow | Planned | UI exists but `workflowV1Api.deleteWorkflow()` throws 405 ("V1 does not provide a delete endpoint"). |
| UC018 | Run workflow manually | Implemented | `POST .../workflows/:id/executions` with `{ input }`; Dashboard and executions rerun. |
| UC019 | Monitor executions | Implemented | `LiveWorkflowExecutionsPage.tsx`, `LiveExecutionDetailPage.tsx`; 5 s polling. Per-workflow and workspace-wide list. |
| UC020 | Receive result notifications | Implemented | `pages/NotificationsPage.tsx`, `/api/v2/notifications`; unread count polled every 10 s, list every 30 s. |
| UC021 | Trigger via webhook | Partial | Builder provisions and displays webhook key/secret on publish; the public ingress is not a web concern. |
| UC022 | Trigger via Telegram | Partial | `trigger.telegram` node exists in the catalog; no live Telegram wiring in web. |
| UC023 | Link Telegram account | Planned | `pages/TelegramPage.tsx` uses `api/telegram.api.ts`, which returns hard-coded data with `delay()`; no HTTP. |
| UC024 | Interact via Telegram bot | Not a web use case | Bot-side only. |
| UC025-UC028 | Admin (users, lock, all workspaces, all executions) | Planned | No admin routes or pages. `systemRole` is read only to label the role in Settings. |

## Business rules

| Rule | How the web client reflects it |
| --- | --- |
| BR01 | Protected routes under `AppLayout`; bearer token required by every API adapter (401 raises a session-expired error). Auth store clears caches on logout/account switch. |
| BR02 | Create workspace UI; Owner-only member and permission actions are disabled for non-owners (`workspace-members.spec.ts`). |
| BR03 | Connections are always addressed as `/api/v1/workspaces/{id}/connections`; members see safe metadata but no management actions. |
| BR04 | Builder saves drafts only; drafts never run. Unsupported V1 nodes are preserved in the draft and block publish. |
| BR05 | UI blocks publish while `getPublishBlockers(nodes)` is non-empty (unconfigured integrations, invalid `ai.extract` output schema, unsupported nodes). Real validation and permission are server-side. |
| BR06 | Pause/resume actions apply to PUBLISHED/PAUSED only. |
| BR07 | Execution detail renders per-node results and logs from the service. |
| BR08 | Generation returns a proposal loaded into the Builder for review; the UI never publishes or runs it. |
| BR09 | Not enforced in web (Telegram link is mock). |

## Domain model and data

The web app owns no server data. Client state:

| Store / storage | Content | Notes |
| --- | --- | --- |
| `localStorage.weav_token` | Identity access token | Read by every API adapter (`getStoredAuthToken` in `api/ocr.api.ts`). |
| In-memory `sessionRefreshToken` (`api/auth.api.ts`) | Refresh token for email/password sessions | Deliberately never persisted; a page reload requires sign-in again. |
| `sessionStorage` `weav_google_oauth_*` | PKCE verifier, CSRF, pending transaction | Cleared on completion; Google sessions refresh via cookie (`/auth/web/refresh`). |
| `localStorage` `weav_lang_v1`, `weav_theme_v1` | Locale (VI/EN), theme | `store/useI18nStore.ts`, `store/useUIStore.ts`. |
| Zustand stores | `useAuthStore` (user, isAuthenticated), `useWorkspaceStore` (active workspace), `useUIStore`, `useI18nStore` | Workspace store has a regression test `useWorkspaceStore.regression.test.mjs`. |
| TanStack Query cache | Workspace, connections, notifications | Keyed by user/session to avoid cross-account leaks. |
| `localStorage` `weav_mock_*_v1` | Seeded demo data (mock mode only) | `api/client.ts`. |

Workflow types: `types/workflow.types.ts`; editor-to-definition mapping in `lib/mappers/workflowMapper.ts`; node palette derived from `lib/constants/nodeCatalog.ts` (trigger.manual, trigger.schedule, trigger.webhook, trigger.telegram, http.request, email.send, google.sheets, telegram.send_message, logic.condition, ai.extract, ai.classify, ai.summarize, ocr.extract).

## API

All calls go to the Gateway base URL: `VITE_API_GATEWAY_URL`, else `VITE_API_BASE_URL`, else `http://localhost:3000`. Vite dev server proxies `/api` to the same target (`vite.config.ts`). Auth is `Authorization: Bearer <access token>` unless stated. Errors are mapped to safe messages; raw upstream text and tokens are not shown.

| Adapter | Endpoints consumed | Transport / timeout |
| --- | --- | --- |
| `api/auth.api.ts` | `POST /api/auth/login`, `/register`, `/refresh`, `/logout`; `GET/PATCH /api/auth/me`; `POST /api/auth/change-password`; `GET/DELETE /api/auth/sessions`; `POST /api/auth/otp/request`, `/otp/verify`, `/forgot-password`, `/reset-password` | axios, 10 s |
| `api/auth.api.ts` (Google) | `GET /auth/web/csrf`, `POST /auth/oauth/google/start`, `/auth/oauth/exchange`, `/auth/web/refresh`, `/auth/web/logout`; `/users/me/oauth/google/link`, `/users/me/oauth-accounts` | axios to `VITE_IDENTITY_SERVICE_URL` (default `http://localhost:8081`), cookies |
| `api/workspace.api.ts` | `/api/v1/workspaces` (list/create), `/{id}` (get/rename), `/{id}/members`, `/members/{id}/permissions`, `/members/{id}` (delete), `/members/me` (leave) | axios |
| `api/connection.api.ts` | `/api/v1/workspaces/{id}/connections` (list, create), `/{cid}` (patch, delete), `/{cid}/test`, `/{cid}/disable`, `/{cid}/oauth/authorize` | axios |
| `api/workflow-v1.api.ts` | `/api/v1/workspaces/{id}/workflows` (list, create), `/{wid}` (get), `/{wid}/draft`, `/publish`, `/pause`, `/resume`, `/{wid}/executions` (list, run), `/executions/{eid}`, `/workflows/generate` | `fetch`, 15 s, `redirect: 'error'`, page size 100 |
| `api/ocr.api.ts` | `POST /api/v1/workspaces/{id}/ocr/extractions` (multipart) | client limits: png/jpg/jpeg/webp/pdf, 10 MiB |
| `api/notification.api.ts` | `GET /api/v2/notifications`, `/unread-count`, `POST /{id}/read`, `/read-all` | axios; cursor pagination, locale param |
| `api/telegram.api.ts` | None (hard-coded mock) | - |

Contracts: the web has no generated client; check payloads against `packages/contracts` and the Gateway specs.

## Events and messaging

None. The client polls (executions 5 s, unread count 10 s, notification list 30 s); there is no SSE/WebSocket.

## Dependencies

- Calls: API Gateway (all business traffic); Identity directly for Google OAuth flows.
- Called by: browsers only.
- External: Google OAuth via Identity. No direct calls to AI, OCR, Bot, Notification, Neon, R2 or RabbitMQ.

## Security

- Access token in `localStorage` (XSS-exposed; accepted trade-off, see Open questions). Refresh token is memory-only for password sessions; Google sessions use an HttpOnly cookie plus a CSRF token.
- Google OAuth uses PKCE and a stored CSRF/transaction; callbacks with unknown state do not restore workspace context (`workspace-connections.spec.ts`).
- Stale-response guards: late responses after logout/account switch are ignored (covered by several e2e specs).
- Input limits mirrored client-side (password length/UTF-8 bytes, displayName length, OCR file type/size); the server remains authoritative.
- `fetch` uses `redirect: 'error'` and `cache: 'no-store'`. Axios errors are rewrapped to avoid leaking credentials.
- No secrets in the bundle; only `VITE_*` URLs.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_API_MODE` | unset (live) | `mock` switches auth, workflows, executions, workspace, notifications to seeded `localStorage` data. |
| `VITE_API_GATEWAY_URL` | unset | Gateway base URL, highest precedence. |
| `VITE_API_BASE_URL` | `http://localhost:3000` | Gateway base URL fallback. |
| `VITE_IDENTITY_SERVICE_URL` | `http://localhost:8081` | Identity, Google OAuth only. |
| `WEAV_E2E_PORT` / `WEAV_E2E_ENV_DIR` | 4175 / unset | Playwright web server port; Vite env dir. |
| `AI_E2E` | unset | `1` enables the live AI generation e2e case. |

Mock mode in detail: `isAuthMockMode`, `isWorkflowMockMode`, `isWorkspaceMockMode`, `isNotificationMockMode` are each read from `VITE_API_MODE` (`=== 'mock'`); in mock mode the store starts signed in as `MOCK_USER`. Dashboard/Executions render separate Mock vs Live components. Restart Vite after changing env.

## Non-functional requirements

- Timeouts: 10 s (axios adapters), 15 s (workflow `fetch`). No automatic retries; retry is always user-initiated (OCR, notifications, sessions).
- Duplicate-submit guards on create, permission, password, profile, OCR (one in-flight request).
- Accessibility: react-flow ARIA labels (`lib/i18n/react-flow-aria.ts`), reduced-motion respected in Builder preview.
- Localization: VI/EN with paired-key test (`localization.spec.ts`).
- Observability: none in-app beyond toasts (`sonner`); no client telemetry.

## Status and known gaps

- Telegram page is mock-only (UC023). No Bot API in web.
- Workflow delete is unsupported by Workflow V1 (405 surfaced in UI); list "delete" actions are effectively dead in live mode.
- Gateway generate route pending, so UC014 works only with `compose.ai-local.yml` plus the route.
- No admin surfaces (UC025-UC028).
- Legacy demo screens remain in the tree (`MockExecutionsPage`, `MockExecutionDetailPage`, Dashboard mock branches).
- Notifications: no provider delivery status or retry controls by design.
- `apps/web/debug.log`, `test-results`, `dist` are present in the working tree; ensure they stay untracked.

## Testing

| Check | Command |
| --- | --- |
| Typecheck | `pnpm --dir apps/web exec tsc --noEmit` |
| Build | `pnpm --dir apps/web build` |
| E2E (mocked APIs) | `VITE_API_MODE=mock pnpm --dir apps/web exec playwright test --project=chromium` |
| Lint (read-only) | `pnpm --dir apps/web lint` |

- Specs in `apps/web/e2e/`: `workflow-ui`, `workflow-api-v1`, `workflow-catalog-v1`, `ai-builder`, `ocr-builder`, `workspace-read-switch`, `workspace-members`, `workspace-connections`, `notification-*`, `password-recovery`, `change-password`, `session-management`, `profile-integration`, `dashboard-real-data`, `localization`. Most intercept HTTP routes (contract-style).
- `ai-builder.spec.ts` "generate with AI" is skipped unless `AI_E2E=1`; `notification-live-runtime.spec.ts` is skipped by default (needs disposable stack and `WEAV_TASK8_JWT_SECRET`).
- Last results (2026-09-30): tsc and build OK; Playwright chromium 10 passed, 1 skipped.
- Playwright config declares firefox/webkit projects; CI evidence exists only for chromium.
- No unit-test runner; `useWorkspaceStore.regression.test.mjs` and `e2e/*.test.cjs` run ad hoc with `node --test`.

## Open questions

1. **Acknowledged (2026-09-30), fix pending.** Web calls Identity directly (`:8081`) for Google OAuth, while the architecture says clients use the Gateway only. Suggested: confirm whether the Gateway will proxy `/auth/oauth/*`; until then document as an exception.
2. Access token in `localStorage` vs the refresh token kept memory-only (reload forces sign-in for password sessions). Suggested: accept for V1 and note; or move to cookie-based session later.
3. Telegram page is mock-only while the Bot service has link endpoints. Suggested: mark UC023 Planned and wire it after the Gateway exposes Bot routes.
4. Delete workflow UI exists but the backend has no endpoint. Suggested: hide the action in live mode or add the endpoint (needs decision on soft delete).
5. Firefox/webkit Playwright projects are configured but only chromium is verified. Suggested: restrict the config or add them to the verify command.
6. UC007 scope: no workspace delete/transfer in UI; confirm whether "manage workspace" means rename only.

## References

- [App root](../../../apps/web), [package.json](../../../apps/web/package.json), [vite.config.ts](../../../apps/web/vite.config.ts), [playwright.config.ts](../../../apps/web/playwright.config.ts)
- Router: [App.tsx](../../../apps/web/src/App.tsx); API layer: [api/](../../../apps/web/src/api); mock seed: [api/client.ts](../../../apps/web/src/api/client.ts)
- Builder: [WorkflowBuilderPage.tsx](../../../apps/web/src/pages/WorkflowBuilderPage.tsx), [nodeCatalog.ts](../../../apps/web/src/lib/constants/nodeCatalog.ts), [nodeReadiness.ts](../../../apps/web/src/lib/nodeReadiness.ts)
- E2E: [e2e/](../../../apps/web/e2e)
- Docs: [README](../../../apps/web/README.md), [FRONTEND_GUIDE](../../development/FRONTEND_GUIDE.md), [AI Service V1 design](../../superpowers/specs/2026-09-25-ai-service-v1-design.md), [web Google connections design](../../superpowers/specs/2026-09-24-web-workspace-google-connections-design.md), [rulebook](../../rulebook.md), [specs index](../README.md)
