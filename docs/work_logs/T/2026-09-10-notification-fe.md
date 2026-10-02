# Notification FE — 2026-09-10

## 1. Metadata

- Repository: Weav, current dirty worktree; Asia/Saigon.
- Scope: web/mobile Notification UI and HTTP gateway integration.
- User constraints: direct edits, no plan, delegation, tests, builds or lint.
- Status: Notification FE and core Identity sign-in integration implemented in code; runtime checks deliberately not run.

## 2–4. Outcome and scope

- Both notification clients default to HTTP; explicit `mock` mode preserves their mock inboxes.
- List, unread count, read-one/read-all, loading/empty/error states, retries, refresh and cursor pagination use the existing notification routes.
- Response mapping preserves event/delivery metadata and read timestamps. User-scoped query keys avoid sharing inboxes across accounts; inactive queries are immediately evicted. Requests support cancellation and use the existing token conventions.
- Poll unread counts every 10 seconds and lists every 30 seconds. Update list/count queries after successful mutations. Backend notification contracts/persistence were unchanged.
- Mobile Home and tab badges now use the server count instead of counting the first inbox page. Web topbar uses the same count query as the notification page.

## 5–8. Changes and decisions

- Mobile: notification domain/repositories/mapper/hooks/screen, notification badges in Home/tabs, notification translations. The existing mapper fixture was updated for additive metadata; it was not executed.
- Mobile configuration: `EXPO_PUBLIC_API_MODE=http`, `EXPO_PUBLIC_API_BASE_URL` defaults to the gateway on port 3000. The existing local configuration's two public keys were updated; no credentials changed. Demo auth initialization is limited to explicit mock mode; real auth sessions continue to use `setAuthSession` and the shared HTTP client.
- Web: notification API, new notification query hooks, existing Notification page, topbar badge, additive notification types and VI/EN translations. Other domain mocks are unchanged; auth was connected after the user's Identity branch clarification.
- Web configuration: added `.env.example`; `VITE_API_MODE` defaults to HTTP, `VITE_API_GATEWAY_URL` retains precedence over `VITE_API_BASE_URL`.
- Gateway exception: bootstrap now enables origin-allowlisted CORS because browser Bearer requests and PATCH require preflight support. The already-installed Nest Fastify adapter supplies CORS support. Compose and root environment example expose `CORS_ALLOWED_ORIGINS`; production bootstrap has no implicit allowed origins.
- App READMEs document notification and core Identity integration/configuration.
- The user identified `identity-m3` as the login implementation. Inspected `origin/codex/identity-m3` at `4edade2`: it contains Identity backend and contract changes, not app FE or gateway auth integration. Its core `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`, `/users/me` shapes match the current backend's core routes. No merge/cherry-pick, Identity backend edit, or branch switch was necessary.
- Added a bounded gateway Identity module for the existing `/api/auth/*` client paths. Only `/me` forwards Bearer credentials; request body size, timeout and redirects are bounded, responses are no-store, 204 bodies are preserved and error logging excludes credentials. `IDENTITY_SERVICE_URL` is configurable in Compose.
- Web existing login/register now call Identity, map `displayName` and flat tokens, store the existing access-token key, restore the current user through `/me`, and gate demo access on explicit mock mode. Refresh credentials stay only in memory for logout. Mobile HTTP auth now maps the same contract and supplies refresh/logout JSON bodies; it preserves existing auth-store and form interfaces.
- Registration does not assume an Identity session: it explicitly performs login after successful registration. A login failure after creation asks the user to sign in instead of claiming signup failed.
- No dependency additions, migrations, commits, external writes or container rebuilds in this task.

## 9. Evidence and checks

- Inspected repository status, current clients, auth stores/login flows, backend response shapes, gateway bootstrap/module and relevant docs.
- GitNexus upstream impact completed before edits. Mobile notification hooks: HIGH, affecting HomeScreen/NotificationsScreen/TabsLayout. Mobile auth store: CRITICAL, affecting login/register/Home/profile/settings/layout. Warnings were given; changes preserve auth session action signatures and hook list shape. Web notification API/page/topbar, repository classes, Home/tabs and gateway bootstrap: LOW.
- GitNexus helper file was absent; installed CLI was used. New mapper/helpers/test file: UNKNOWN/not indexed; actual imports/callers were checked manually. No empty graph result was treated as proof of safety.
- Tests, builds, lint, typecheck and browser/runtime checks were deliberately not run at the user's request. Earlier backend test results do not verify these FE edits.
- Additional Identity integration impacts: web auth store MEDIUM (AppLayout/Sidebar/login/register/settings/builder consumers); auth API, mobile HTTP auth repository, login/register pages, gateway AppModule LOW. Existing callers and current/M3 contract shapes were inspected.
- Changed source files were formatted with the existing Prettier dependency. `git diff --check` was clean before the final Identity documentation edits (existing LF/CRLF warnings only).

## 10–11. Blockers and handoff

- The former missing login/gateway source wiring is resolved using the Identity core contract. A running Identity instance and matching backend JWT configuration are still required; no authenticated runtime is claimed.
- Google OAuth and M3 HttpOnly-cookie transport were not added to the apps: this task connects the existing email/password forms. Browser automatic refresh and native secure-session persistence remain outside this change; access expiry returns to existing sign-in handling.
- The running gateway image predates CORS/Identity edits. Apply the updated image/configuration before using these routes. No build/restart was run because the user prohibited builds.
- Physical devices require a reachable gateway LAN URL. LAN browser origins or non-default frontend ports require the corresponding CORS allowlist entry.
- Source changes are ready for review; no claim of tested compilation, real UI operation or live notification delivery.

## 12–13. References and session state

- Existing backend work: `docs/work_logs/2026-09-10-notification-service.md`.
- API source: `services/notification-service/src/application/notifications.ts` and presentation controller.
- Preserve all unrelated pre-existing changes. No commit or PR created.

## 14. Branch/runtime follow-up

- Created `notification-service` and merged `origin/codex/identity-m3` at merge commit `5fa92a7`.
- Restored the pre-existing Notification/FE worktree changes after the merge; unrelated working-tree changes remain preserved.
- Rebuilt and started Identity, API Gateway, Notification Service, and RabbitMQ with the `app` Compose profile. Identity readiness returned 200, Notification health returned 200, RabbitMQ was healthy, and unauthenticated Gateway Notification access returned 401.

## 15. Identity M3 Google OAuth follow-up

- Added web-only PKCE login against Identity M3: start, Google redirect callback, one-time handoff exchange, CSRF/cookie credentials, web refresh and logout.
- Added `/auth/callback`, a Google button on Login, and `VITE_IDENTITY_SERVICE_URL` with the local default `http://localhost:8081`.
- Vite HMR loaded the updated modules without a runtime import error; web, Identity readiness, and `/auth/web/csrf` returned 200.

## 16. Google OAuth callback spinner fix

- Fixed the React StrictMode callback race: the one-time Identity exchange promise is shared across the development effect re-run, so cleanup no longer leaves the callback page permanently stuck on its loading state.
- Vite HMR applied the callback page update; Identity is healthy and `/auth/oauth/google/start` returned 200 after local Valkey networking was corrected.
