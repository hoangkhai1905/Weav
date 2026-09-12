# Workspace HTTP contract

This directory publishes the Workspace Service V1 public and internal HTTP
contract. The service owns workspaces, memberships, and the stable authorization
capability snapshot. Identity remains the source of truth for user existence,
active status, email, display name, and access-token issuance.

Capabilities are additive. Consumers must check capabilities they understand and
must not infer authorization from `MembershipRole` alone. The two member boolean
fields are persistence details behind this boundary.

`WorkspaceCapability` remains a closed OpenAPI enum because the V1 plan requires
that published shape. Consumers must still act as tolerant readers: ignore
unknown capability values rather than failing the whole authorization snapshot.
Task 9 must add a runtime consumer test covering that forward-compatible behavior
before a later capability is added.

Identity directory search is bounded per request. Workspace partitions the full
membership ID set into chunks of at most 500, calls the IDs-only match operation
for every chunk, and unions exact IDs. For display-name-owned ordering it pages
each chunk, performs a k-way merge by case-folded non-null display name, null-last,
then ascending user ID, sums exact totals, and slices the global page. It must not
concatenate chunk pages or apply a hidden aggregate cap.

Workflow Service consumes `GET
/internal/workspaces/{workspaceId}/users/{userId}/access` with the
`X-Internal-Service-Key` header. PostgreSQL is authoritative for membership and
authorization state; Redis/Valkey is cache-only. Workspace Service never reads
Identity tables directly, and Identity does not persist Workspace concepts.

Connection and Credential implementation, invitations, ownership transfer, and
workspace delete/archive are outside this V1 contract.
