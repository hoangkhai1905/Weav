# FE integration final handoff — 2026-09-22

## Metadata and evidence boundary

- Owner: Erdos handoff worker; Astra điều phối; user review.
- Scope: tổng hợp FE integration audit, Workspace Connections contract audit và work logs đã có cho Identity, Workspace, Notification, OCR hiện có.
- Tesla Web và Hubble Mobile đang chạy final regression: **PENDING**. Không chờ/poll, không reread lặp lại, không gọi PASS trước evidence mới.
- Không test/build/runtime trong đợt này; không sửa source, test, config, lockfile hoặc log worker khác. Chỉ ghi file handoff này.
- “Fixture/static PASS” bên dưới là evidence đã được ghi trong work logs trước đó; không phải authenticated live proof.

## Capability matrix

| In-scope capability | Web | Mobile | Fixture/static evidence đã ghi | Live/native status và blocker |
|---|---|---|---|---|
| Identity login/register/refresh/logout, current user, profile | HTTP adapters qua Gateway đã có; profile/session UI đã nối | HTTP repository/store/profile flow đã có; native SecureStore path đã có | Web auth-session Playwright 45 + regression 29; Web profile Playwright 6. Mobile auth-session 27/27; profile contract/state 42/42; tsc/export evidence trong logs | Gateway/Identity authenticated live chưa verified. Mobile native device/runtime chưa verified. |
| Identity sessions/revoke/change password/OTP | API methods + settings/session paths đã có | Repository methods + session/profile state đã có | Web/mobile auth-session logs có focused/static evidence | Final regression Tesla/Hubble **PENDING**; không suy PASS từ các log cũ. |
| Password recovery | Tesla đang closure/final regression | Hubble đang closure/final regression | Contract/source/test artifacts đang nằm trong worker write sets | **PENDING**; không đánh giá thiếu/hỏng tạm thời khi worker còn sửa. |
| Workspace list/detail/create/rename | Gateway-backed adapter/store/hook đã có | Gateway-backed repository/hook/store đã có | Web workspace/OCR regression 27/27; Mobile workspace member/full CJS 13/13 và 35/35, tsc/export evidence | No live Gateway/Identity/Workspace proof; native Mobile blocked by runtime/device prerequisite. |
| Workspace members/permissions/remove/leave | HTTP mapping + member UI/e2e artifact đã có | HTTP mapping + member UI/mutations đã có | Web member fixture 7/7; Mobile member focused 13/13; Gateway workspace contract evidence | Live authenticated member flow chưa verified. |
| Notification list/page, unread, read one/all | Gateway-backed API/hook/page đã có; explicit mock mode riêng | Gateway-backed repository/query/hook đã có; explicit mock mode riêng | Web notification fixture 5/5, Gateway 7/7, regression 27/27; Mobile focused 14/14, Gateway 7/7, notification e2e 11/11, tsc/export | No live Notification account/runtime proof; native Mobile blocked. Push/realtime không nằm trong FE HTTP scope. |
| OCR extraction upload | Web workflow builder gọi workspace-scoped Gateway `POST /api/v1/workspaces/{workspaceId}/ocr/extractions`; không có HTTP→mock fallback | OCR Mobile mới ngoài scope | Web OCR fixture 13/13, workspace regression 14/14, build/lint evidence trong log | Runtime OCR/Gateway authenticated proof chưa verified; OCR Mobile deferred. |
| Workspace Connections | Chưa integrated: `/connections` page là static/demo model; `connectionApi` localStorage adapter không được page dùng | Chưa integrated: HTTP path tồn tại nhưng không khớp public contract | Backend contract/source evidence, không có FE live evidence | Gateway route chưa có; Web model/provider/status mismatch; Mobile thiếu `workspaceId` và cache scope. Deferred until contract packet. |

### Regression status rule

The old work logs establish focused/static evidence only. Tesla Web and Hubble Mobile final regression remain **PENDING** until fresh output is supplied. This handoff intentionally does not call the Web/Mobile workstreams complete, live-verified, or all-green.

## Connections final verdict

**Backend ready-to-wire; end-to-end deferred.** This is not a service that exists only because FE calls a route:

- Public controller has 10 handlers at `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/ConnectionController.java:43-175`:
  `POST/GET /workspaces/{workspaceId}/connections`, `GET/PATCH/DELETE /.../{connectionId}`, credential `PUT/DELETE`, test/disable `POST`, and OAuth authorize `POST`.
