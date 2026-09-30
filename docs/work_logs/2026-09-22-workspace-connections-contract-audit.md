# Workspace Connections contract audit — 2026-09-22

## Metadata

- Owner: Luna Max; follow-up bounded sau user `work done`.
- Scope: read-only xác minh Workspace Connections backend, contract, Gateway allowlist và FE route/model mapping.
- Excluded: Tesla Web/Hubble Mobile write sets, runtime/tests, source/config changes, stash/commit/stage/push, secret/credential-flow design.
- Snapshot: `2026-09-22T15:16:12.7365891+07:00`, branch `api-gateway`, `HEAD 7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`, `HEAD...upstream 0 0`, `0 staged`, `39 tracked unstaged`, `80 untracked`. Không coi các thay đổi hiện hữu là do audit này.

## Verdict

**Backend: ready-to-wire. End-to-end: not ready-to-wire.**

Workspace Connections không chỉ tồn tại vì FE gọi một route giả: Workspace service có public controller, request/response schema, use cases, JWT actor, membership authorization, JPA persistence, migrations và integration-test source. P1 trước đó vẫn đúng nhưng cần thu hẹp thành:

1. **Gateway contract/allowlist thiếu toàn bộ Connections public surface.** Gateway hiện chỉ expose đúng 9 workspace operation và không có `/connections` route.
2. **Mobile FE gọi sai public shape:** `/api/connections...` thiếu `workspaceId`; repository/hook cũng chưa scope theo workspace/account.
3. **Web Connections page là một UI model khác và đang fake-success/static:** page không dùng `connectionApi`, giữ catalog local với provider/status không khớp Workspace contract. Đây không phải một mapping fix nhỏ.

Không có bằng chứng runtime/live trong audit này; test source chỉ được đọc, không chạy.

## Graph-first evidence

- GitNexus `context ConnectionController` trả `epistemic: exact`, class `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/ConnectionController.java:43-175`, với 10 handler.
- GitNexus `context WorkspaceController` trả `epistemic: exact`, Gateway class `services/api-gateway/src/workspace/workspace.controller.ts:97-216`, chỉ có workspace CRUD/members handlers.
- GitNexus context của Web `connectionApi` là `lower-bound` vì index cũ thiếu Convex metadata; Mobile `HttpConnectionRepository` là `lower-bound` vì interface dispatch. Source đã confirm các reference/route tương ứng bên dưới; không coi empty/lower-bound là unused.
- GitNexus query Connections trả `partial: true` do FTS tables/index lỗi; kết quả đó không được dùng làm verdict độc lập.

## Backend existence, authorization and persistence

| Capability | Exact route/method and source | Request/response evidence |
|---|---|---|
| Create/list | `POST` và `GET /workspaces/{workspaceId}/connections`, `ConnectionController.java:81-100` | `CreateConnectionRequest.java:13-21`; `ConnectionResponse.java:91-126`; OpenAPI `packages/contracts/http/workspace/openapi.yaml:270-320` |
| Get/update/delete | `GET`, `PATCH`, `DELETE /workspaces/{workspaceId}/connections/{connectionId}`, `ConnectionController.java:102-128` | OpenAPI `:322-392`; update requires at least one of `name`/`config` and delete preserves `204` |
| Credential write/remove | `PUT`/`DELETE /workspaces/{workspaceId}/connections/{connectionId}/credential`, `ConnectionController.java:130-147` | `SaveCredentialRequest.java:67-78`; payload is write-only; OpenAPI `:394-451` |
| Provider test/disable | `POST .../{connectionId}/test` and `/disable`, `ConnectionController.java:149-163` | `ConnectionTestResult.java:132-156`; OpenAPI `:453-509` |
| Google OAuth start | `POST .../{connectionId}/oauth/authorize`, `ConnectionController.java:165-174` | Existing `OAuthAuthorizationHttpResponse`; OpenAPI `:511-531`; response is `no-store` |

Authorization is not inferred from controller presence:

- Every public handler extracts actor identity from `JwtActor.userId(jwt)` (`ConnectionController.java:83-99,104-118,123-146,151-173`).
- `ConnectionUsageProtection.java:44-108` loads membership and connection by both workspace/actor, rejects missing resources and `ForbiddenException`, then reauthorizes before mutations. `ConnectionAuthorizationPolicy.java:11-35` limits management/attachment to workspace owner or creator.
- `ConnectionResponse.java:91-126` documents secret-safe output. The Workspace contract README says members can see metadata, `config` becomes `null` when not manageable, and credentials are write-only (`packages/contracts/http/workspace/README.md:44-60`).

