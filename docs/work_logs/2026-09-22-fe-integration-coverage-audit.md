# FE integration coverage audit — 2026-09-22

## Metadata

- Owner: Luna Max (audit worker); Astra điều phối; user review.
- Scope: static audit API-to-FE cho Identity, Workspace, Notification và OCR hiện có trên Web/Mobile.
- Excluded: Workflow, AI, Bot; OCR Mobile mới; runtime mutation; test suite/build; source, test, config, lockfile và log của worker khác.
- Git snapshot: branch `api-gateway`, `HEAD 7e14de0` (`7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`), aligned với `origin/api-gateway`; snapshot `2026-09-22T14:45:05.1907502+07:00`; không có staged change. Worktree có các thay đổi trước đó và write set password recovery của Tesla/Hubble; các file liên quan được coi là **in-progress**, không dùng sự thiếu/tạm thời của chúng làm bug.

## Executive summary

- Các flow đã nối tĩnh: Identity core/profile/session, Workspace CRUD + members, Notification list/unread/read, và Web OCR extraction đều đi qua API Gateway (trừ các nhánh OAuth Web được ghi rõ bên dưới). Fixture/unit/contract logs có bằng chứng PASS; chưa có authenticated live proof.
- P0 gate: tại snapshot không có listener ở các port kiểm tra `3000, 5173, 8081–8085`; chưa có runtime/test account được phê duyệt. Đây là thiếu bằng chứng live, không phải kết luận source hỏng.
- P1 integration gap: Workspace Connections là capability user-facing có backend public contract nhưng chưa có Gateway proxy. Web đang localStorage mock; Mobile HTTP gọi `/api/connections` không khớp backend `/workspaces/{workspaceId}/connections`.
- Conditional P1: Mobile `normalizeApiError` hiện đọc envelope top-level trong khi Gateway trả nested `error`; file đang nằm trong write set/in-progress nên phải recheck sau Hubble, chưa tự sửa.
- Deferred/conditional: Web Google OAuth/browser-cookie và OAuth-account management còn gọi trực tiếp Identity; Gateway README ghi browser OAuth migration deferred. Không coi đây là blocker của email/password core hiện tại.

## Method and evidence boundary

- Đã đọc `AGENTS.md`, `docs/work_logs/log_template.md`, Gateway README/routes, service controllers, Web/Mobile adapters, tests và các work log 2026-09-22.
- GitNexus graph-first đã chạy bằng `pnpm dlx gitnexus@latest` cho các query auth/workspace/notification/OCR và context của `authApi`, `WorkspaceController`, `NotificationProxyController`, `OcrController`, `HttpWorkspaceRepository`, `HttpNotificationRepository`, `useNotifications`. Các kết quả `lower-bound`/empty/UNKNOWN được source-confirm; không coi empty caller set là unused.
- Static evidence = source/fixture/contract/test log đã ghi trước đó. Live evidence = chỉ ghi khi có runtime thật và authenticated flow; không suy ra từ README hoặc “work done”. Audit này không chạy test suite, không build, không start/stop runtime, không gọi mutation.

## Coverage matrix

