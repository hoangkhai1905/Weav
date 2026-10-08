# Workspace Service

> Status: V1 core (workspaces, membership, authorization snapshot, connections/credentials, Google OAuth, notification outbox) is implemented; System Admin listing (UC027) is not. Owner: K. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

Spring Boot service (Java 25, Spring Boot starters: web MVC, JPA, Flyway, security/OAuth2 resource server, AMQP, Redis) that owns:

- Workspace records and the membership lifecycle (OWNER / MEMBER, two optional MEMBER permission flags).
- Workspace authorization: an additive capability snapshot consumed by Workflow (and other services) over an internal HTTP endpoint.
- Connections and Credentials scoped to a workspace: metadata, encrypted credential storage, provider verification (Gmail, Google Sheets, Telegram, HTTP), Google OAuth, runtime credential resolution for Workflow.
- A transactional outbox that publishes workspace/connection notification events (Notification v2 envelope).

Not responsible for: user identity, profiles, account state, login and token issuance (Identity; Workspace only verifies access JWTs and reads Identity's internal directory); workflows, versions, execution (Workflow); notification inbox and consumer queues (Notification); public edge routing/rate limiting (API Gateway, partner-owned). Workspace delete/archive, invitations, ownership transfer and custom roles/RBAC are not implemented ([README](../../../services/workspace-service/README.md)).

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC005 | Create workspace | Implemented | `POST /workspaces`; caller becomes OWNER; name optional, defaults to `My workspace N`. [WorkspaceController](../../../services/workspace-service/src/main/java/com/weav/workspace/presentation/http/WorkspaceController.java), `CreateWorkspaceUseCase` |
| UC006 | List workspaces | Implemented | `GET /workspaces`, caller's workspaces only, paged/sorted/searchable |
| UC007 | Manage workspace | Partial | Rename (OWNER) implemented. Delete/archive not implemented |
| UC008 | Manage members | Implemented | Add by email (must be an active Identity user), remove, leave; list is enriched from Identity |
| UC009 | Manage permissions | Implemented | Per-member `canPublishWorkflow`, `canManageWorkflowState` flags (OWNER only) |
| UC010 | Manage connections/credentials | Implemented | Full CRUD, credential write/remove, test, disable, Google OAuth. Providers: `GMAIL`, `GOOGLE_SHEETS`, `TELEGRAM`, `HTTP` |
| UC015 | Publish workflow (authorization part) | Implemented | Internal access snapshot exposes `WORKFLOW_PUBLISH`; `authorize-attachment` gates connection use. The decision is taken by Workflow |
| UC016 | Pause/Resume (authorization part) | Implemented | Snapshot exposes `WORKFLOW_MANAGE_STATE` |
| UC027 | List all workspaces (System Admin) | Planned | No admin route or ADMIN-based rule; the JWT `ADMIN` role is only validated as an allowed claim value (`JwtAccessTokenValidator`) |

## Business rules

| Rule | How this service enforces it |
| --- | --- |
| BR01 | Every public route except the Google callback and health requires a valid Identity access JWT; the JWT `sub` is the only identity used. Workspace scope is checked per request (`WorkspaceAuthorizationPolicy`, `ResolveWorkspaceAccessUseCase`) |
| BR02 | Creator becomes the single OWNER (unique partial index `uk_memberships_one_owner_per_workspace`). Only OWNER renames, adds/removes members and changes flags. OWNER cannot be removed, cannot leave, and OWNER permissions are immutable (`OwnerCannotBeRemovedException`, `OwnerCannotLeaveException`, `OwnerPermissionsImmutableException`) |
| BR03 | Connections/credentials belong to one workspace (`workspace_id` FK). Internal resolve/authorize routes take `workspaceId` and `connectionId` and are checked against the workspace; credentials are write-only in public responses; `config` is hidden (`null`) from members who cannot manage the connection |
| BR05 (part) | Publish/state permissions modeled as membership flags and returned as capabilities; the publish decision itself lives in Workflow |
| BR07 (part) | `resolve` returns runtime auth only for an ACTIVE connection; a confirmed provider rejection is reported back via `auth-failure` and moves the connection to `INVALID` |

Component-specific rules:

- Workspace names are unique per owner after normalization (`lower(btrim(name))`, index `ux_workspaces_owner_name_normalized`); connection names unique per workspace (`uk_connections_workspace_name_normalized`).
- One membership per `(workspace_id, user_id)`; new members start with both flags `false`.
- Connections start `DISABLED`. `ACTIVE` only after a successful provider test or Google OAuth verification; `INVALID` only after a confirmed credential rejection; transient errors (timeout, network, 429, 5xx) never set `INVALID`. There is no direct toggle back to `ACTIVE`.
- A MEMBER cannot change a connection that Workflow reports as in use (`409`); an OWNER may rotate credentials. Hard delete checks Workflow usage for every role; if Workflow says in use or is unavailable, returns `409` / `503` and does nothing locally.
- Provider config rejects known credential fields and sensitive headers; secrets go only through the credential route.

## Domain model and data

Database: Neon PostgreSQL `workspace_db`, schema `workspace` (`DB_SCHEMA`), Flyway migrations `V1`-`V4` in [db/migration](../../../services/workspace-service/src/main/resources/db/migration). `ddl-auto=validate`.

| Table | Key columns | Notes |
| --- | --- | --- |
| `workspaces` | `id`, `name`, `name_normalized`, `created_by` (Identity user id, external ref), timestamps | Unique `(created_by, name_normalized)` |
| `memberships` | `id`, `workspace_id` FK (cascade), `user_id` (external), `role`, `can_publish_workflow`, `can_manage_workflow_state`, `joined_at` | Unique `(workspace_id, user_id)`; one OWNER per workspace |
| `connections` | `id`, `workspace_id` FK (cascade), `created_by`, `name`, `name_normalized`, `provider`, `auth_type`, `status`, `config` JSONB, `last_verified_at` | Unique `(workspace_id, name_normalized)` |
| `credentials` | `id`, `connection_id` FK (cascade, unique), `encrypted_payload` BYTEA, `encryption_key_version`, `expires_at` | AES-256-GCM ([AesGcmCredentialCrypto](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/credential/AesGcmCredentialCrypto.java)) |
| `notification_outbox` | `event_id` PK, `event_type`, `payload` JSONB, `published_at`, `attempts`, `next_attempt_at`, `last_failure_code` | No retention job; partial index on unpublished rows |

Enums: `MembershipRole` (OWNER, MEMBER), `ConnectionStatus` (DISABLED, ACTIVE, INVALID), `ConnectionAuthType` (OAUTH2, API_KEY, TOKEN, BASIC, NONE). `WorkspaceCapability`: WORKSPACE_VIEW, MEMBER_VIEW, WORKFLOW_CREATE/EDIT/RUN/MONITOR/PUBLISH/MANAGE_STATE, WORKSPACE_RENAME, MEMBER_ADD/REMOVE/MANAGE_PERMISSIONS. User ids are external references; profile data comes from Identity and is never stored here.

## API

Contract: [packages/contracts/http/workspace/openapi.yaml](../../../packages/contracts/http/workspace/openapi.yaml) and [README](../../../packages/contracts/http/workspace/README.md). Public API is reached through the Gateway (paths there are prefixed `/api/v1`); the service itself serves un-prefixed paths. Errors use `{code, message, requestId}`; `X-Correlation-Id` is on every response.

Public (user JWT):

| Method | Path | Purpose | Main errors |
| --- | --- | --- | --- |
| POST / GET | `/workspaces` | Create / list own workspaces (`page=0,size=20` max 100, `sort=name`, `direction`, `search` <=120) | 400, 401, 409 (name) |
| GET / PATCH | `/workspaces/{id}` | Get / rename (OWNER) | 403, 404, 409 |
| GET / POST | `/workspaces/{id}/members` | List (enriched) / add by email | 404 (user), 409 (already member), 503 (Identity) |
| PATCH | `/workspaces/{id}/members/{userId}/permissions` | Update MEMBER flags | 403, 409 (owner) |
| DELETE | `/workspaces/{id}/members/{userId}` / `/members/me` | Remove member / leave | 403, 409 |
| POST / GET | `/workspaces/{id}/connections` | Create (starts DISABLED) / list metadata | 409 (name) |
| GET / PATCH / DELETE | `/workspaces/{id}/connections/{connId}` | Read / update name+config / delete | 409 (in use), 503 (Workflow) |
| PUT / DELETE | `.../connections/{connId}/credential` | Replace / remove credential (write-only) | 400, 403 |
| POST | `.../connections/{connId}/test` | Provider verification | 502/503 on provider failure |
| POST | `.../connections/{connId}/disable` | Manual disable | 403 |
| POST | `.../connections/{connId}/oauth/authorize` | Server-built Google authorization URL | 400, 503 (Redis) |
| POST | `.../connections/{connId}/oauth/complete` | Bearer; body `{completion}`. Atomically consumes the single-use completion id, requires jwt `sub`, workspace and connection to match the user who started the flow, then exchanges the code (PKCE verifier), verifies Google and stores the encrypted credential | 400, 409 (unknown/expired/replayed/mismatched: one uniform response), 403/404 (access lost), 503 |
| GET | `/oauth/google/callback` | Unauthenticated; consumes one-time state, parks the code under a random 256-bit completion id (`GOOGLE_OAUTH_COMPLETION_TTL`), stores no credential, `302` to `GOOGLE_OAUTH_FRONTEND_RETURN_URL` with `oauth=pending&completion=<id>&connectionId=<id>` or `oauth=failed&reason=` | invalid state omits `connectionId` |
| GET | `/actuator/health`, `/actuator/health/**` | Unauthenticated health/liveness/readiness | - |

Internal (header `X-Internal-Service-Key`; caller is Workflow):

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/internal/workspaces/{ws}/users/{user}/access` | Role + capability snapshot |
| POST | `/internal/workspaces/{ws}/connections/{conn}/authorize-attachment` | `204` if the member may attach the connection |
| POST | `/internal/workspaces/{ws}/connections/{conn}/resolve` | Minimum runtime auth for an ACTIVE connection; `Cache-Control: no-store`; never returns a Google refresh token |
| POST | `/internal/workspaces/{ws}/connections/{conn}/auth-failure` | `204`; confirmed provider authentication rejection -> `INVALID`; optional `credentialId`/`credentialVersion` (from `resolve`, epoch-millis `updatedAt`) that no longer match the current credential make the report a no-op |

Gateway exposure: [gateway openapi](../../../packages/contracts/http/gateway/openapi.yaml) lists workspace, member and connection routes (get/patch/delete, test, disable, credential PUT/DELETE, oauth/authorize, oauth/complete); 20 operations in total.

Google connect (authenticated completion, WS-6): `authorize` stores the PKCE `code_verifier` only in the Redis pending state (`workspace:oauth-state:*`) and sends the S256 challenge to Google. The public callback never touches the database: it consumes the state and saves `{state, code}` in Redis (`workspace:oauth-completion:*`, GETDEL-equivalent Lua on consume) under a SecureRandom 256-bit base64url id. The web app, signed in, posts the id to `oauth/complete`; the code exchange, Google verification and credential write happen only there, with the provider calls outside the final DB transaction. A browser that follows an attacker's Google URL therefore cannot attach a victim's tokens to the attacker's connection.

## Events and messaging

Published only (transactional outbox -> RabbitMQ topic exchange `NOTIFICATION_EXCHANGE`, default `weav.events`; routing key = `eventType`, message id = `eventId`, persistent JSON, publisher confirms + mandatory return). Schema: [event-v2.schema.json](../../../packages/contracts/events/notification/event-v2.schema.json), example `workspace-created.json`. Consumer: Notification Service.

| Event type | Recipients (summary) |
| --- | --- |
| `workspace.created`, `workspace.renamed`, `workspace.member_added`, `workspace.member_removed`, `workspace.member_permissions_updated`, `workspace.member_left`, `workspace.deleted` | Creator / affected members / owner (see `WorkspaceNotificationRecorder`) |
| `connection.connected` | Acting user only, on a real non-ACTIVE -> ACTIVE transition |
| `connection.disabled` | Current owner + connection creator, actor removed, empty set suppressed |
| `connection.invalid` | Same recipients, actor kept; system actor is `null` for internal/refresh invalidations |

Delivery is at-least-once (consumers dedupe by `eventId`). Drain: one row at a time, `FOR UPDATE SKIP LOCKED`, exponential backoff capped at 60 s, no attempt limit. Consumed messages: None.

## Dependencies

| Direction | Component | Use |
| --- | --- | --- |
| Calls | Identity Service (`IDENTITY_SERVICE_URL`, internal key) | User directory for member add/list ([IdentityDirectoryHttpClient](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryHttpClient.java)) |
| Calls | Workflow Service (`WORKFLOW_SERVICE_URL`, internal key) | Connection usage check before update/delete ([WorkflowConnectionUsageClient](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/workflow/WorkflowConnectionUsageClient.java)) |
| Called by | Workflow Service | Internal access / authorize-attachment / resolve / auth-failure |
| Called by | API Gateway | Public routes (Gateway proxies user requests) |
| External | Google OAuth / Gmail / Sheets, Telegram API, arbitrary HTTP targets (HTTP provider, SSRF-guarded via `HttpTargetValidator` and `PinnedHttpTransport`) | Provider verification and OAuth |
| Infra | Neon PostgreSQL, Valkey (Redis client; auth cache + OAuth state), RabbitMQ | See Configuration |

## Security

- User routes: HS256 Identity access JWT verified locally (issuer, audience, access-token use, UUID subject, status/role/time claims, clock skew) by [JwtAccessTokenValidator](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/JwtAccessTokenValidator.java). Stateless, CSRF off.
- Internal routes: `/internal/workspaces/**` is `permitAll` at the chain level but [InternalServiceKeyFilter](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/InternalServiceKeyFilter.java) requires `X-Internal-Service-Key` (constant-time compare; rejected if the key is unconfigured). A bearer token never authorizes them. This is a static shared key, not a Service JWT.
- Authorization: OWNER vs MEMBER role plus flags via `WorkspaceAuthorizationPolicy`, `ConnectionAuthorizationPolicy`; PostgreSQL constraints are the final guard.
- Secrets: credentials AES-256-GCM encrypted at rest (`CREDENTIAL_ENCRYPTION_KEY` Base64 32 bytes, version stored per row). Google tokens live only in the encrypted payload. OAuth state is one-time, TTL-bound, holds only ids; redirect URI and return URL come from server config, never the client. Logs never contain tokens, keys or raw provider bodies.
- Google scopes: Gmail `openid`, `email`, `gmail.readonly`, `gmail.send`; Sheets `openid`, `email`, `spreadsheets` (no broad Drive).
- Input: Jackson `fail-on-unknown-properties=true`; workspace name <=255, connection name <=120, email <=320, search <=120, page size 1-100, enum allow-lists.

## Configuration

Names and defaults only; see the [README table](../../../services/workspace-service/README.md) and [.env.example](../../../.env.example). Compose maps `WORKSPACE_DB_*` to `DB_*`; host port `8082` -> container `8080`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | port `5432` | Neon datasource (no default for the rest) |
| `DB_SSL_MODE`, `DB_SCHEMA` | `require`, `workspace` | SSL mode; service schema |
| `JWT_ACCESS_SECRET` | none (required) | Access verification key (>=32 bytes). Tokens must carry `user_status=ACTIVE`; DISABLED or missing -> 401. The refresh secret is not used here |
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_CLOCK_SKEW` | `weav-identity`, `weav-api`, `30s` | JWT verification |
| `WEAV_INTERNAL_SERVICE_KEY` | empty | Key accepted on Workspace internal routes |
| `IDENTITY_SERVICE_URL`, `IDENTITY_INTERNAL_SERVICE_KEY` | `http://localhost:8081`, empty | Identity directory client |
| `WORKFLOW_SERVICE_URL`, `WORKFLOW_INTERNAL_SERVICE_KEY` | `http://localhost:8082` (Compose: `http://workflow-service:8080`), empty | Workflow usage client |
| `*_CONNECT_TIMEOUT`, `*_READ_TIMEOUT` (`IDENTITY_`, `WORKFLOW_`) | `3s`, `5s` | HTTP deadlines |
| `REDIS_URL` (Compose falls back to `VALKEY_URL`) | `redis://localhost:6379` | Valkey |
| `WORKSPACE_AUTHORIZATION_CACHE_TTL` | `PT5M` | Authorization snapshot TTL |
| `RABBITMQ_HOST/PORT/USERNAME/PASSWORD/VHOST/TLS_ENABLED` | `rabbitmq`, `5672`, `guest`, `guest`, `/`, `false` | Broker |
| `NOTIFICATION_EXCHANGE` | `weav.events` | Topic exchange |
| `WORKSPACE_NOTIFICATION_PUBLISHER_ENABLED`, `..._OUTBOX_BATCH_SIZE`, `..._POLL_INTERVAL`, `..._INITIAL_DELAY`, `..._CONFIRM_TIMEOUT`, `..._MAX_RETRY_DELAY` | `true`, `25`, `1000`, `1000`, `PT5S`, `PT60S` | Outbox drain (batch 1-250, confirm <=30 s, retry cap <=60 s) |
| `CREDENTIAL_ENCRYPTION_KEY`, `CREDENTIAL_ENCRYPTION_KEY_VERSION` | required, `v1` | AES-256-GCM key and label |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | empty | Google web client |
| `GOOGLE_OAUTH_REDIRECT_URI` | service `http://localhost:8080/oauth/google/callback`; Compose/.env.example `http://localhost:8082/oauth/google/callback` | Callback registered with Google |
| `GOOGLE_OAUTH_FRONTEND_RETURN_URL` | service `http://localhost:3000/connections`; Compose/.env.example `http://localhost:5173/connections` | Post-consent redirect |
| `GOOGLE_OAUTH_STATE_TTL` | `PT10M` | One-time state lifetime |
| `GOOGLE_OAUTH_COMPLETION_TTL` | `PT5M` (1 s - 10 min) | Lifetime of the parked callback code before authenticated completion |

## Non-functional requirements

- Timeouts: Identity and Workflow HTTP connect 3 s / read 5 s; RabbitMQ connect 3 s; publisher confirm 5 s; Hikari pool max 3, connection timeout 10 s, max lifetime 5 min (Neon limits).
- Caching: cache-aside authorization snapshot `workspace:authz:{ws}:{user}` (TTL 5 min), evicted after commit with generation fencing; Valkey outage falls back to PostgreSQL. If eviction fails, stale value may live until TTL (no instant revocation claim). OAuth flow fails closed without Valkey.
- Consistency: workspace/connection mutations take a workspace mutation lock; outbox row is written in the same transaction as the mutation; provider calls and Workflow checks stay outside the final transaction.
- Transaction boundaries (no remote I/O under a DB transaction or the workspace lock): `TestConnection` = short read tx (authorize, validate, decrypt, snapshot auth type/config/credential id+updatedAt) -> provider call with no tx -> short write tx under the lock that re-checks the snapshot (changed => 409 `Connection changed while it was being tested`, nothing written). `AddMember` = owner pre-check tx -> Identity lookup with no tx -> lock + owner re-check + membership insert tx (unique constraint remains the backstop). `ListMembers` = short read tx (authorize + candidates) -> Identity calls with no tx -> short tx for the workspace-owned-sort page.
- Idempotency/retries: outbox at-least-once with backoff; transient provider errors do not change connection status.
- Observability: `/actuator/health` (liveness `livenessState`, readiness `readinessState`+`db`, details shown), `/actuator/info`; `X-Correlation-Id` echoed as `requestId`; sanitized structured error diagnostics. No metrics endpoint exposed.
- Rate limiting: none in-service (Gateway concern). No paging limit beyond 100.

## Status and known gaps

- UC027 (admin lists all workspaces): Planned; no admin authorization path.
- UC007: workspace delete/archive, invitations, ownership transfer, custom roles: not implemented by design in V1.
- Gateway lacks the credential PUT/DELETE routes (public credential entry from web blocked) and the generic Connection routes need handoff confirmation.
- Notification outbox has no retention/cleanup job; can grow if publisher disabled.
- Internal auth is a single static shared key (no per-caller identity, no rotation mechanism).
- Membership flags are the current permission representation; a `membership_permissions` table/custom roles are future work.
- Live Google consent and real provider accounts are not covered by automated tests.

## Testing

From `services/workspace-service`:

```powershell
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
./mvnw verify
```

Suites include domain tests, architecture tests (ArchUnit clean-architecture rules), `WorkspaceContractValidationTest` / `WorkflowContractValidationTest` (OpenAPI checks), HTTP/security integration tests, persistence and Testcontainers-based (PostgreSQL, Valkey, RabbitMQ) integration tests, provider/OAuth fixtures. Last result (2026-09-30, `dev`): verify OK. Known environment-only errors for this service: none listed in `CLAUDE.md`.

## Open questions

1. Google redirect defaults differ: service `application.properties` uses `localhost:8080`/`3000`, Compose and `.env.example` use `8082`/`5173`. Suggested: keep as is (direct-run vs Compose) and document per environment.
2. UC027 (admin lists all workspaces) has no owner: neither Workspace nor Identity implements it. Suggested: add an admin-only `GET /admin/workspaces` in Workspace, gated by the JWT `ADMIN` role, plus a Gateway route (handoff).
3. Internal auth: brief baseline mentions Service JWT; code uses a static `X-Internal-Service-Key`. Suggested: accept static key for V1, list Service JWT as a hardening item.
4. Gateway credential routes: `PUT/DELETE .../credential` are absent in the Gateway contract. Suggested: request a documented Gateway handoff, or decide web uses Google OAuth only in V1 (matches the 2026-09-24 web design, which offers Google providers only).
5. Notion says Redis and one physical DB with `*_schema`; code uses Valkey (Redis client, `spring.data.redis`) and Neon `workspace_db` with schema `workspace`. Suggested: follow code.
6. Provider set (`GMAIL`, `GOOGLE_SHEETS`, `TELEGRAM`, `HTTP`) is broader than the web design's Google-only creation UI. Suggested: confirm the V1 provider list for Builder.
7. **Decided (2026-09-30):** owner is K.

## References

- Service: [README](../../../services/workspace-service/README.md), [pom.xml](../../../services/workspace-service/pom.xml), [application.properties](../../../services/workspace-service/src/main/resources/application.properties)
- Contracts: [workspace openapi](../../../packages/contracts/http/workspace/openapi.yaml), [gateway openapi](../../../packages/contracts/http/gateway/openapi.yaml), [notification event v2](../../../packages/contracts/events/notification/event-v2.schema.json)
- Design: [web workspace Google connections](../../superpowers/specs/2026-09-24-web-workspace-google-connections-design.md)
- Work logs: [workspace-core-v1](../../work_logs/K/workspace-core-v1.md), [connection domain lifecycle](../../work_logs/K/workspace-connection-credential-domain-lifecycle.md), [provider runtime](../../work_logs/K/workspace-connection-credential-provider-runtime.md), [workspace-google-connect](../../work_logs/K/2026-09-29-workspace-google-connect.md)
- Index: [../README.md](../README.md), [../../rulebook.md](../../rulebook.md)
