# Workspace Service

Workspace is the Spring Boot service for V1 workspace membership and
authorization. It owns the `workspace` PostgreSQL schema and exposes the
public Workspace HTTP contract in
[`packages/contracts/http/workspace/openapi.yaml`](../../packages/contracts/http/workspace/openapi.yaml).

## Ownership and boundaries

Workspace owns:

- workspace records;
- membership lifecycle and workspace authorization;
- the additive V1 `WorkspaceCapability` snapshot used by downstream services.

Identity owns user identity, profile and account state, and access-token
issuance. Workspace asks Identity for directory data over its internal HTTP
contract and never reads Identity tables directly. Workflow consumes the
internal Workspace authorization snapshot; it must not query the Workspace
database directly. Cross-service foreign keys and cross-service database
queries are prohibited. Use the published HTTP contracts and the internal
service-key boundary instead.

Connection and Credential persistence, lifecycle, and provider verification
are implemented at the application layer. Google OAuth authorization start and
callback use one-time Redis state. Runtime credential resolution, Google token
refresh, attachment authorization, and confirmed auth-failure reporting are
also implemented as application use cases. Public and internal Connection HTTP
routes expose these flows through the Workspace API. The V1 service also does not
implement workspace delete/archive, invitations, ownership transfer, or a
generic RBAC/custom-role system. Those additions must stay behind the existing
domain and HTTP boundaries.

## HTTP surface

Public routes require an Identity-issued access JWT. The authenticated JWT
subject is the only user identity used by the application.

| Method | Route | Success |
| --- | --- | --- |
| `POST` | `/workspaces` | `201` and one OWNER membership |
| `GET` | `/workspaces` | `200` page of the caller's workspaces |
| `GET` | `/workspaces/{workspaceId}` | `200` for a visible workspace |
| `PATCH` | `/workspaces/{workspaceId}` | `200` after an OWNER rename |
| `GET` | `/workspaces/{workspaceId}/members` | `200` enriched member page |
| `POST` | `/workspaces/{workspaceId}/members` | `201` after adding an active Identity user |
| `PATCH` | `/workspaces/{workspaceId}/members/{userId}/permissions` | `200` after updating MEMBER flags |
| `DELETE` | `/workspaces/{workspaceId}/members/{userId}` | `204` after an OWNER removes a MEMBER |
| `DELETE` | `/workspaces/{workspaceId}/members/me` | `204` after a MEMBER leaves |
| `GET` | `/internal/workspaces/{workspaceId}/users/{userId}/access` | `200` capability snapshot for Workflow |
| `POST` | `/workspaces/{workspaceId}/connections` | `201` with a new DISABLED connection |
| `GET` | `/workspaces/{workspaceId}/connections` | `200` metadata for visible connections |
| `GET` | `/workspaces/{workspaceId}/connections/{connectionId}` | `200` secret-safe metadata |
| `PATCH` | `/workspaces/{workspaceId}/connections/{connectionId}` | `200` after an authorized name/config update |
| `DELETE` | `/workspaces/{workspaceId}/connections/{connectionId}` | `204` after Workflow confirms it is unused |
| `PUT` | `/workspaces/{workspaceId}/connections/{connectionId}/credential` | `200` metadata after write-only credential replacement |
| `DELETE` | `/workspaces/{workspaceId}/connections/{connectionId}/credential` | `200` metadata after credential removal |
| `POST` | `/workspaces/{workspaceId}/connections/{connectionId}/test` | `200` provider verification result |
| `POST` | `/workspaces/{workspaceId}/connections/{connectionId}/disable` | `200` after manual disable |
| `POST` | `/workspaces/{workspaceId}/connections/{connectionId}/oauth/authorize` | `200` server-built Google authorization URL |
| `GET` | `/oauth/google/callback` | `302` to the configured frontend return URL |
| `POST` | `/internal/workspaces/{workspaceId}/connections/{connectionId}/authorize-attachment` | `204` when the member may attach the connection |
| `POST` | `/internal/workspaces/{workspaceId}/connections/{connectionId}/resolve` | `200` minimum runtime auth for an ACTIVE connection |
| `POST` | `/internal/workspaces/{workspaceId}/connections/{connectionId}/auth-failure` | `204` after confirmed provider authentication rejection |

The callback is the only unauthenticated application route. It consumes
server-stored OAuth state once and redirects only to the configured frontend
URL with an allow-listed result; invalid state omits `connectionId`. All other
public routes require a user JWT. The internal Connection routes require
`X-Internal-Service-Key`; the resolve response contains runtime secrets, is
marked `Cache-Control: no-store`, and never returns a Google refresh token.
Public Connection responses contain metadata only, with `config: null` when a
member cannot manage the connection. Known credential fields and sensitive
headers are rejected in provider configuration; credential values belong in
the write-only credential route.

