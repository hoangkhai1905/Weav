# Mobile App (`apps/mobile`)

> Status: Partial. Auth, profile, sessions, workspace/members and notifications use the real Gateway contracts; workflows, executions, connections, Telegram and AI generate call legacy `/api/...` paths that the Gateway does not expose, so they only work in mock mode today. Owner: T (partner) for now; shared later. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

React Native 0.86 + Expo 57 (expo-router, typed routes, React Compiler) companion client for monitoring and light operation of workflows on the go. Also runs on Expo Web (react-native-web) for smoke tests.

- Responsible for: sign-in and recovery, profile/session management, workspace and member management, workflow list/detail with run/pause/resume, execution monitoring, notification inbox, Telegram link screen, AI generate screen, VI/EN copy.
- V1 scope (decided 2026-09-30): everything web does except designing workflows; monitoring is the priority.
- NOT responsible for: the visual workflow Builder (web only), publishing, connection creation/OAuth, any business rule or persistence, admin functions.
- Talks to the API Gateway only (`EXPO_PUBLIC_API_BASE_URL`).

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC001 | Sign in | Implemented | `app/(auth)/login.tsx`, `HttpAuthRepository.login` (`POST /api/auth/login`). No Google sign-in. |
| UC002 | Forgot password | Implemented | `app/(auth)/forgot-password.tsx`; contracts in `infrastructure/http/password-recovery.http.contract.ts`. |
| UC003 | Register | Implemented | `app/(auth)/register.tsx`; after register the user must sign in ("Account created. Please sign in"). |
| UC004 | Change password | Implemented | `app/(app)/settings/index.tsx`, `change-password.utils.ts`. |
| UC005 | Create workspace | Implemented | `app/(app)/workspace/index.tsx`, `HttpWorkspaceRepository.createWorkspace`. |
| UC006 | List workspaces | Implemented | Paginated list (`workspace.pagination.ts`). |
| UC007 | Manage workspace | Partial | Rename and leave; no delete. |
| UC008 | Manage members | Implemented | Add, remove, leave via repository contract. |
| UC009 | Manage permissions | Implemented | `PATCH .../members/{userId}/permissions`. |
| UC010 | Manage connections/credentials | Partial | `connections/index.tsx` is read/test only via legacy `/api/connections`; no create, disable, delete, OAuth. Not working against live Gateway. |
| UC011 | Create workflow | Planned | Web only. |
| UC012 | Edit workflow | Planned | Web only; mobile has no Builder. |
| UC013 | Save draft | Planned | Web only. |
| UC014 | Generate workflow | Partial | `ai/generator.tsx`, `POST /api/ai/generate-workflow` (not a Gateway route; contract differs from the web's `/api/v1/workspaces/:id/workflows/generate`). Works in mock only. |
| UC015 | Publish workflow | Planned | Not offered. |
| UC016 | Pause/Resume workflow | Partial | `workflows/[id].tsx` buttons; calls legacy `POST /api/workflows/:id/pause|resume`, not the workspace-scoped V1 routes. Mock only. |
| UC017 | Delete workflow | Planned | Not offered. |
| UC018 | Run workflow manually | Partial | `useRunWorkflow` + `run-workflow.session.ts`; legacy `POST /api/workflows/:id/run`. Mock only. |
| UC019 | Monitor executions | Partial | `(tabs)/executions.tsx`, `executions/[id].tsx`; legacy `/api/executions`. Mock only. |
| UC020 | Receive result notifications | Implemented | `(tabs)/notifications.tsx`, `/api/v2/notifications`; unread badge on the tab bar. In-app only: `expo-notifications` is a dependency but no push registration code was found. |
| UC021 | Trigger via webhook | Not a mobile use case | Server-side. |
| UC022 | Trigger via Telegram | Not a mobile use case | Bot side. |
| UC023 | Link Telegram account | Partial | `telegram/index.tsx` shows a link code; calls `/api/telegram/status|link-code|unlink`, not exposed by the Gateway. Mock only. |
| UC024 | Interact via Telegram bot | Not a mobile use case | Bot side. |
| UC025-UC028 | Admin | Planned | No admin screens. |

## Business rules

| Rule | Mobile behavior |
| --- | --- |
| BR01 | `(app)` route group requires a session; bearer token set on the shared axios client via `setHttpClientToken`. 401 expires the current session; responses from a superseded session are ignored (`auth-session.scope.ts`). |
| BR02 | Workspace create/rename/member actions issue the Gateway calls; Owner enforcement is server-side. |
| BR03 | Connections are not workspace-scoped in the current mobile repository (legacy path). Gap. |
| BR04/BR05 | Mobile never edits or publishes; it cannot violate them. |
| BR06 | Pause/resume/run buttons exist but are wired to non-V1 routes. |
| BR08 | Generate screen only shows a proposal; no publish or run from AI output. |
| BR09 | Telegram link code UI present; enforcement is server-side. |

## Domain model and data

The app owns no server data. Client state and storage:

| Item | Where | Notes |
| --- | --- | --- |
| Refresh token | `expo-secure-store` key `weav.auth.refresh-token.v1` (native, HTTP mode only) | `infrastructure/auth/auth-session.storage.ts`. On web or in mock mode storage is a no-op (memory only). |
| Access token | In memory (`http-client.ts` `authToken`) | Never persisted; restored via refresh token on app start (`restoreSession`). |
| Stores (Zustand) | `stores/auth.store.ts`, `workspace.store.ts`, `ui.store.ts`, `i18n.store.ts` | Node tests `workspace.store.test.cjs`, `workspace.mutation.store.test.cjs`. |
| Query cache | TanStack Query in `features/*/hooks` | Session-scoped keys. |
| Domain types | `src/domain/{ai,auth,common,connection,execution,notification,telegram,workflow,workspace}` | Repository interfaces implemented twice: `infrastructure/http/*` and `infrastructure/mock/*`. |

Architecture: screens (`src/app`, expo-router) call hooks (`src/features`), which call repositories created in `infrastructure/repository-factory.ts`.

## API

Base URL `EXPO_PUBLIC_API_BASE_URL` (default `http://localhost:3000`), axios, timeout 10 s, `Bearer` token. Errors are normalized (`normalizeApiError`) from Gateway envelopes.

| Area | Endpoints | Matches Gateway? |
| --- | --- | --- |
| Auth | `POST /api/auth/login`, `/register`, `/logout`, `/refresh`; `GET/PATCH /api/auth/me`; `POST /api/auth/change-password`; `GET/DELETE /api/auth/sessions`; `POST /api/auth/forgot-password`, `/otp/verify`, `/reset-password` | Yes (`api/auth` controller) |
| Workspace | `GET/POST /api/v1/workspaces`, `GET/PATCH /{id}`, `/{id}/members` (GET/POST), `/members/{userId}/permissions`, `/members/{userId}` (DELETE), `/members/me` (leave) | Yes |
| Notifications | `GET /api/v2/notifications`, unread count, mark read, read-all | Yes |
| Workflows | `GET /api/workflows`, `/{id}`, `POST /{id}/run`, `/pause`, `/resume` | No: Gateway serves `/api/v1/workspaces/:workspaceId/workflows` |
| Executions | `GET /api/executions`, `/{id}`, `POST /{id}/retry` | No |
| Connections | `GET /api/connections`, `/{id}`, `POST /{id}/test` | No |
| Telegram | `GET /api/telegram/status`, `POST /link-code`, `/unlink` | No |
| AI | `POST /api/ai/generate-workflow` | No |

Gateway route check was made by reading `services/api-gateway/src` controllers (auth, users, notifications, workspaces, workflows, ocr). No OpenAPI client is generated; see `packages/contracts`.

## Events and messaging

None. Polling only: notification unread count every 10 s and list every 30 s (per README). No push (FCM/APNs) integration found.

## Dependencies

- Calls: API Gateway only.
- Called by: end users' devices.
- External: none directly. A physical device needs a reachable LAN Gateway URL.

## Security

- Refresh token in the OS keychain via SecureStore on native; never on web. Access token memory-only.
- HTTP mode starts signed out and never falls back to mock data on errors (`README.md`).
- Session-scoped guards drop late responses after logout or account switch (`auth-session.scope.ts`, notification repository `STALE_SESSION`).
- Password-recovery and change-password contracts validate length before sending.
- Plain `http://localhost` default is dev only; production must use HTTPS (not enforced in code).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `EXPO_PUBLIC_API_MODE` | `http` | `mock` selects `infrastructure/mock/*` repositories and disables token persistence. |
| `EXPO_PUBLIC_API_BASE_URL` | `http://localhost:3000` | Gateway base URL. |
| `EXPO_NO_DOTENV` | unset | Set to `1` for the Expo Web mock smoke test. |

`app.json`: scheme `mobile`, portrait, plugins `expo-router`, `expo-splash-screen`, `expo-secure-store`; experiments `typedRoutes`, `reactCompiler`.

## Non-functional requirements

- HTTP timeout 10 s; no automatic retries.
- Query polling as above; abortable requests for workspace and session lists.
- Light/dark theme via `useThemeColors`; VI/EN via `useTranslation`.
- Observability: toasts only (`features/feedback`); no crash or analytics reporting.
- No performance targets defined.

## Status and known gaps

- Workflows, executions, connections, Telegram and AI HTTP repositories target routes the Gateway does not serve; the tabs render in mock mode only. Needs migration to workspace-scoped V1 routes (as in `apps/web/src/api/workflow-v1.api.ts`).
- Missing vs web: Builder, create/edit/publish/delete workflow, connection create/OAuth/disable, Google sign-in, OCR node, webhook provisioning display, live Telegram, admin.
- Some UI strings are hard-coded English (for example "Pause Workflow", "Linking Code Generated" in Telegram screen) despite the i18n store.
- Register does not sign the user in automatically.
- No push notifications despite `expo-notifications` dependency.
- No app binary/EAS build configuration found.

## Testing

| Check | Command |
| --- | --- |
| Typecheck | `npx tsc --noEmit -p .` (from `apps/mobile`) |
| Focused Node checks | `pnpm --dir apps/mobile exec node --test <file>.test.cjs ...` (list in `README.md`) |
| Expo Web mock smoke | Start Expo with `EXPO_PUBLIC_API_MODE=mock EXPO_NO_DOTENV=1`, then `pnpm --dir apps/web exec playwright test --config ../mobile/e2e/playwright.config.cjs` |

- No unit test script in `package.json` (`lint` is `expo lint`; do not treat as a check without review).
- `.test.cjs` files cover auth session, HTTP contracts, notification mapper/query/target, workspace pagination/mutations, profile and workflow-run session logic.
- Last result (2026-09-30): `tsc` OK. The Node tests and smoke test were not re-run for this spec.

## Open questions

1. Mobile HTTP repositories for workflows/executions/connections/Telegram/AI use `/api/...` paths absent from the Gateway. Suggested: migrate to workspace-scoped V1 routes (web adapters as reference) and mark those UCs Implemented afterwards; the Gateway already serves workflows, but Telegram and AI routes need a partner handoff.
2. **Decided (2026-09-30):** mobile does everything web does except design workflows (no Builder), with monitoring as its focus: executions, run/pause/resume, notifications.
3. Push notifications: `expo-notifications` is installed but unused. Suggested: state in-app polling only for V1, or add a Notification-service push channel to the plan.
4. Google sign-in is absent on mobile. Suggested: password-only for V1.
5. Hard-coded English strings versus the VI/EN store. Suggested: fix before demo, or document English-only screens.
6. **Decided (2026-09-30):** owner is T (partner) for now; K and T share it later.

## References

- [App root](../../../apps/mobile), [package.json](../../../apps/mobile/package.json), [app.json](../../../apps/mobile/app.json), [README](../../../apps/mobile/README.md)
- Routes: [src/app](../../../apps/mobile/src/app); features: [src/features](../../../apps/mobile/src/features)
- Repositories: [repository-factory.ts](../../../apps/mobile/src/infrastructure/repository-factory.ts), [http/](../../../apps/mobile/src/infrastructure/http), [mock/](../../../apps/mobile/src/infrastructure/mock)
- Auth storage: [auth-session.storage.ts](../../../apps/mobile/src/infrastructure/auth/auth-session.storage.ts)
- Web counterpart: [web spec](web.md), [rulebook](../../rulebook.md), [specs index](../README.md)
