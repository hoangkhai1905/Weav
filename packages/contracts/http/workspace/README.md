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

Connection and Credential implementation, invitations, ownership transfer,
workspace delete/archive, and generic RBAC/custom roles are outside this V1
contract. Future archive/soft-delete and explicit hard-delete flows must remain
additive to the current create/read/member operations.