| Service / public capability | Gateway/backend contract | Web entrypoint → adapter | Mobile entrypoint → adapter | Mode / static coverage / live evidence |
|---|---|---|---|---|
| Identity: login, register, refresh, logout | Gateway `POST /api/auth/login`, `/register`, `/refresh`, `/logout`; source `services/api-gateway/src/identity/identity.module.ts:180-223`; backend `AuthController` | Login/register pages → `apps/web/src/api/auth.api.ts:529-599,603-660` | Auth screens/store → `apps/mobile/src/infrastructure/http/http-auth.repository.ts:198-246` | HTTP qua Gateway ngoài explicit mock mode. Web auth-session log: Playwright 45 + regression 29 PASS, nhưng live chưa chạy. Mobile auth-session log: focused 27/27, tsc/export PASS, native/live chưa có. |
| Identity: current profile, update profile, change password | `GET/PATCH /api/auth/me`; `POST /api/auth/change-password`; `GET/PATCH /api/users/me`; Gateway source `identity.module.ts:225-250,329-349`; backend `UserController`, `PasswordController` | Profile/settings → `authApi.updateProfile`; `changePassword` ở `auth.api.ts:438-456` | Profile/settings → `http-auth.repository.ts:246-271` | Real Gateway path; explicit mock repository only when configured. Web profile log 6 Playwright PASS; Mobile profile contracts/state 42/42; all live evidence absent. |
| Identity: sessions and revocation | `GET/DELETE /api/auth/sessions`, `DELETE /api/auth/sessions/:sessionId`; aliases `/api/users/me/sessions`; Gateway `identity.module.ts:298-373`; backend `SessionController` | Settings/session UI → `authApi.listSessions/revokeSession/revokeAllSessions` | Auth/profile/session hooks → same HTTP repository methods `310-330` | Real HTTP path. Web auth-session 45 + 29 regression PASS; Mobile focused 27/27; no authenticated live proof. |
| Identity: OTP/email verification and password recovery | `POST /api/auth/otp/request`, `/otp/verify`, `/forgot-password`, `/reset-password`; Gateway `identity.module.ts:254-295`; backend `OtpController`, `PasswordController` | Forgot-password route/page and auth API methods around `auth.api.ts:480-507`; **Tesla Web write set in-progress** | Repository methods around `http-auth.repository.ts:275-300`; **Hubble Mobile write set in-progress** | Contract/source present; final UI/transport result intentionally not assessed as complete. No live proof. |
| Identity: Google OAuth/browser cookie + linked OAuth accounts | Backend OAuth routes: `POST /auth/oauth/google/start`, `/exchange`, `GET /auth/web/csrf`, `/callback`, `/refresh`, `/logout`; linked accounts under `/users/me/oauth...`; backend `OAuthController`, `OAuthAccountController` | `auth.api.ts:237,276,328,370,404,515-523,649` uses `VITE_IDENTITY_SERVICE_URL` direct Identity client, not Gateway | No corresponding user-facing Google OAuth flow found; not required for current mobile parity | Mixed/deferred. Gateway has no matching public proxy; Gateway README `services/api-gateway/README.md:171-172` marks browser OAuth migration deferred. No live evidence. |
| Identity: avatar/admin/internal directory | Backend avatar `/users/me/avatar` and admin/internal controllers exist | No verified in-scope FE integration in current slice | No verified in-scope FE integration in current slice | Not a current requested user-facing flow; defer rather than label missing Gateway work. |
| Workspace: list, create, get, rename | Gateway `POST/GET /api/v1/workspaces`, `GET/PATCH /api/v1/workspaces/:id`; `services/api-gateway/src/workspace/workspace.controller.ts:95-139`; backend `WorkspaceController` | Workspace page/store → `apps/web/src/api/workspace.api.ts:301-368`; hook `apps/web/src/hooks/useWorkspace.ts` | Workspace tabs/hooks → `apps/mobile/src/infrastructure/http/http-workspace.repository.ts`; hook `apps/mobile/src/features/workspace/hooks/useWorkspace.ts:147-169` | Real Gateway path; explicit mock branch only in configured mock mode. Web workspace logs fixture 27/27 + member 7/7; Mobile member 13/13, full CJS 35/35, tsc/export PASS. No live/native proof. |
| Workspace: members, permissions, remove, leave | Gateway `GET/POST /api/v1/workspaces/:id/members`, `PATCH /members/:userId/permissions`, `DELETE /members/:userId`, `DELETE /members/me`; Gateway controller `workspace.controller.ts:141-216`; backend `MembershipController` | `workspace.api.ts:395-499` → Gateway; `workspace-members.spec.ts` exists | HTTP repository member methods → Gateway; mutation/query tests and workspace member screen | Static contract/fixture evidence above; no live evidence. User/workspace query keys are scoped in Web/Mobile hooks. |
| Workspace: external connections | Backend `POST/GET/PATCH/DELETE /workspaces/:workspaceId/connections`, credential/test/disable/OAuth endpoints; `services/workspace-service/.../ConnectionController.java:44-165` | `apps/web/src/api/connection.api.ts` is localStorage/delay only; Connections page is not Gateway-backed | `apps/mobile/src/infrastructure/http/http-connection.repository.ts:7-25` calls `/api/connections`, `/api/connections/:id`, `/api/connections/:id/test`; screen/hook exists | **Absent/mismatched real integration.** Gateway has no connection controller/proxy. This is the clearest in-scope P1 gap; no live evidence. |
| Notification: page/list + cursor, unread count | Gateway `GET /api/notifications` (also `/api/v1/notifications`), `GET /api/notifications/unread-count`; `services/api-gateway/src/notifications/notifications.module.ts:29-52`; backend `notification-service/src/presentation/http.ts:96-124` | Notifications page/hook → `apps/web/src/api/notification.api.ts:62-175`; query key includes user in `apps/web/src/hooks/useNotifications.ts:20+` | Notification hook/query → `apps/mobile/src/infrastructure/http/http-notification.repository.ts:44-63`; `notification.query.ts:6-8` | Real Gateway path with explicit mock mode. Web notification fixture 5/5, Gateway 7/7, regression 27/27; Mobile focused 14/14, Gateway 7/7, notification e2e 11/11, tsc/export PASS. Runtime/account live absent. |
| Notification: mark one/all read | Gateway `PATCH /api/notifications/:id/read`, `POST /api/notifications/read-all`; Gateway `notifications.module.ts:54-68`; backend same controller `:126-131` | Notification row/actions → `notification.api.ts:192-221` | Notification repository `:65-89` | Static tests/logs above; no live proof. Push/realtime and internal event consumer are not missing FE HTTP routes in this scope. |
| OCR: workspace extraction upload | Gateway `POST /api/v1/workspaces/:workspaceId/ocr/extractions`; `services/api-gateway/src/ocr/ocr.controller.ts:18-52`; forwards to private OCR `/v1/extractions`; backend `services/ocr-service/src/api/routes.py:60` | Workflow builder → `apps/web/src/api/ocr.api.ts:250-287`, FormData + auth + `X-Request-ID` | No Mobile OCR entrypoint/repository in current scope | Web real Gateway-shaped path, no mock fallback. OCR fixture 13/13, workspace regression 14/14, build/lint logged PASS; ports down and authenticated live proof absent. Mobile OCR explicitly deferred. |

