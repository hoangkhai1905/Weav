# Workspace HTTP contract

This directory publishes the V1 public and internal HTTP contract for the
Workspace Service. The formal source of truth is
[`openapi.yaml`](./openapi.yaml); operational ownership and configuration are
described in the [service README](../../../../services/workspace-service/README.md).

Workspace owns workspace records, membership lifecycle, and the stable
authorization capability snapshot. Identity remains the source of truth for
user identity/profile/account state and access-token issuance. Workflow consumes
the internal Workspace snapshot. Services must use these HTTP contracts and
must not query another service's database or create cross-service foreign keys.

## Operations

The public `/workspaces` and `/workspaces/{workspaceId}/members` operations use
an Identity-issued access JWT. The internal operation is:

```text
GET /internal/workspaces/{workspaceId}/users/{userId}/access
X-Internal-Service-Key: <configured service key>
```

The internal key is required even when a bearer token is present; an end-user
token cannot bypass the service-key boundary. The response contains
`workspaceId`, `userId`, `role`, and a capability set. Current capabilities are
additive and consumers must tolerate unknown future values. Consumers must
check capabilities they understand rather than infer permissions from
`MembershipRole` alone.

Member views contain the two current optional workflow booleans
`canPublishWorkflow` and `canManageWorkflowState`. These are persistence
details behind the contract. A future `membership_permissions` representation
or custom-role model must remain behind the same response and authorization
boundary.

Workspace list pages default to page 0/size 20 and member pages to
`displayName` ascending. Sizes are bounded to 1–100, searches to 120
characters, and role, sort, and direction values are allow-listed. Identity
directory search is bounded to candidate membership IDs in chunks of at most
500; display-name ordering remains deterministic across chunks, including
case-folded non-null names, null-last ordering, and user-ID tie-breaking.

## Connections and credentials

Public `/workspaces/{workspaceId}/connections` routes use the same JWT security
rule as the workspace and membership routes. The JWT subject is the only actor
identity accepted by Workspace. Members can read connection metadata, while
`config` is returned as `null` when the caller cannot manage that connection.
Credential values are write-only on public routes; responses expose only
`hasCredential` and the safe `credentialExpiresAt` timestamp.

Connection create, update, credential replacement/removal, provider test,
manual disable, and Google OAuth start are separate operations in
[`openapi.yaml`](./openapi.yaml). New connections start `DISABLED`; only a
successful provider verification activates them. Known credential fields and
sensitive headers are rejected in provider configuration; credential values
belong in the write-only credential route. Google OAuth redirect and frontend
return URLs are server-configured. The callback consumes Redis-backed one-time state, and
redirects only to the configured frontend URL with an allow-listed outcome.
Invalid state has no trusted connection identifier, so its failure redirect
omits `connectionId`. Workspace requests only the Gmail metadata or Sheets
scopes documented by the service and never grants Gmail send or broad Drive
access.

Workflow-facing `/internal/workspaces/{workspaceId}/connections/{connectionId}`
routes require `X-Internal-Service-Key`. Attachment authorization checks the
requested member's relationship to the connection. Runtime resolution is
available only for an `ACTIVE` connection and returns the minimum provider
authentication needed to run it. That internal response includes secrets, is
marked `Cache-Control: no-store`, and never contains a Google refresh token.
Only a confirmed `AUTHENTICATION_REJECTED` report can mark a connection
`INVALID`; transient provider errors must not be reported as authentication
failures.

## Errors and request correlation

Every response carries `X-Correlation-Id`. Safe incoming values are reused and
invalid or absent values are replaced with a generated UUID. All documented
errors use this exact top-level shape:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Request validation failed",
  "requestId": "request-id"
}
```

`requestId` matches the response header. Error messages are sanitized; tokens,
service keys, downstream raw bodies, and profile fields are not exposed in
errors or diagnostics. Identity dependency failures return `503`
`DEPENDENCY_UNAVAILABLE`. Business conflicts keep their documented `409`
status, and authentication/authorization failures keep `401`/`403` semantics.

## Storage and cache boundary

PostgreSQL is authoritative for workspace, membership, and authorization state.
Redis/Valkey is a cache-aside optimization for authorization snapshots under
`workspace:authz:{workspaceId}:{userId}`. The TTL is configurable and defaults
to five minutes. Membership and permission mutations invalidate relevant cache
entries after commit, with generation fencing to prevent stale repopulation.
Redis/Valkey read, write, or eviction failure falls back to PostgreSQL. If an
eviction outage prevents invalidation, a previously cached authorization value
may remain until the configured TTL expires; this contract does not promise
instant revocation during that outage. No profile cache exists in V1.

## Deferred scope

Invitations, ownership transfer, workspace delete/archive, and generic
RBAC/custom roles are outside this V1 contract. Future archive/soft-delete and
explicit hard-delete flows must remain additive to the current
create/read/member/connection operations.