All internal routes are authenticated with `X-Internal-Service-Key`. A bearer
token alone cannot authorize them, and the key is never logged or placed in
the contract. Public request and response shapes, limits, enum values, and
status codes are defined by the OpenAPI document.

## Connection and Credential lifecycle

Connections are workspace-owned, and new records start as `DISABLED`. A
successful manual provider test or Google OAuth verification moves the
connection to `ACTIVE`; a confirmed credential rejection moves it to
`INVALID`. Incomplete or unverified connections, manually disabled connections,
and connections whose credential was replaced or removed remain `DISABLED`.
There is no direct status toggle back to `ACTIVE`; test or authorize the
connection again.

| Status | Meaning |
| --- | --- |
| `DISABLED` | Incomplete, unverified, manually disabled, or awaiting verification after a credential change |
| `ACTIVE` | Provider verification succeeded; eligible for internal runtime resolution |
| `INVALID` | The provider confirmed that the credential was rejected |

Transient provider errors such as timeouts, network failures, `429`, or `5xx`
do not mark a connection `INVALID`. MEMBER changes to a referenced connection
are rejected with `409`; an OWNER may rotate credentials while a connection is
in use. Hard deletion checks Workflow usage for every role. If the required
Workflow check says the connection is in use, or Workflow is unavailable, the
service returns `409` or `503` respectively and does not perform the local
mutation.

Manual credential values are write-only in public API responses and are
encrypted with AES-256-GCM in Workspace's PostgreSQL schema. Google OAuth state
is short-lived and one-time in Redis/Valkey and contains only workspace,
connection, user, and provider identifiers. Google access and refresh tokens
are stored in the encrypted credential payload; internal resolution returns
only the access token and uses `Cache-Control: no-store`.

Workspace list queries default to `page=0`, `size=20`, `sort=name`, and
`direction=asc`; member list queries use `sort=displayName` by default. Page
sizes are bounded to 1–100, searches to 120 characters, and sort, direction,
and role values are allow-listed. Member permission query filters accept only
the boolean values `true` and `false`.

Create accepts an optional trimmed name. An omitted or null name generates
`My workspace N`; normalized names are unique per owner. New members start
with both optional workflow flags set to `false`. Only an OWNER can add,
remove, rename, or update a MEMBER. OWNER permissions cannot be changed, an
OWNER cannot be removed or leave, and remove/leave delete only the membership
row.

Member responses are enriched from Identity and do not duplicate profile data
in Workspace persistence. The two public boolean fields are the current
persistence representation in `memberships.can_publish_workflow` and
`memberships.can_manage_workflow_state`; future
`membership_permissions` or custom roles can replace that representation
behind the same authorization boundary.

## Authentication, errors, and correlation

Workspace verifies Identity access JWTs locally with the configured HS256 key,
issuer, audience, access-token use, UUID identity claims, status/role claims,
and time claims. It verifies access tokens only; Workspace does not implement
login, refresh-token issuance, or refresh-token rotation.

Every response carries `X-Correlation-Id`. A bounded incoming value is reused;
an absent or invalid value is replaced with a generated UUID. Error responses
use the exact top-level shape below, and `requestId` matches the response
header and the diagnostic context:

```json
{
  "code": "DEPENDENCY_UNAVAILABLE",
  "message": "A required dependency is temporarily unavailable",
  "requestId": "request-id"
}
```

The service returns sanitized messages and structured diagnostics for Identity
and Redis/Valkey failures. Logs may contain request IDs, operation names,
downstream names, error types, and latency, but never tokens, service keys,
cache payloads, downstream raw bodies, or unnecessary profile data.

## Authorization cache

PostgreSQL is authoritative for membership and capability state. Workspace uses
a cache-aside Redis/Valkey entry with key
`workspace:authz:{workspaceId}:{userId}` and a configurable TTL whose default
is five minutes (`PT5M`). Membership and permission mutations evict the
relevant entry after the database transaction commits; generation fencing
prevents an older read from repopulating a newer authorization state.

Cache reads, writes, and eviction failures are logged with sanitized
diagnostics. A Redis/Valkey outage falls back to PostgreSQL. If an eviction
cannot complete, an already-cached authorization value can remain usable until
the configured TTL expires, so V1 does not claim instant revocation during an
invalidation outage. Workspace has no profile cache.

## Configuration

The service reads the following names. Values belong in a local secret manager
or `.env`; this document intentionally contains names and safe defaults only.
Compose maps the root `WORKSPACE_DB_*` variables to the service's `DB_*`
variables.