- Request/response schemas are implemented in `presentation/http/request/*ConnectionRequest.java`, `application/dto/ConnectionResponse.java:91-126`, and the existing Workspace OpenAPI contract `packages/contracts/http/workspace/openapi.yaml:270-531,866-1007`.
- JWT actor and membership authorization are source-backed by `ConnectionController.java:83-173`, `ConnectionUsageProtection.java:44-108`, and `ConnectionAuthorizationPolicy.java:11-35`.
- Persistence is source-backed by `ConnectionJpaEntity.java:24-67`, `ConnectionRepositoryAdapter.java:15-74`, `SpringDataConnectionRepository.java:12-26`, and migrations `V1__create_workspace_entities.sql:27-45` / `V3__connection_constraints.sql:1-27`.
- Gateway has no Connections handler. Its current Workspace controller/contract/test intentionally expose exactly nine workspace method/path pairs (`services/api-gateway/src/workspace/workspace.controller.ts:95-216`, `services/api-gateway/README.md:86-97`, `services/api-gateway/test/workspace.e2e-spec.ts:827-848`).
- Web `ConnectionsPage.tsx:43-142,168-216` is hardcoded/static and displays providers outside the backend enum; it also emits simulated success messages. Mobile `http-connection.repository.ts:4-29` calls `/api/connections...` without workspace scope, while `useConnections.ts:4-8` uses unscoped `['connections']`.

### Next bounded packet, not opened here

1. Gateway contract packet: add public `/api/v1/workspaces/{workspaceId}/connections...` routes and UUID/body validation in `services/api-gateway/src/workspace/workspace.controller.ts`; update `packages/contracts/http/gateway/openapi.yaml`, `services/api-gateway/test/workspace.e2e-spec.ts`, and route matrix `services/api-gateway/README.md`.
2. Extend `WorkspaceProxyService` (`services/api-gateway/src/workspace/workspace-proxy.service.ts:15,72-145`) with `PUT` only if credential replacement is exposed; preserve bearer auth, workspace upstream prefix, correlation/request IDs, status/error passthrough, `no-store`, and secret-safe responses. Never proxy `/internal` routes.
3. After the Gateway contract is agreed, separate FE alignment: Mobile needs active `workspaceId` in repository/type/query key; Web needs a product decision because its current catalog is not the Workspace Connection model. Until then, HTTP mode needs explicit unsupported/error UI so 404/absent routes cannot look like empty/success state.

No credential flow or new provider was designed. Existing write-only credential contract remains the authority.

## Git snapshot and path classification

Read-only snapshot at `2026-09-22T15:27:35.4865645+07:00`:

- Branch: `api-gateway`.
- HEAD: `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`.
- Local upstream ref: `origin/api-gateway`; `HEAD...origin/api-gateway = 0 0`. No fetch was performed, so this is not a claim about remote freshness.
- Worktree: `0 staged`, `39 tracked unstaged`, `83 untracked` before this handoff file was created. Preserve all existing changes.

Path classification from that snapshot:

- **Web workstream — 26 paths:** `apps/web/**`, including auth, workspace, notification, OCR and password-recovery closure files.
- **Mobile workstream — 63 paths:** `apps/mobile/**`, including auth, workspace, notification, profile and password-recovery closure files.
- **Docs/work logs — 32 paths:** `docs/superpowers/plans/**` and `docs/work_logs/**` already present at snapshot. This handoff is an additional docs path owned only by this worker.
- **Unrelated — 1 path:** `examples/motion-primitives-website/`; keep out of FE integration commits.

Suggested review/commit groups only; no staging or commit performed:

1. Web integration group: Web source/e2e changes after Tesla final regression evidence.
2. Mobile integration group: Mobile source/contract/e2e changes after Hubble final regression evidence.
3. Docs/work-log group: plans and work logs reviewed separately from source.
4. Unrelated examples group: isolate or leave untouched; do not mix with the integration handoff.

### Stash metadata and overlap

Only stash refs and filenames were inspected; no stash content, restore, drop or mutation occurred:

- `stash@{0}` — `On api-gateway: !!GitHub_Desktop`; overlap filename: `apps/web/src/store/useAuthStore.ts`.
- `stash@{1}` — `On notification-service: notification-service pre-identity-m3 merge`; overlap filenames: `apps/mobile/src/app/_layout.tsx`, `apps/web/src/api/auth.api.ts`, `apps/web/src/components/layout/Topbar.tsx`, `apps/web/src/lib/i18n/translations.ts`, `apps/web/src/pages/NotificationsPage.tsx`, `apps/web/src/store/useAuthStore.ts`, `apps/web/src/types/workflow.types.ts`.

## Remaining blockers / action needed

- Tesla Web final regression: **pending evidence**; do not call PASS.
- Hubble Mobile final regression: **pending evidence**; do not call PASS.
- Real-service authenticated Gateway gates remain required for Web/Mobile flows; previous runtime checks had no approved live proof.
- Native Mobile proof requires an available device/emulator/runtime; Expo/static export is not native verification.
- Connections requires the Gateway contract packet and a Web model decision before FE wiring; backend work is not the blocker.

## Handoff checklist

- [x] Matrix of in-scope Web/Mobile capabilities and recorded static evidence.
- [x] Connections source verdict and exact next packet.
- [x] Tesla/Hubble final regression explicitly marked pending.
- [x] Git branch/upstream/staged/unstaged/untracked/stash metadata captured read-only.
- [x] Path classification and review commit grouping documented.
- [ ] Authenticated real-service verification.
- [ ] Native Mobile verification.
- [ ] Fresh final regression evidence from Tesla/Hubble.

No backlog feature was opened. No source was changed. Handoff stops here for user review; Astra should not poll.