Persistence is real:

- `ConnectionJpaEntity.java:24-67` maps table `connections`, workspace/creator UUIDs, normalized name, provider/auth/status, JSONB config and timestamps.
- `ConnectionRepositoryAdapter.java:15-74` is a Spring `@Repository`; `save` uses `saveAndFlush`, queries are workspace-scoped, and delete flushes.
- `SpringDataConnectionRepository.java:12-26` defines workspace-scoped lookup/list and uniqueness query; migrations create `connections` and its workspace/name constraints (`services/workspace-service/src/main/resources/db/migration/V1__create_workspace_entities.sql:27-45`, `V3__connection_constraints.sql:1-27`).
- Persistence/visibility/authorization assertions exist in `ConnectionUseCasesPersistenceIntegrationTest.java:177-281`, including owner/creator config visibility and forbidden member mutation. HTTP/JWT/secret-safe route assertions exist in `WorkspaceConnectionHttpIntegrationTest.java:154-280,474-590`; these are source evidence only, not freshly run by this audit.

The existing provider/schema contract is intentionally narrow: provider enum `[TELEGRAM, HTTP, GMAIL, GOOGLE_SHEETS]`, auth type `[NONE, TOKEN, API_KEY, BASIC, OAUTH2]`, status `[DISABLED, ACTIVE, INVALID]` (`packages/contracts/http/workspace/openapi.yaml:935-1007`; Java enums `ConnectionProvider.java:3-8`, `ConnectionAuthType.java:11-17`, `ConnectionStatus.java:20-24`).

## Gateway allowlist gap

Gateway `WorkspaceController` is registered by `services/api-gateway/src/workspace/workspace.module.ts:1-8`, but its controller only has:

- `POST/GET /api/v1/workspaces`;
- `GET/PATCH /api/v1/workspaces/{workspaceId}`;
- member GET/POST/PATCH/DELETE routes at `workspace.controller.ts:95-216`.

The Gateway README explicitly lists only these nine public workspace operations (`services/api-gateway/README.md:86-97`). The contract test hard-codes the same exact-nine allowlist and rejects internal routes (`services/api-gateway/test/workspace.e2e-spec.ts:827-848`). `rg` found no `connections` route/handler in `services/api-gateway/src` or `services/api-gateway/test`.

The existing proxy already carries required bearer auth, correlation/request IDs, `no-store`, JSON/error forwarding and a 10-second upstream deadline (`services/api-gateway/src/workspace/workspace-proxy.service.ts:72-154,159-228`). It currently builds upstream paths as `/workspaces${path}` (`:133-145`). Its only method limitation is `WorkspaceMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'` (`:15`), so full public parity would require adding `PUT` for credential replacement.

## FE evidence

### Web

- `/connections` is a public page route (`apps/web/src/App.tsx:47`) but `ConnectionsPage.tsx:43-142` owns a hardcoded catalog containing PostgreSQL, Slack, OpenAI, BigQuery, Webhook, GitHub, Redis and S3—providers not in the Workspace contract.
- Its test/sync/create handlers simulate success with timers/toasts (`apps/web/src/pages/ConnectionsPage.tsx:168-216,219-258`), including literal “HTTP 200 OK” and “All 18 service connections verified”. This is UI/demo behavior, not backend evidence.
- `apps/web/src/api/connection.api.ts:1-40` is localStorage + delay and is not imported by `ConnectionsPage.tsx` (source search found only its own definition). It should not be described as a Gateway adapter.
- The shared `ConnectionItem` type (`apps/web/src/types/workflow.types.ts:92-101`) uses lower-case providers and `CONNECTED/DISCONNECTED/ERROR`, while Workspace uses upper-case provider/status enums and secret-safe `ConnectionResponse`; even that adapter is not a direct wire-compatible contract.

### Mobile

- The screen is user-facing (`apps/mobile/src/app/(app)/connections/index.tsx:12-16`) and invokes `useConnections`/`useTestConnection`.
- HTTP mode is selected explicitly by the repository factory (`apps/mobile/src/infrastructure/repository-factory.ts:34-55`), so this is not an HTTP-to-mock fallback.
- `HttpConnectionRepository` calls `GET /api/connections`, `GET /api/connections/{id}`, and `POST /api/connections/{id}/test` (`apps/mobile/src/infrastructure/http/http-connection.repository.ts:4-29`). None matches the existing Gateway prefix or the required workspace-scoped backend path.
- `ConnectionRepository` has no `workspaceId` parameter (`apps/mobile/src/domain/connection/connection.types.ts:14-18`), and `useConnections` uses the unscoped key `['connections']` (`apps/mobile/src/features/connections/hooks/useConnections.ts:4-8`). A real adapter must receive active workspace context and scope cache by user/workspace to avoid cross-workspace/account leakage.
- The screen renders `connections || []` and does not surface list `error` (`connections/index.tsx:15,74-78`); a missing Gateway route can therefore look like a successful empty list.