## Findings and remaining work

### P0 — live verification gate for already-wired flows

Static tests do not prove Gateway → Identity/Workspace/Notification/OCR runtime behavior. Current read-only port check at audit time returned `NO_LISTENERS_ON_CHECKED_PORTS` for `3000, 5173, 8081–8085`; no approved authenticated test account/session was available in the logs. The next live packet needs a disposable/approved account, service startup owned by the worker, seeded workspace, and captured browser/Expo network + console evidence. Do not classify this as a source regression until the gate is run.

### P1 — Workspace Connections is not wired through the public ingress

- Backend public contract exists, but API Gateway has no `/api/.../connections` proxy/controller.
- Web screen uses localStorage mock (`apps/web/src/api/connection.api.ts:1-40`); this is not a real HTTP fallback.
- Mobile HTTP repository calls `/api/connections...`, while backend contract is workspace-scoped. This would fail against the current Gateway.
- Needs a bounded contract-first packet; do not mix with Workflow/AI/Bot.

### P1 conditional — Mobile error envelope mapping

`apps/mobile/src/infrastructure/http/http-client.ts:27+` currently normalizes top-level `response.data.code/message`, while Gateway responses are nested under `error` per `services/api-gateway/README.md` and contract types. The file is modified in the current shared/in-progress write set, so re-audit after Hubble’s password-recovery batch before opening a fix.