| Variable | Purpose / default |
| --- | --- |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USERNAME`, `DB_PASSWORD` | Workspace PostgreSQL datasource; `DB_PORT` defaults to `5432` |
| `DB_SSL_MODE` | PostgreSQL SSL mode; defaults to `require` |
| `DB_SCHEMA` | Service schema; defaults to `workspace` |
| `IDENTITY_SERVICE_URL` | Identity directory base URL; direct-run default is `http://localhost:8081` |
| `IDENTITY_INTERNAL_SERVICE_KEY` | Key Workspace sends to Identity internal directory endpoints; must match Identity's configured internal key |
| `WEAV_INTERNAL_SERVICE_KEY` | Key accepted by Workspace's Workflow-facing internal endpoint |
| `IDENTITY_CONNECT_TIMEOUT`, `IDENTITY_READ_TIMEOUT` | Finite Identity HTTP deadlines; defaults are `3s` and `5s` |
| `JWT_ACCESS_SECRET` | Identity's HS256 access-token verification key; at least 32 UTF-8 bytes |
| `JWT_REFRESH_SECRET` | Required for shared configuration compatibility; Workspace does not issue refresh tokens |
| `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_CLOCK_SKEW` | JWT verification metadata; defaults are `weav-identity`, `weav-api`, and `30s` |
| `REDIS_URL` | Redis/Valkey URI; direct-run default is `redis://localhost:6379` |
| `WORKSPACE_AUTHORIZATION_CACHE_TTL` | Authorization snapshot TTL; defaults to `PT5M` |
| `CREDENTIAL_ENCRYPTION_KEY` | Required Base64 encoding of exactly 32 random bytes for AES-256-GCM; keep in a secret manager |
| `CREDENTIAL_ENCRYPTION_KEY_VERSION` | Identifier stored with encrypted credentials; defaults to `v1` |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth web client credentials; configure only in a local secret manager or deployment secret store |
| `GOOGLE_OAUTH_REDIRECT_URI` | Server-owned Google callback URI; defaults to `http://localhost:8080/oauth/google/callback` |
| `GOOGLE_OAUTH_FRONTEND_RETURN_URL` | Server-configured frontend return URL; defaults to `http://localhost:3000/connections` |
| `GOOGLE_OAUTH_STATE_TTL` | One-time Redis OAuth state lifetime; defaults to `PT10M` |
| `WORKFLOW_SERVICE_URL` | Workflow usage API base URL; direct-run default is `http://localhost:8082`, while Compose uses `http://workflow-service:8080` |
| `WORKFLOW_INTERNAL_SERVICE_KEY` | Key Workspace sends to Workflow's internal usage endpoint; keep it in a secret manager and configure the matching Workflow-side key |
| `WORKFLOW_CONNECT_TIMEOUT`, `WORKFLOW_READ_TIMEOUT` | Finite Workflow HTTP deadlines; defaults are `3s` and `5s` |

The OAuth redirect URI comes from service configuration, never from an API
client. Redis/Valkey is required to store and consume OAuth state; the OAuth
flow fails closed during a Redis outage. OAuth state contains only workspace,
connection, user, and provider identifiers. Google access and refresh tokens
are stored only in the encrypted PostgreSQL credential payload. Gmail requests
`openid`, `email`, and `gmail.metadata`; Sheets requests `openid`, `email`, and
`spreadsheets`. The current scopes do not grant Gmail send or broad Drive access.

`DATABASE_URL` is not read as a single Workspace variable; the Spring
datasource is configured through the `DB_*` names above. The root template also
contains `VALKEY_URL` for services that use that name; Compose uses it as the
fallback source for the Workspace `REDIS_URL` setting.

## Persistence and extensibility

Flyway creates the Workspace-owned tables and constraints. PostgreSQL remains
the final guard for normalized owner workspace names, one owner per workspace,
and one membership per `(workspace_id, user_id)`. The capability list is
additive. Consumers should check capabilities they understand and tolerate
unknown future values rather than hard-code a role-to-permission mapping.

Future workspace archive, soft-delete, and hard-delete flows must be introduced
without changing the current workspace, membership, or Connection contracts.
Invitations, ownership transfer, and generic role management remain separate
future work.

## Verification

Run from this module with the repository's installed Maven (or the checked-in
wrapper) and UTC timezone:

```powershell
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
mvn -B -Dstyle.color=never test
```

The integration suite uses real PostgreSQL and Redis/Valkey Testcontainers and
real local HTTP fixtures for Identity-dependent flows. The focused
`WorkspaceContractValidationTest` parses the Workspace and Identity OpenAPI
documents, checks operation/security/schema references, and verifies local
references. No separate external OpenAPI semantic validator is configured in
the repository. Connection lifecycle and OAuth regression tests use synthetic
local provider and Workflow fixtures with the real Spring HTTP/security chain
and fresh PostgreSQL/Valkey Testcontainers; they do not validate live Google
consent or real provider accounts.