## Smallest bounded next packet — proposal only

### Packet A: Gateway Connections contract (no implementation in this audit)

Ownership should be separated from the current Tesla/Hubble closure. Exact files:

1. `services/api-gateway/src/workspace/workspace.controller.ts`: register the public `/api/v1/workspaces/:workspaceId/connections...` handlers, validate UUIDs and mirror `packages/contracts/http/workspace/openapi.yaml:270-531` schemas/enums (`:866-1007`). Use the existing `WorkspaceProxyService`; do not create a second connection service.
2. `services/api-gateway/src/workspace/workspace-proxy.service.ts`: extend the method union with `PUT` only if credential replacement is included; preserve bearer forwarding, request IDs, `no-store`, response status and sanitized error behavior. Do not proxy `/internal/...` routes.
3. `packages/contracts/http/gateway/openapi.yaml`: add Gateway paths by referencing the already-existing Workspace schemas/responses; preserve public `/api/v1` prefix and required bearer security.
4. `services/api-gateway/test/workspace.e2e-spec.ts`: replace the exact-nine assertion with the agreed public set, add fixture contract tests for UUID/body validation, bearer requirement, upstream suffix mapping, status passthrough, and `PUT` if included. Update `services/api-gateway/README.md` route matrix in the same packet.

Minimal current-Mobile unblock is `GET list`, `GET detail`, `POST test`; full public Connections readiness additionally includes create/update/delete, credential PUT/DELETE, disable and OAuth-start. The packet must choose one explicitly—do not claim the Web Connections page is integrated with only the three read/test routes.

Compatibility requirements:

- Public path stays `/api/v1/workspaces/{workspaceId}/connections...`; upstream remains `/workspaces/{workspaceId}/connections...`.
- Required bearer and UUID validation remain at Gateway; Workspace remains the authority for membership/creator authorization.
- Preserve backend status/error semantics: `201`, `200`, `204`, and documented `400/401/403/404/409/422/503/500` responses. Do not flatten or invent credential payloads.
- Preserve secret-safe response fields; never expose credential payloads or create a new secret flow. OAuth-start must remain `Cache-Control: no-store`.

### Packet B: FE contract alignment (after Gateway packet and current workers close)

- Mobile ownership: update `apps/mobile/src/domain/connection/connection.types.ts`, `http-connection.repository.ts`, `features/connections/hooks/useConnections.ts`, and screen to pass active `workspaceId`, map backend provider/status/response fields, and scope query/cache. No backend edits.
- Web ownership needs a product decision before coding: either replace the static catalog with the Workspace Connection contract in `apps/web/src/pages/ConnectionsPage.tsx`/`api/connection.api.ts`, or mark this page deferred. Existing provider list and fake health actions cannot be transparently wired to the narrower backend enum.

## Unsupported-state requirement

**Yes, an explicit unsupported/error state is required in HTTP mode until the Gateway packet is live.** Web must not show “HTTP 200 OK”, “verified”, or allow create/delete against the static demo while the real contract is unavailable. Mobile must not turn a 404/unsupported list into an apparently successful empty list; show a retry/unsupported state and disable test actions when the capability is not available. This is a follow-up UI requirement, not implemented here.

## Deferred classification

- Not a backend-missing/deferred service: Workspace Connections backend is implemented and contract-backed.
- Deferred from current closure: Gateway registration and FE alignment, because Tesla/Hubble write sets are active and this audit is read-only.
- Workflow/AI/Bot integration and new credential/provider flows remain out of scope. Internal Workspace connection routes are not public FE routes and must not be added to Gateway.

## Checks / handoff

- Read-only source/Git inspection only. No tests, builds, runtime start/stop, live request, mutation, stage, commit, push, stash, restore or delete.
- Only this focused audit log is written.
- Verdict for Astra/user: **backend ready-to-wire; Gateway missing; Web UI deferred pending model decision; Mobile requires workspace-scoped route/cache mapping.**
- Next bounded packet: Gateway contract registration/validation/proxy tests, then separate FE alignment. Audit stops here for user review; no agent spawned.