### Mock, hardcode, ingress and isolation observations

- Web mock mode is explicit (`VITE_API_MODE=mock`) in auth/workspace/notification adapters; HTTP errors do not silently fall back to mock. Mobile repository selection is explicit (`EXPO_PUBLIC_API_MODE=mock`).
- Web mock members/notifications use global localStorage keys (`apps/web/src/api/client.ts:10-16`, `workspace.api.ts:411-499`, `notification.api.ts:146-221`); mock data has fixed user/workspace IDs (`client.ts:20,40,96,143`). Mobile notification/mock workspace stores are module-level. These are test-fixture account-isolation risks, not production HTTP fallback bugs; query keys are user/workspace scoped in the real hooks.
- Web OAuth is the confirmed direct service ingress: `auth.api.ts:237-404,515-523,649` uses `VITE_IDENTITY_SERVICE_URL`. Core Web/Mobile auth, Workspace, Notification and Web OCR use Gateway-shaped routes.

## Deferred / out of scope

- Workflow, AI, Bot repositories/routes and local workflow/connection mocks are deferred per task scope; do not turn their absent Gateway routes into this audit’s blockers.
- OCR Mobile is not a requested/current capability.
- Push/realtime notification transport, event producer internals, avatar/admin expansion, and OAuth browser-cookie migration require separate product/contract decisions; existing Gateway README explicitly records the latter as deferred.

## Proposed bounded work packets after password-recovery batch

1. **Web live gate (Tesla, Web-owned files/log):** authenticated smoke for core Identity/session/profile, Workspace/members, Notifications and OCR through Gateway; capture network/console evidence and fix only Web transport/UI issues. Keep OAuth and Connections separate unless contract owner explicitly extends scope.
2. **Mobile live gate (Hubble, Mobile-owned files/log):** Expo Web/native prerequisite smoke for Identity/session/profile, Workspace/members and Notifications; recheck the error envelope and account-scoped cache after the password-recovery write set. No Gateway/backend edits and no OCR Mobile.
3. **Optional serial Connections packet (contract-first):** Gateway/backend proxy contract owned by one worker, Web adapter and Mobile adapter owned in disjoint files; then run one cross-client live smoke. If ownership cannot be split cleanly, defer this packet rather than parallel-editing shared contracts.

## Checks / handoff

- Read-only Git metadata inspected; no stage, commit, merge, push, stash, restore, delete, or source/test/config edit performed.
- No test suite, build, live mutation, or runtime start/stop performed by this audit.
- Only this audit log is written. `git diff --no-index --check` on this untracked file returned no whitespace diagnostics (exit 1 is the expected no-index difference status).
- Status: audit findings recorded; waiting for user review via Astra. No follow-up packet opened and no agent spawned.

## References

- `AGENTS.md`
- `docs/work_logs/log_template.md`
- `services/api-gateway/README.md`
- `services/api-gateway/src/identity/identity.module.ts`
- `services/api-gateway/src/workspace/workspace.controller.ts`
- `services/api-gateway/src/notifications/notifications.module.ts`
- `services/api-gateway/src/ocr/ocr.controller.ts`
- `apps/web/src/api/auth.api.ts`, `workspace.api.ts`, `notification.api.ts`, `ocr.api.ts`, `connection.api.ts`
- `apps/mobile/src/infrastructure/repository-factory.ts`, `http/http-auth.repository.ts`, `http/http-workspace.repository.ts`, `http/http-notification.repository.ts`, `http/http-connection.repository.ts`, `http/http-client.ts`
- `docs/work_logs/2026-09-22-web-ocr-integration.md`, `web-notification-integration.md`, `web-workspace-members.md`, `web-auth-sessions.md`, `web-profile-integration.md`
- `docs/work_logs/2026-09-22-mobile-notification-integration.md`, `mobile-workspace-members.md`, `mobile-auth-sessions.md`, `mobile-profile-integration.md`
