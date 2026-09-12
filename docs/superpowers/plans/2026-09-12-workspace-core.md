# Workspace Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the WEAV Workspace Service V1 core end-to-end: workspace lifecycle (without delete), membership management, extensible workspace authorization capabilities, Identity-backed member lookup/search, Redis/Valkey authorization caching, public JWT security, and an internal service-to-service authorization contract for Workflow Service.

**Architecture:** Keep the existing WEAV Clean Architecture direction used by Identity Service and the current Workspace Service: `domain` owns business rules and ports, `application` owns use cases/DTOs, `infrastructure` implements persistence/cache/Identity/security adapters, and `presentation` owns HTTP contracts. PostgreSQL remains the source of truth; Redis/Valkey is cache-only. Authorization consumers depend on stable capability snapshots rather than Workspace's current persistence booleans.

**Tech Stack:** Java 25, Spring Boot 4.1, Spring Security OAuth2 Resource Server, Spring Data JPA, PostgreSQL, Flyway, Spring Data Redis with Redis/Valkey, Spring `RestClient`, OpenAPI YAML, JUnit 5, Mockito, Testcontainers.

**Spec:** Approved Design 1-3 from the planning conversation is embedded below under **Approved Design Baseline** because the requested deliverable is a single Markdown implementation plan.

## Global Constraints

- Work directly on the currently checked-out implementation branch (expected `dev`).
- **DO NOT create a git worktree.**
- **DO NOT create or switch to another branch automatically.**
- Before editing, run `git status --short --branch`; if the branch is not the intended implementation branch or the tree contains unrelated changes that would be overwritten, stop and reconcile instead of discarding them.
- Follow the existing Identity Service / Workspace Service Clean Architecture conventions; do not perform a broad package restructure solely to make folders look cleaner.
- Apply YAGNI: no generic RBAC engine, CQRS, command bus, event bus, service mesh, invitation subsystem, ownership transfer, workspace delete/archive implementation, or generic cache framework in this plan.
- Use design patterns only where they solve an actual boundary/problem: Ports & Adapters, Policy, Cache-Aside, Mapper, and lightweight query/specification composition.
- PostgreSQL is authoritative for workspace/membership state. Redis/Valkey must never become the only source of authorization truth.
- Public Workspace endpoints authenticate with the Identity-issued access JWT and derive the current user from `sub`; clients do not submit their own acting `userId`.
- Internal service endpoints use `X-Internal-Service-Key` in V1. Keep verification behind infrastructure/security code so service JWT or mTLS can replace it later without changing authorization use cases.
- Never log JWTs, authorization headers, internal API keys, passwords, credentials, or secrets.
- Identity downtime must produce deterministic `503 DEPENDENCY_UNAVAILABLE` behavior for operations that require Identity data, with structured diagnostic logs.
- Redis/Valkey downtime must degrade to PostgreSQL for authorization lookups and must not cause a `503` by itself.
- Workspace name uniqueness is scoped to the OWNER, is trim + case-insensitive, and must be enforced by PostgreSQL in addition to application validation.
- Workspace delete/archive is not implemented in V1, but do not design repositories/domain code around an assumption that workspaces are immortal.
- Connection/Credential implementation is explicitly out of scope for this plan.
- Preserve existing `Connection` / `Credential` scaffolding and migrations unless a compile-safe adjustment is strictly required by Workspace core changes.
- Prefer focused files/classes over a single large `WorkspaceService`.
- TDD is required: write a failing test, run it, implement the minimum behavior, rerun, then commit.

---

## Approved Design Baseline

### Product decisions

1. This plan implements **Workspace core first**:
   - Workspace create/list/get/rename.
   - Membership list/add/update permissions/remove/leave.
   - Workspace authorization/capability resolution.
   - Internal authorization contract for Workflow Service.
   - Search/filter/sort/page support.
   - Redis/Valkey authorization cache.
   - Minimal Identity internal directory capability needed by Workspace.
2. `Connection` and `Credential` are deferred to a separate plan.
3. Add member flow accepts **email of an existing active Identity user**. No invitation/pending membership subsystem exists in V1.
4. Every workspace has exactly one OWNER.
5. Ownership transfer is not supported in V1.
6. OWNER cannot leave or be removed.
7. MEMBER can leave.
8. Removing/leaving a membership does not delete or transfer workflows/resources. Historical `createdBy` external user IDs remain untouched.
9. Workspace delete is not exposed in V1. Future soft/hard delete must be possible without redesigning the whole service.
10. All workspace members can view workspace details and the member list.
11. Only OWNER can rename workspace, add/remove members, and update member permissions.
12. MEMBER default workflow capabilities are Create/Edit/Run/Monitor.
13. New MEMBER optional flags default to:
    - `canPublishWorkflow = false`
    - `canManageWorkflowState = false`
14. V1 database keeps those two booleans, but cross-service authorization exposes `WorkspaceCapability` values so future permissions can be added without changing consumers to understand persistence columns.
15. `List my Workspaces`:
    - search by workspace name,
    - filter by `OWNER|MEMBER`,
    - sort by `name|createdAt|updatedAt`,
    - page-based pagination.
16. `List Members`:
    - search by Identity email/human-readable name,
    - filter by role and the two optional permission flags,
    - sort by `displayName|joinedAt|role`,
    - page-based pagination.
17. Workspace stores Identity `userId` only. It does not persist member email/display name.
18. Member responses are enriched from Identity.
19. Identity is source of truth for user existence, active status, email, and user-facing name.
20. Identity unavailable:
    - `Add Member`,
    - member search,
    - enriched member listing
    return `503 DEPENDENCY_UNAVAILABLE`.
21. Workspace does not call Identity to re-check active status on every authenticated Workspace request. Identity owns account/token lifecycle.
22. Internal authorization uses service-to-service authentication plus explicit `workspaceId` + `userId`, not forwarded end-user access tokens.
23. V1 service-to-service authentication uses a shared internal API key/header and must be replaceable later.
24. Internal authorization returns a capability snapshot, not a generic `authorize(action)` boolean.
25. Workspace names:
    - are not globally unique,
    - are unique among workspaces owned by the same OWNER,
    - are normalized with trim + case-insensitive comparison,
    - preserve the user's original display casing.
26. If create omits a name, generate `My workspace N`, where `N` is current maximum matching default number for that OWNER + 1; do not fill gaps.
27. Duplicate member add returns `409 USER_ALREADY_MEMBER`.
28. Adding an inactive Identity user is rejected.
29. Default-name generation and duplicate-name prevention rely on PostgreSQL uniqueness as the final race-condition guard.
30. Use Redis/Valkey from V1, primarily for workspace authorization snapshots.

### Public HTTP surface

```http
POST   /workspaces
GET    /workspaces
GET    /workspaces/{workspaceId}
PATCH  /workspaces/{workspaceId}

GET    /workspaces/{workspaceId}/members
POST   /workspaces/{workspaceId}/members
PATCH  /workspaces/{workspaceId}/members/{userId}/permissions
DELETE /workspaces/{workspaceId}/members/{userId}
DELETE /workspaces/{workspaceId}/members/me
```

Not in V1:

```http
DELETE /workspaces/{workspaceId}
PATCH  /workspaces/{workspaceId}/members/{userId}/role
POST   /workspaces/{workspaceId}/transfer-ownership
```

### Internal HTTP surface

Workspace authorization:

```http
GET /internal/workspaces/{workspaceId}/users/{userId}/access
X-Internal-Service-Key: <secret>
```

Identity directory must minimally support:
- exact user lookup by normalized email for `Add Member`,
- matching/searching candidate user IDs by email/name,
- batch profile summaries by user ID,
- page/sort by user-facing name when Identity-owned sorting is required.

### Capability model

Initial V1 capability names:

```text
WORKSPACE_VIEW
MEMBER_VIEW
WORKFLOW_CREATE
WORKFLOW_EDIT
WORKFLOW_RUN
WORKFLOW_MONITOR
WORKFLOW_PUBLISH
WORKFLOW_MANAGE_STATE
WORKSPACE_RENAME
MEMBER_ADD
MEMBER_REMOVE
MEMBER_MANAGE_PERMISSIONS
```

Policy:
- OWNER receives all V1 capabilities.
- MEMBER receives `WORKSPACE_VIEW`, `MEMBER_VIEW`, `WORKFLOW_CREATE`, `WORKFLOW_EDIT`, `WORKFLOW_RUN`, `WORKFLOW_MONITOR`.
- MEMBER additionally receives `WORKFLOW_PUBLISH` when `canPublishWorkflow=true`.
- MEMBER additionally receives `WORKFLOW_MANAGE_STATE` when `canManageWorkflowState=true`.

---

## File Structure Map

The implementer must first verify these paths against the current `dev` tree. Existing paths listed below were observed during planning; proposed new paths follow the current package direction. If a current file uses a nearby established package/name, modify that file rather than creating a parallel duplicate abstraction.

### Workspace Service — existing files to retain/extend

```text
services/workspace-service/pom.xml
services/workspace-service/src/main/java/com/weav/workspace/domain/model/Workspace.java
services/workspace-service/src/main/java/com/weav/workspace/domain/model/Membership.java
services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/WorkspaceRepository.java
services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/MembershipRepository.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/CreateWorkspaceCommand.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/WorkspaceResponse.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CreateWorkspaceUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/SecurityConfig.java
services/workspace-service/src/main/resources/db/migration/V1__create_workspace_entities.sql
services/workspace-service/src/test/java/.../WorkspacePersistenceTest.java
```

### Workspace Service — proposed focused files

```text
services/workspace-service/src/main/java/com/weav/workspace/domain/model/WorkspaceCapability.java
services/workspace-service/src/main/java/com/weav/workspace/domain/policy/WorkspaceAuthorizationPolicy.java
services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/IdentityDirectoryPort.java
services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/WorkspaceAuthorizationCache.java

services/workspace-service/src/main/java/com/weav/workspace/application/dto/PageResult.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/WorkspaceListQuery.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/AddMemberCommand.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/UpdateMemberPermissionsCommand.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/MemberListQuery.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/MemberView.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/IdentityUserSummary.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/WorkspaceAccessSnapshot.java

services/workspace-service/src/main/java/com/weav/workspace/application/usecase/GetWorkspaceUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ListWorkspacesUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/RenameWorkspaceUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/AddMemberUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ListMembersUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/UpdateMemberPermissionsUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/RemoveMemberUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/LeaveWorkspaceUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ResolveWorkspaceAccessUseCase.java

services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryHttpClient.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryProperties.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache/RedisWorkspaceAuthorizationCache.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache/WorkspaceAuthorizationCacheProperties.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/InternalServiceKeyFilter.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/InternalServiceKeyProperties.java

services/workspace-service/src/main/java/com/weav/workspace/presentation/http/WorkspaceController.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/MembershipController.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/InternalWorkspaceAuthorizationController.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/GlobalExceptionHandler.java

services/workspace-service/src/main/resources/db/migration/V2__workspace_core_constraints.sql
```

Persistence adapter/entity/mapper file names must reuse the current scaffold names if present rather than creating parallel adapter classes.

### Shared contracts

```text
packages/contracts/http/workspace/openapi.yaml
packages/contracts/http/workspace/README.md
```

For Identity internal directory, extend the current Identity contract location already established in the repository. Do not create a second competing public Identity contract solely because this plan cannot re-fetch the repo. The implementation task below defines the required operations and schemas.

---

# Task 1: Lock the Contracts, Dependencies, and Baseline Build

**Files:**
- Create: `packages/contracts/http/workspace/openapi.yaml`
- Create: `packages/contracts/http/workspace/README.md`
- Modify: `services/workspace-service/pom.xml`
- Modify: current Workspace configuration file under `services/workspace-service/src/main/resources/`
- Modify: current Identity HTTP contract file under `packages/contracts/http/` to add the minimal internal directory operations defined below.

**Interfaces:**
- Produces public Workspace HTTP operation IDs and schemas consumed by Tasks 7-9.
- Produces internal Workspace authorization schema consumed by Task 9.
- Produces Identity directory contract consumed by Task 5.
- Adds Redis and OAuth2 Resource Server dependencies used by later tasks.

- [ ] **Step 1: Verify repository/branch state without creating a worktree**

Run:

```bash
git status --short --branch
git branch --show-current
```

Expected:
- current branch is the intended implementation branch (normally `dev`);
- no command in this plan creates a worktree;
- unrelated local changes are preserved.

Also inspect:

```bash
find services/identity-service/src/main/java -maxdepth 7 -type f | sort
find services/workspace-service/src/main/java -maxdepth 7 -type f | sort
find packages/contracts/http -maxdepth 3 -type f | sort
```

Use the actual current Identity naming/package conventions when the proposed names in this plan differ only cosmetically.

- [ ] **Step 2: Add a contract validation test/check that fails before the Workspace contract exists**

If the repo has an existing OpenAPI validation script, extend it to include the Workspace contract. Otherwise add a minimal test/check in the same contract-validation mechanism already used by Identity/OCR.

Required path:

```text
packages/contracts/http/workspace/openapi.yaml
```

Run the repository's contract validation command.

Expected: FAIL because the Workspace OpenAPI file/operations do not yet exist.

- [ ] **Step 3: Define the Workspace OpenAPI operations**

The public contract must include exactly these V1 operations:

```yaml
operationId:
  - createWorkspace
  - listMyWorkspaces
  - getWorkspace
  - renameWorkspace
  - listWorkspaceMembers
  - addWorkspaceMember
  - updateWorkspaceMemberPermissions
  - removeWorkspaceMember
  - leaveWorkspace
  - getInternalWorkspaceAccess
```

Required query vocabulary:

```yaml
listMyWorkspaces:
  search: string?
  role: OWNER|MEMBER?
  page: integer >= 0
  size: integer
  sort: name|createdAt|updatedAt
  direction: asc|desc

listWorkspaceMembers:
  search: string?
  role: OWNER|MEMBER?
  canPublishWorkflow: boolean?
  canManageWorkflowState: boolean?
  page: integer >= 0
  size: integer
  sort: displayName|joinedAt|role
  direction: asc|desc
```

Use a bounded V1 page size, e.g. default `20`, max `100`.

Define stable error body:

```yaml
ErrorResponse:
  type: object
  required: [code, message, requestId]
  properties:
    code: { type: string }
    message: { type: string }
    requestId: { type: string }
```

Define page response metadata:

```yaml
page:
size:
totalElements:
totalPages:
```

Do not expose JPA entities in the contract.

- [ ] **Step 4: Define the internal authorization contract**

Required response shape:

```yaml
WorkspaceAccessResponse:
  type: object
  required: [workspaceId, userId, role, capabilities]
  properties:
    workspaceId:
      type: string
      format: uuid
    userId:
      type: string
      format: uuid
    role:
      $ref: '#/components/schemas/MembershipRole'
    capabilities:
      type: array
      uniqueItems: true
      items:
        $ref: '#/components/schemas/WorkspaceCapability'
```

The internal endpoint is:

```http
GET /internal/workspaces/{workspaceId}/users/{userId}/access
```

Document `X-Internal-Service-Key` as the V1 internal authentication mechanism without embedding any example real secret.

- [ ] **Step 5: Extend the existing Identity contract with minimal internal directory operations**

The Identity contract must support these semantics:

```text
lookup active/user summary by normalized email
match candidate user IDs by email/user-facing name
page/sort candidate users by user-facing name
batch fetch user summaries by IDs
```

Use Identity's actual canonical user-facing name field. If the existing domain field is named `username`, expose it to Workspace as the contract's `displayName` without adding a duplicate persistence column merely for this feature.

Required internal summary shape:

```yaml
IdentityUserSummary:
  userId: UUID
  email: string
  displayName: string
  active: boolean
```

For candidate searches, use request bodies rather than thousands of user IDs in a query string.

- [ ] **Step 6: Add only the required Workspace dependencies**

In `services/workspace-service/pom.xml`, ensure the service has:
- Spring Web,
- Spring Validation,
- Spring Data JPA,
- Spring Security,
- OAuth2 Resource Server / JOSE support matching Identity JWT,
- Spring Data Redis,
- PostgreSQL driver,
- Flyway,
- test dependencies already used by the repo,
- Testcontainers where integration tests need PostgreSQL/Valkey.

Do not add Feign, Resilience4j, MapStruct, or another framework unless it is already a project-wide established dependency and materially reduces duplicate code.

- [ ] **Step 7: Run baseline compile/contract validation**

Run from the repository's normal Maven entry point, preferring the existing wrapper if present:

```bash
./mvnw -pl services/workspace-service -am test -DskipTests
```

On Windows PowerShell use the repository's Maven wrapper equivalent.

Also run the contract validation command from Step 2.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/http services/workspace-service/pom.xml services/workspace-service/src/main/resources
git commit -m "chore(workspace): define core service contracts"
```

---

# Task 2: Domain Rules, Capability Policy, and Workspace Name Invariants

**Files:**
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/model/Workspace.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/model/Membership.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/domain/model/WorkspaceCapability.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/domain/policy/WorkspaceAuthorizationPolicy.java`
- Test: create focused domain tests under `services/workspace-service/src/test/java/com/weav/workspace/domain/`

**Interfaces:**
- Produces `WorkspaceCapability`.
- Produces `WorkspaceAuthorizationPolicy.resolve(Membership)` used by Tasks 6, 8, and 9.
- Locks workspace/member domain invariants before persistence/use-case implementation.

- [ ] **Step 1: Write failing tests for capability resolution**

Tests must prove:

```java
OWNER -> every V1 capability

MEMBER(false, false) ->
WORKSPACE_VIEW
MEMBER_VIEW
WORKFLOW_CREATE
WORKFLOW_EDIT
WORKFLOW_RUN
WORKFLOW_MONITOR

MEMBER(true, false) -> adds WORKFLOW_PUBLISH
MEMBER(false, true) -> adds WORKFLOW_MANAGE_STATE
```

Representative test shape:

```java
@Test
void memberWithPublishGrantGetsPublishButNotManageState() {
    Membership membership = Membership.member(workspaceId, userId, true, false);

    Set<WorkspaceCapability> result = policy.resolve(membership);

    assertThat(result).contains(WorkspaceCapability.WORKFLOW_PUBLISH);
    assertThat(result).doesNotContain(WorkspaceCapability.WORKFLOW_MANAGE_STATE);
}
```

Run the focused domain test.

Expected: FAIL because the capability policy does not exist.

- [ ] **Step 2: Implement the explicit V1 capability enum**

Define:

```java
public enum WorkspaceCapability {
    WORKSPACE_VIEW,
    MEMBER_VIEW,
    WORKFLOW_CREATE,
    WORKFLOW_EDIT,
    WORKFLOW_RUN,
    WORKFLOW_MONITOR,
    WORKFLOW_PUBLISH,
    WORKFLOW_MANAGE_STATE,
    WORKSPACE_RENAME,
    MEMBER_ADD,
    MEMBER_REMOVE,
    MEMBER_MANAGE_PERMISSIONS
}
```

Do not turn this into database-backed generic permissions in V1.

- [ ] **Step 3: Implement `WorkspaceAuthorizationPolicy`**

Use a pure domain class with no Spring/JPA/Redis imports.

Required API:

```java
public Set<WorkspaceCapability> resolve(Membership membership)
```

OWNER gets all current enum values. MEMBER gets the baseline set plus optional capabilities from the two booleans.

Run the focused test.

Expected: PASS.

- [ ] **Step 4: Write failing tests for membership invariants**

Tests must prove:
- newly created non-owner membership defaults both optional flags to false;
- OWNER cannot be treated as a normal permission-edit target;
- MEMBER can leave;
- OWNER cannot leave;
- OWNER role is not mutable through a generic setter/update method.

Prefer behavior methods over open mutable setters where current model conventions permit it.

- [ ] **Step 5: Implement membership behavior without inventing generic RBAC**

Keep the existing persistence fields:

```text
role
canPublishWorkflow
canManageWorkflowState
```

Add focused domain methods only where they make invariants clearer, for example:

```java
membership.updateOptionalPermissions(canPublish, canManageState);
membership.assertCanLeave();
```

Do not add `setRole(OWNER)` as a public application workflow.

- [ ] **Step 6: Write failing tests for workspace naming normalization**

Create a small domain/application utility only if the logic would otherwise be duplicated.

Required normalization behavior:

```text
" Project A " -> normalized "project a"
"PROJECT A"   -> normalized "project a"
```

Stored/display name remains trimmed original casing:

```text
" Project A " -> display "Project A"
```

Blank after trim is invalid.

- [ ] **Step 7: Implement normalization with locale-safe casing**

Use `Locale.ROOT` for lowercase normalization.

Keep name-length validation aligned with the existing DB column/contract limit.

- [ ] **Step 8: Run all domain tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*DomainTest,*AuthorizationPolicyTest,*Workspace*Test,*Membership*Test' test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/workspace-service/src/main/java/com/weav/workspace/domain services/workspace-service/src/test/java/com/weav/workspace/domain
git commit -m "feat(workspace): add workspace authorization policy"
```

---

# Task 3: PostgreSQL Constraints, Mapping Ownership, and Repository Query Ports

**Files:**
- Create: `services/workspace-service/src/main/resources/db/migration/V2__workspace_core_constraints.sql`
- Modify: current Workspace JPA entity.
- Modify: current Membership JPA entity if lifecycle generation conflicts with domain values.
- Modify: current persistence mapper(s).
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/WorkspaceRepository.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/MembershipRepository.java`
- Modify: current Workspace/Membership repository adapters.
- Test: extend persistence integration tests.

**Interfaces:**
- Produces normalized owner-scoped name uniqueness.
- Produces page/filter query methods consumed by Tasks 4 and 6.
- Makes domain identity/timestamps round-trip safely.

- [ ] **Step 1: Write failing persistence tests for owner-scoped name uniqueness**

Test with PostgreSQL/Flyway, not H2.

Prove:

```text
same owner + "Project A" and "project a" -> unique violation / repository conflict
different owner + same normalized name -> allowed
```

Also prove `(workspace_id, user_id)` membership uniqueness remains enforced.

Expected: FAIL before V2 migration.

- [ ] **Step 2: Add `name_normalized` safely in V2**

Migration sequence:

```sql
ALTER TABLE workspace_schema.workspaces
    ADD COLUMN name_normalized varchar(/* use same effective name length */);

UPDATE workspace_schema.workspaces
SET name_normalized = lower(btrim(name));

ALTER TABLE workspace_schema.workspaces
    ALTER COLUMN name_normalized SET NOT NULL;

CREATE UNIQUE INDEX ux_workspaces_owner_name_normalized
    ON workspace_schema.workspaces (created_by, name_normalized);
```

Use the repository's exact schema/table naming from V1. Do not edit V1 in place once it has been committed/used; add V2.

- [ ] **Step 3: Make domain/application the owner of IDs/timestamps**

Inspect current domain constructors/factories and JPA lifecycle callbacks.

Required rule:

```text
domain creates/preserves id + createdAt + updatedAt
mapper persists those values
mapper reconstructs exactly those values
JPA does not silently replace them with unrelated generated values
```

Remove duplicate `@PrePersist`/generation behavior only where it conflicts with this rule.

- [ ] **Step 4: Write failing mapper round-trip tests**

For both Workspace and Membership:

```text
domain -> JPA -> domain
```

must preserve:
- ID,
- owner/user IDs,
- role,
- permission flags,
- created/joined timestamps,
- updated timestamps,
- original name and normalized name where appropriate.

- [ ] **Step 5: Extend repository ports with use-case-shaped methods**

Use focused query objects rather than a combinatorial list of Spring Data method names.

Required semantics:

```java
Workspace save(Workspace workspace);
Optional<Workspace> findById(UUID workspaceId);
boolean existsOwnedNameNormalized(UUID ownerId, String normalizedName, UUID excludeWorkspaceIdOrNull);
int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId);
PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(UUID userId, WorkspaceListQuery query);
```

Membership semantics:

```java
Membership save(Membership membership);
Optional<Membership> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
List<Membership> findCandidates(UUID workspaceId, MemberMembershipFilter filter);
PageResult<Membership> pageCandidatesByWorkspaceOwnedSort(...);
void delete(Membership membership);
```

If an equivalent existing method already exists, extend/reuse it rather than duplicating it with a different name.

- [ ] **Step 6: Implement dynamic query composition only where needed**

For `List my Workspaces`, support:
- user membership scope,
- optional normalized name search,
- optional role,
- sort allow-list,
- page/size.

For member DB filtering, support:
- role,
- `canPublishWorkflow`,
- `canManageWorkflowState`.

Use JPA Criteria/Specification only if it keeps the adapter smaller than hand-written branching. Do not expose Spring `Specification` through the domain port.

- [ ] **Step 7: Test default-name number query**

Given owned names:

```text
My workspace 1
My workspace 3
Other
```

`findMaxDefaultWorkspaceNumberByOwner(owner)` returns `3`.

Matching should be case-insensitive for the fixed `My workspace ` prefix but must only parse a positive integer suffix.

- [ ] **Step 8: Run persistence integration tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*PersistenceTest,*Repository*Test,*Mapper*Test' test
```

Expected: PASS with PostgreSQL Testcontainer/Flyway.

- [ ] **Step 9: Commit**

```bash
git add services/workspace-service/src/main/resources/db/migration services/workspace-service/src/main/java/com/weav/workspace/domain/port/out services/workspace-service/src/main/java/com/weav/workspace/infrastructure services/workspace-service/src/test
git commit -m "feat(workspace): enforce workspace persistence invariants"
```

---

# Task 4: Workspace Create, List, Get, and Rename Use Cases

**Files:**
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/CreateWorkspaceCommand.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/WorkspaceResponse.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/WorkspaceListQuery.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/PageResult.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CreateWorkspaceUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ListWorkspacesUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/GetWorkspaceUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/RenameWorkspaceUseCase.java`
- Test: application use-case tests with mocked ports.

**Interfaces:**
- Consumes Task 3 repositories and Task 2 naming/policy rules.
- Produces workspace application APIs consumed by Task 8 controllers.

- [ ] **Step 1: Write failing `CreateWorkspaceUseCase` tests**

Cover:
1. explicit name is trimmed and normalized;
2. creator becomes exactly one OWNER membership in the same transaction;
3. duplicate normalized owned name -> `WORKSPACE_NAME_ALREADY_EXISTS`;
4. omitted name -> `My workspace N`;
5. default numbering uses max + 1 and does not fill gaps;
6. separate owners may use the same name;
7. database uniqueness conflict is translated to the same stable business conflict.

Required command shape:

```java
public record CreateWorkspaceCommand(UUID actorUserId, String name) {}
```

`name` may be null/blank only when it means "generate default"; distinguish omitted from invalid whitespace according to the OpenAPI request model and validation rules.

- [ ] **Step 2: Implement create transaction**

Required sequence:

```text
normalize/choose name
pre-check owner-scoped uniqueness
create Workspace
create OWNER Membership
commit
```

Annotate the application boundary transactionally according to existing project style.

For concurrent default-name generation, use PostgreSQL uniqueness as final guard. Implement a small bounded retry around generated default names; do not add a Redis distributed lock.

- [ ] **Step 3: Write failing list tests**

Prove:
- only workspaces where actor has membership are returned;
- `role` filter works;
- name search is trim/case-insensitive;
- sort allow-list works;
- page metadata is correct;
- unknown sort values fail validation rather than being interpolated into SQL.

- [ ] **Step 4: Implement `ListWorkspacesUseCase`**

Required signature concept:

```java
PageResult<WorkspaceResponse> execute(UUID actorUserId, WorkspaceListQuery query)
```

Do not call Identity for this use case.

- [ ] **Step 5: Write failing get tests**

Cases:
- OWNER can get;
- MEMBER can get;
- non-member cannot observe the workspace;
- missing/non-visible workspace uses the agreed non-leaking `404` response path.

- [ ] **Step 6: Implement `GetWorkspaceUseCase`**

Membership lookup gates visibility.

- [ ] **Step 7: Write failing rename tests**

Cases:
- OWNER can rename;
- MEMBER cannot rename;
- normalized duplicate owned name -> 409 business conflict;
- casing/whitespace normalization works;
- renaming to the same normalized current name succeeds as a no-conflict idempotent rename if display casing changes only.

- [ ] **Step 8: Implement `RenameWorkspaceUseCase`**

Do not evict authorization cache solely for rename because V1 capability membership does not depend on workspace name.

- [ ] **Step 9: Run application tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*CreateWorkspace*Test,*ListWorkspaces*Test,*GetWorkspace*Test,*RenameWorkspace*Test' test
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/workspace-service/src/main/java/com/weav/workspace/application services/workspace-service/src/test
git commit -m "feat(workspace): implement workspace core use cases"
```

---

# Task 5: Identity Internal Directory Contract and Workspace Identity Adapter

**Files:**
- Modify: the current Identity Service internal/application/presentation files following its existing Clean Architecture structure.
- Modify: current Identity security configuration only as required to protect the internal directory endpoints.
- Create: `services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/IdentityDirectoryPort.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/IdentityUserSummary.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryHttpClient.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity/IdentityDirectoryProperties.java`
- Test: Identity internal directory tests + Workspace adapter HTTP tests.

**Interfaces:**
- Produces `IdentityDirectoryPort` for Task 6.
- Uses the internal service API key mechanism but keeps Identity-specific HTTP details out of Workspace application/domain code.

- [ ] **Step 1: Write failing Identity directory tests**

Using Identity's current user repository/domain, prove:
- normalized exact email lookup returns user summary;
- inactive user summary still reports `active=false` so Workspace can reject add;
- candidate search never returns a user outside `candidateUserIds`;
- search matches email and the canonical human-readable Identity name;
- batch lookup returns only requested IDs;
- page/sort by human-readable name is stable and deterministic.

Do not add Workspace concepts such as `workspaceId`, `role`, or permission flags to Identity.

- [ ] **Step 2: Implement minimal Identity application queries**

Follow Identity Service's existing Clean Architecture style.

Keep internal result model equivalent to:

```java
public record UserDirectorySummary(
    UUID userId,
    String email,
    String displayName,
    boolean active
) {}
```

Map `displayName` from Identity's existing canonical human-readable field. Do not duplicate the field in Identity persistence just to satisfy Workspace.

- [ ] **Step 3: Protect Identity internal directory endpoints**

Reuse the project's internal service authentication mechanism if one already exists after Task 1 inspection. Otherwise add the same `X-Internal-Service-Key` verification pattern planned for Workspace Task 9.

Internal API key mismatch -> `401` or `403` consistently with the project's security convention.

- [ ] **Step 4: Write failing Workspace `IdentityDirectoryPort` adapter tests**

Use MockWebServer/WireMock or the HTTP test facility already established in the repo.

Cases:
- email lookup success;
- email lookup user not found;
- inactive response mapped without losing state;
- candidate search/page mapping;
- batch lookup;
- timeout;
- connection refusal;
- Identity `5xx`;
- Identity `4xx` semantic mapping.

Timeout/connection/5xx must become a typed dependency failure used later as `503 DEPENDENCY_UNAVAILABLE`.

- [ ] **Step 5: Implement the Workspace `RestClient` adapter**

Required port semantics:

```java
Optional<IdentityUserSummary> findByEmail(String normalizedEmail);

Set<UUID> matchUserIds(
    Collection<UUID> candidateUserIds,
    String search
);

PageResult<IdentityUserSummary> searchUsersByDisplayName(
    Collection<UUID> candidateUserIds,
    String search,
    int page,
    int size,
    SortDirection direction
);

List<IdentityUserSummary> getUsersByIds(Collection<UUID> userIds);
```

Why two search shapes:
- when sorting by `displayName`, Identity owns the sort and pagination;
- when sorting by Workspace-owned `joinedAt|role`, Identity returns matching IDs first, then Workspace DB applies correct sort/page and batch-enriches only the page.

This preserves correct `totalElements` without duplicating profile fields into Workspace DB.

- [ ] **Step 6: Configure explicit timeouts**

Use finite connect/read/request timeouts through the project's Spring HTTP client configuration.

Do not add unbounded retries.

If the repo already uses Resilience4j globally, reuse the existing mechanism; otherwise do not introduce it solely for this call.

- [ ] **Step 7: Run Identity + Workspace adapter tests**

Run the focused modules/tests using the repository's multi-module Maven layout.

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/identity-service packages/contracts/http services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/IdentityDirectoryPort.java services/workspace-service/src/main/java/com/weav/workspace/application/dto/IdentityUserSummary.java services/workspace-service/src/main/java/com/weav/workspace/infrastructure/identity services/workspace-service/src/test
git commit -m "feat(identity): expose internal user directory"
```

---

# Task 6: Membership Management and Correct Cross-Service Search/Pagination

**Files:**
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/AddMemberCommand.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/UpdateMemberPermissionsCommand.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/MemberListQuery.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/MemberView.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/AddMemberUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ListMembersUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/UpdateMemberPermissionsUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/RemoveMemberUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/LeaveWorkspaceUseCase.java`
- Test: focused application tests.

**Interfaces:**
- Consumes `MembershipRepository`, `IdentityDirectoryPort`, and capability/owner rules.
- Produces membership APIs for Task 8.
- Emits cache invalidation requests once Task 7 supplies the cache port; until then tests use a fake/mock port introduced in Task 7. Implement Task 7 immediately after this task before merging behavior that depends on invalidation.

- [ ] **Step 1: Write failing `AddMemberUseCase` tests**

Required cases:
- actor OWNER + active Identity user + not member -> create MEMBER;
- new MEMBER flags are both false;
- actor MEMBER -> forbidden;
- Identity user missing -> `USER_NOT_FOUND`;
- Identity user inactive -> `USER_INACTIVE`;
- target already a member -> `USER_ALREADY_MEMBER`;
- Identity unavailable -> typed dependency error;
- concurrent duplicate membership is translated from DB unique violation to `USER_ALREADY_MEMBER`.

Input:

```java
public record AddMemberCommand(
    UUID workspaceId,
    UUID actorUserId,
    String email
) {}
```

- [ ] **Step 2: Implement add-member transaction**

Normalize email according to Identity's established email rules before lookup.

Do not persist email/display name in Workspace.

- [ ] **Step 3: Write failing member-list tests for all filter/sort paths**

Cases without profile search:
- role filter;
- optional permission filters;
- `joinedAt` sort;
- `role` sort;
- page metadata.

Cases with profile search:
- email/name search only returns Identity matches inside candidate IDs;
- no outside user can leak into the result.

Cases with `displayName` sort:
- Identity performs profile-owned sort/page;
- Workspace joins membership metadata by `userId`.

Cases with `joinedAt|role` sort plus profile search:
- Workspace gets matched IDs from Identity,
- Workspace DB sorts/pages the matching membership set,
- Workspace batch-enriches only the page,
- totals remain exact.

- [ ] **Step 4: Implement `ListMembersUseCase` with two explicit query paths**

Pseudocode:

```java
if (query.sort() == DISPLAY_NAME) {
    candidates = membershipRepository.findCandidates(workspaceId, workspaceFilters);
    identityPage = identityDirectory.searchUsersByDisplayName(
        candidateIds(candidates), query.search(), page, size, direction
    );
    return join(identityPage, candidates);
}

matchedIds = query.hasSearch()
    ? identityDirectory.matchUserIds(candidateIds, query.search())
    : candidateIds;

membershipPage = membershipRepository.pageCandidatesByWorkspaceOwnedSort(
    workspaceId, workspaceFilters, matchedIds, page, size, query.sort(), direction
);

profiles = identityDirectory.getUsersByIds(pageUserIds(membershipPage));
return join(membershipPage, profiles);
```

Avoid fetching all Identity profiles when only one page needs enrichment.

- [ ] **Step 5: Write failing permission-update tests**

Cases:
- OWNER updates MEMBER booleans;
- MEMBER cannot update another member;
- target OWNER -> `OWNER_PERMISSIONS_IMMUTABLE`;
- target missing/non-visible -> stable not-found behavior;
- changing either flag is reflected by subsequent capability resolution.

- [ ] **Step 6: Implement `UpdateMemberPermissionsUseCase`**

Do not accept arbitrary capability names in V1 public API. The persistence update remains the two explicit booleans.

- [ ] **Step 7: Write failing remove tests**

Cases:
- OWNER removes MEMBER;
- MEMBER cannot remove;
- OWNER cannot remove OWNER;
- removal deletes membership only;
- no Workflow/other resource deletion is triggered.

- [ ] **Step 8: Implement remove-member behavior**

Use membership identity `(workspaceId, userId)` as the target.

- [ ] **Step 9: Write failing leave tests**

Cases:
- MEMBER leaves successfully;
- OWNER -> `OWNER_CANNOT_LEAVE`;
- leave deletes only own membership;
- another user's membership cannot be deleted through `/me`.

- [ ] **Step 10: Implement leave behavior**

Actor identity is always derived from authenticated context at presentation boundary and passed explicitly into the use case.

- [ ] **Step 11: Run membership application tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*Member*UseCaseTest,*ListMembers*Test,*Membership*Test' test
```

Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add services/workspace-service/src/main/java/com/weav/workspace/application services/workspace-service/src/test
git commit -m "feat(workspace): implement membership management"
```

---

# Task 7: Redis/Valkey Authorization Cache and Access Resolver

**Files:**
- Create: `services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/WorkspaceAuthorizationCache.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/dto/WorkspaceAccessSnapshot.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ResolveWorkspaceAccessUseCase.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache/RedisWorkspaceAuthorizationCache.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache/WorkspaceAuthorizationCacheProperties.java`
- Modify: membership mutation use cases from Task 6 to evict after successful commit.
- Modify: Workspace configuration.
- Test: cache unit/integration tests with Valkey/Redis container.

**Interfaces:**
- Produces cache-aside authorization resolution for public authorization checks and Task 9 internal endpoint.
- Consumes `MembershipRepository` and `WorkspaceAuthorizationPolicy`.

- [ ] **Step 1: Write failing cache-aside use-case tests**

Required `ResolveWorkspaceAccessUseCase` behavior:

```text
cache hit -> no repository call
cache miss -> repository -> policy -> cache put -> return
no membership -> not found/no access result
cache read failure -> log warning -> repository fallback
cache write failure -> still return DB-derived answer
```

Required snapshot:

```java
public record WorkspaceAccessSnapshot(
    UUID workspaceId,
    UUID userId,
    MembershipRole role,
    Set<WorkspaceCapability> capabilities
) {}
```

- [ ] **Step 2: Define a domain-specific cache port**

Required methods:

```java
Optional<WorkspaceAccessSnapshot> get(UUID workspaceId, UUID userId);
void put(WorkspaceAccessSnapshot snapshot, Duration ttl);
void evict(UUID workspaceId, UUID userId);
```

Add `evictWorkspace(UUID workspaceId)` only if the chosen Redis key/index implementation can support it without `KEYS` in production. Since workspace delete/archive is not implemented, it is acceptable to omit broad eviction in V1.

Do not create `CacheService<K,V>`.

- [ ] **Step 3: Implement cache-aside resolution**

Cache key:

```text
workspace:authz:{workspaceId}:{userId}
```

TTL is configurable, for example:

```yaml
weav:
  workspace:
    authorization-cache:
      ttl: PT5M
```

The exact default may be `PT5M`; configuration must permit changing it without code changes.

- [ ] **Step 4: Write failing Redis/Valkey adapter integration tests**

Use a Testcontainers Valkey or Redis-compatible image.

Prove:
- put/get round-trip;
- TTL expires;
- evict removes key;
- serialized capability sets round-trip without type loss;
- malformed cache payload is treated as cache miss + warning, not a 500 if DB can answer.

- [ ] **Step 5: Implement Redis adapter with `StringRedisTemplate` + JSON**

Prefer explicit JSON serialization of `WorkspaceAccessSnapshot` to hidden Java native serialization.

Do not store secrets in cache payloads.

- [ ] **Step 6: Add post-success invalidation to membership mutations**

After a successful committed mutation:

```text
AddMember -> defensive evict target
UpdateMemberPermissions -> evict target
RemoveMember -> evict target
LeaveWorkspace -> evict actor
```

Ensure invalidation cannot expose an uncommitted DB state. Use the project's transaction synchronization/event-after-commit mechanism if direct post-method ordering would evict before commit.

Do not introduce a general event bus for this.

- [ ] **Step 7: Write mutation + cache invalidation tests**

Tests must prove:
- permission update invalidates stale capability snapshot;
- remove/leave invalidates access;
- failed transaction does not publish a successful new cached authorization state;
- Redis failure does not roll back a correct PostgreSQL membership mutation unless current project policy explicitly treats cache as mandatory (it should not for this design).

- [ ] **Step 8: Run cache tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*AuthorizationCache*Test,*ResolveWorkspaceAccess*Test,*CacheInvalidation*Test' test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/workspace-service/src/main/java/com/weav/workspace/domain/port/out/WorkspaceAuthorizationCache.java services/workspace-service/src/main/java/com/weav/workspace/application services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache services/workspace-service/src/main/resources services/workspace-service/src/test
git commit -m "feat(workspace): cache workspace authorization"
```

---

# Task 8: Public JWT Security and Public HTTP Endpoints

**Files:**
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/SecurityConfig.java`
- Create/modify: presentation request/response types following existing Workspace conventions.
- Create: `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/WorkspaceController.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/MembershipController.java`
- Test: MVC/security integration tests.

**Interfaces:**
- Consumes Tasks 4, 6, and 7.
- Public authentication consumes Identity-issued access JWT only.
- Produces the public OpenAPI behavior defined in Task 1.

- [ ] **Step 1: Write failing security tests that expose stale scaffold behavior**

Tests must prove:
- `/workspaces/**` without bearer token -> 401;
- valid Identity-style access JWT -> authenticated;
- expired/invalid signature token -> 401;
- HTTP Basic is not accepted as Workspace auth;
- Workspace does not expose local `/auth/**` login/refresh behavior.

Expected: current scaffold fails because it still contains HTTP Basic/auth leftovers.

- [ ] **Step 2: Replace Workspace auth scaffold with Resource Server behavior**

Configure JWT decoding to match the **current Identity access-token issuer exactly**:
- same signing algorithm,
- same access-token secret/key source,
- same issuer/audience validation if Identity currently emits those claims.

Do not invent a second refresh-token configuration in Workspace.

Derive actor ID from JWT `sub`.

- [ ] **Step 3: Write failing Workspace controller tests**

Cover:
- create explicit/default name;
- list query validation and pagination;
- get;
- rename OWNER success;
- rename MEMBER forbidden;
- non-member scoped resource visibility -> 404.

- [ ] **Step 4: Implement `WorkspaceController`**

Controller responsibilities:
- bind/validate HTTP input;
- read `sub`;
- translate to application commands/queries;
- return contract responses.

Do not place repository or authorization policy logic in the controller.

- [ ] **Step 5: Write failing Membership controller tests**

Cover:
- list as OWNER and MEMBER;
- add by email OWNER-only;
- update permission OWNER-only;
- remove MEMBER;
- leave current MEMBER;
- owner leave conflict;
- duplicate member conflict;
- Identity dependency unavailable -> 503.

- [ ] **Step 6: Implement `MembershipController`**

The client never submits actor `userId`. For remove, `{userId}` identifies the target only.

- [ ] **Step 7: Add sort/page allow-list validation**

Reject:
- negative page;
- non-positive or over-max size;
- unknown sort field;
- unknown direction;
- invalid role enum.

Do not pass arbitrary client sort strings into JPA.

- [ ] **Step 8: Run public HTTP/security tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*Controller*Test,*Security*Test' test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security services/workspace-service/src/main/java/com/weav/workspace/presentation services/workspace-service/src/test
git commit -m "feat(workspace): expose secured workspace APIs"
```

---

# Task 9: Internal Service-Key Security and Workflow-Facing Authorization Endpoint

**Files:**
- Create: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/InternalServiceKeyFilter.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/InternalServiceKeyProperties.java`
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/SecurityConfig.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/InternalWorkspaceAuthorizationController.java`
- Test: internal security/authorization integration tests.

**Interfaces:**
- Consumes `ResolveWorkspaceAccessUseCase`.
- Produces the stable internal capability snapshot for Workflow Service.
- Must remain independent of end-user access-token forwarding.

- [ ] **Step 1: Write failing internal security tests**

Cases:

```text
no X-Internal-Service-Key -> rejected
wrong key -> rejected
correct key -> allowed
correct key does not require end-user Bearer token
public bearer token alone cannot call internal endpoint
```

Use constant-time secret comparison where practical.

- [ ] **Step 2: Implement internal-key authentication as infrastructure**

Header:

```text
X-Internal-Service-Key
```

Secret source:

```text
WEAV_INTERNAL_SERVICE_KEY
```

or the repository's established environment/property naming convention.

Never log the supplied or configured key.

- [ ] **Step 3: Write failing authorization endpoint tests**

Cases:
- OWNER snapshot returns all V1 capabilities;
- MEMBER baseline;
- MEMBER optional permission flags;
- non-member -> `MEMBERSHIP_NOT_FOUND`/404;
- first call cache miss reaches DB;
- second call cache hit avoids repository;
- Redis unavailable still returns DB-derived snapshot.

- [ ] **Step 4: Implement `InternalWorkspaceAuthorizationController`**

Endpoint:

```http
GET /internal/workspaces/{workspaceId}/users/{userId}/access
```

Return only stable authorization information. Do not return secrets, Identity profile data, or JPA structures.

- [ ] **Step 5: Verify Workflow-friendly extensibility**

Add a serialization test that demonstrates an older consumer can ignore newly added capability strings/enum values if the consumer contract is designed for additive enum handling.

At minimum, document in `packages/contracts/http/workspace/README.md`:

```text
Capabilities are additive. Consumers must check capabilities they understand
and must not infer authorization from MembershipRole alone.
```

- [ ] **Step 6: Run internal endpoint tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*Internal*Test,*WorkspaceAccess*Test' test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security services/workspace-service/src/main/java/com/weav/workspace/presentation/http/InternalWorkspaceAuthorizationController.java packages/contracts/http/workspace services/workspace-service/src/test
git commit -m "feat(workspace): expose internal authorization contract"
```

---

# Task 10: Error Mapping, Correlation IDs, and Structured Dependency Logging

**Files:**
- Create/modify: Workspace domain/application exception classes following existing conventions.
- Create: `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/GlobalExceptionHandler.java`
- Create/modify: request correlation filter/interceptor in the existing cross-cutting package.
- Modify: `IdentityDirectoryHttpClient.java`
- Modify: `RedisWorkspaceAuthorizationCache.java`
- Test: exception contract and log behavior tests.

**Interfaces:**
- Produces stable error codes used by public/internal HTTP tests.
- Ensures dependency failures are diagnosable without leaking secrets.

- [ ] **Step 1: Write failing exception-mapping tests**

Required mappings:

```text
validation -> 400
unauthenticated -> 401
authenticated forbidden action -> 403
scoped resource not visible/not found -> 404
WORKSPACE_NAME_ALREADY_EXISTS -> 409
USER_ALREADY_MEMBER -> 409
USER_INACTIVE -> 409
OWNER_CANNOT_LEAVE -> 409
OWNER_PERMISSIONS_IMMUTABLE -> 409
Identity dependency unavailable -> 503 DEPENDENCY_UNAVAILABLE
unexpected -> 500 INTERNAL_ERROR
```

Every error body contains:

```text
code
message
requestId
```

- [ ] **Step 2: Implement centralized exception mapping**

Do not duplicate error JSON creation in controllers.

Do not expose stack traces or downstream raw response bodies to clients.

- [ ] **Step 3: Add/request correlation ID propagation**

Behavior:
- if trusted incoming correlation header exists according to repo convention, reuse/sanitize it;
- otherwise generate one;
- include it in logging MDC and error response `requestId`;
- propagate it to Identity downstream requests.

Use the project's existing header name if one exists; otherwise standardize one for WEAV, e.g. `X-Request-Id`.

- [ ] **Step 4: Write failing structured dependency log tests**

Identity failure log must contain fields equivalent to:

```text
event=identity_directory_failure
requestId
operation
downstream=identity-service
errorType
latencyMs
```

Redis degradation log must identify:
- cache read/write/evict operation,
- workspace/user identifiers where safe,
- exception class/category,
- requestId if available.

Logs must not contain:
- bearer JWT,
- `Authorization`,
- `X-Internal-Service-Key`,
- passwords/secrets.

- [ ] **Step 5: Implement structured logging**

Use the logging conventions already used elsewhere in WEAV.

Business conflicts such as duplicate member/name should not be logged as infrastructure `ERROR`; reserve error-level logs for unexpected/system failures.

- [ ] **Step 6: Run error/log tests**

```bash
./mvnw -pl services/workspace-service -Dtest='*Exception*Test,*Logging*Test,*Correlation*Test' test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/workspace-service/src/main/java services/workspace-service/src/test
git commit -m "feat(workspace): standardize errors and diagnostics"
```

---

# Task 11: End-to-End Persistence, Cache, Security, and Concurrency Tests

**Files:**
- Extend: existing `WorkspacePersistenceTest`.
- Create: Workspace end-to-end integration test classes under `services/workspace-service/src/test/java/`.
- Create/modify: shared Testcontainers test configuration if the repo already has one.

**Interfaces:**
- Verifies the complete service boundary from HTTP/application through PostgreSQL/Redis and mocked Identity.
- Acts as acceptance gate before final cleanup.

- [ ] **Step 1: Upgrade the existing persistence smoke test**

The existing test that only proves Flyway/JPA boot must additionally prove:
- domain/JPA mapper correctness,
- repository adapter behavior,
- V2 owner-name uniqueness,
- membership uniqueness,
- default-name query,
- no duplicate OWNER creation through the create use case.

- [ ] **Step 2: Add full create-to-authorization happy-path test**

Scenario:

```text
Identity user A has valid JWT
A POST /workspaces without name
-> My workspace 1
-> A is OWNER

A adds active user B by email
-> B MEMBER(false,false)

A updates B canPublishWorkflow=true

trusted Workflow caller GET internal access for B
-> contains WORKFLOW_PUBLISH

call internal access again
-> cache hit
```

Verify PostgreSQL rows and Redis behavior as part of the test.

- [ ] **Step 3: Add cache invalidation end-to-end test**

Scenario:

```text
B authorization cached with publish=true
A changes publish=false
transaction commits
cache entry invalidated
next internal access resolves publish=false
```

- [ ] **Step 4: Add leave/remove end-to-end tests**

Prove:
- MEMBER can leave and immediately loses workspace access;
- OWNER cannot leave;
- OWNER removes MEMBER;
- removing membership does not delete workspace or unrelated records.

- [ ] **Step 5: Add Identity failure tests**

For Add Member and List Members:
- timeout -> 503;
- Identity 500 -> 503;
- requestId present;
- structured failure log emitted.

Redis is not used as a fallback profile cache.

- [ ] **Step 6: Add Redis outage test**

Stop/unavailable Redis and prove:
- internal authorization still succeeds from PostgreSQL;
- warning is logged;
- cache outage alone does not return 503.

- [ ] **Step 7: Add duplicate-name concurrency test**

Run two concurrent create requests for the same owner + same normalized name.

Expected:
- one succeeds;
- one receives `WORKSPACE_NAME_ALREADY_EXISTS`/409;
- database contains one matching workspace.

- [ ] **Step 8: Add duplicate-member concurrency test**

Run two concurrent add-member operations for the same `(workspaceId,userId)`.

Expected:
- one succeeds;
- one receives `USER_ALREADY_MEMBER`/409;
- database contains one membership.

- [ ] **Step 9: Add default-name progression test**

Create:

```text
My workspace 1
My workspace 2
My workspace 3
```

Also test a pre-existing gap:

```text
My workspace 1
My workspace 3
```

Next generated default must be `My workspace 4`.

No V1 test should delete workspace to manufacture gaps because Workspace delete is out of scope; seed the fixture directly where necessary.

- [ ] **Step 10: Run full Workspace test suite**

```bash
./mvnw -pl services/workspace-service test
```

Then run the Identity tests affected by Task 5.

Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add services/workspace-service/src/test services/identity-service/src/test
git commit -m "test(workspace): cover workspace core end to end"
```

---

# Task 12: Documentation, Configuration, and Final Verification

**Files:**
- Modify/create: `services/workspace-service/README.md` if service READMEs are used in the repository.
- Modify: `packages/contracts/http/workspace/README.md`
- Modify: environment example/config documentation currently used by the repo.
- Modify: thesis/Notion docs only if the user explicitly asks during implementation; do not silently rewrite thesis material as part of code execution.

**Interfaces:**
- Documents operational configuration and architectural boundaries for the next Workflow Service implementation.

- [ ] **Step 1: Document service boundaries**

Workspace README/contract README must state:

```text
Workspace Service owns:
- Workspace
- Membership + workspace authorization
- V1 authorization capabilities

Deferred:
- Connection/Credential implementation (separate plan)

Identity owns:
- user identity/profile/account state
- access token issuance

Workflow Service consumes:
- internal Workspace authorization capability snapshot
```

Explicitly prohibit cross-service DB queries/FKs.

- [ ] **Step 2: Document configuration**

Document only variable names, never real values. Include equivalents of:

```text
DATABASE_URL / datasource configuration
Identity service base URL
Identity/internal service API key
Identity JWT verification configuration
Redis/Valkey host/port/URI
authorization cache TTL
request/connect/read timeouts
```

- [ ] **Step 3: Document cache semantics**

State:
- PostgreSQL authoritative;
- cache-aside;
- TTL configurable;
- membership mutation invalidation;
- Redis failure falls back to DB;
- no profile cache in V1.

- [ ] **Step 4: Document extensibility boundaries**

State:
- capability list is additive;
- consumers must not hard-code role-to-permission logic;
- current booleans are persistence details;
- future `membership_permissions`/custom roles can replace persistence representation behind the same authorization boundary;
- V1 has no workspace delete, but future archive/soft-delete and explicit hard-delete flows are expected to be added without changing current create/read/member contracts.

- [ ] **Step 5: Run formatting/static checks used by the repository**

Run the existing Java formatter/linter/checkstyle commands if configured.

Do not introduce a new formatter solely for this plan.

- [ ] **Step 6: Run final module verification**

Run:

```bash
./mvnw -pl services/workspace-service -am test
```

Then run the repository's contract validation.

If Identity Service was modified, run its full test suite too.

Expected: all PASS.

- [ ] **Step 7: Verify git diff and forbidden scope**

Run:

```bash
git status --short
git diff --stat
git diff
```

Confirm no accidental implementation of:
- Workspace delete/archive,
- ownership transfer,
- generic RBAC tables,
- Connection/Credential,
- invitations,
- Workflow Service business logic,
- generic event bus,
- worktree setup.

- [ ] **Step 8: Final commit**

```bash
git add services/workspace-service services/identity-service packages/contracts/http
git commit -m "docs(workspace): finalize workspace core contract"
```

If there is nothing left to commit because documentation was included in earlier commits, do not create an empty commit.

---

# Acceptance Checklist

The implementation is complete only when all of the following are true:

- [ ] User with valid Identity access JWT can create Workspace.
- [ ] Create automatically creates exactly one OWNER membership.
- [ ] Omitted name generates `My workspace N` using max + 1.
- [ ] Same OWNER cannot own trim/case-insensitive duplicate names.
- [ ] Different OWNERs can own the same workspace name.
- [ ] `List my Workspaces` supports required search/filter/sort/page.
- [ ] OWNER and MEMBER can get a workspace they belong to.
- [ ] Non-members cannot enumerate scoped workspace details.
- [ ] Only OWNER can rename.
- [ ] OWNER can add an existing active user by email.
- [ ] Duplicate add returns `USER_ALREADY_MEMBER`.
- [ ] Inactive user add is rejected.
- [ ] Identity downtime returns `503 DEPENDENCY_UNAVAILABLE` for Identity-dependent operations.
- [ ] OWNER and MEMBER can list enriched members.
- [ ] Member list search/filter/sort/page totals are correct across Identity-owned and Workspace-owned sort fields.
- [ ] OWNER can update MEMBER optional permissions.
- [ ] OWNER's own optional permissions are immutable in V1.
- [ ] OWNER can remove MEMBER.
- [ ] MEMBER can leave.
- [ ] OWNER cannot leave or be removed.
- [ ] Removing/leaving does not delete workflows/resources.
- [ ] Capability policy maps roles/flags correctly.
- [ ] Internal Workflow-facing endpoint returns capability snapshot.
- [ ] Internal endpoint uses service API key, not end-user token forwarding.
- [ ] Redis/Valkey caches authorization snapshots.
- [ ] Membership/permission mutations invalidate relevant cache entries after successful commit.
- [ ] Redis/Valkey outage falls back to PostgreSQL.
- [ ] PostgreSQL is the final guard for duplicate workspace names and memberships.
- [ ] Concurrent duplicate create/add cases are tested.
- [ ] Structured logs make Identity/Redis failures diagnosable.
- [ ] Secrets/tokens are not logged.
- [ ] Workspace does not implement login/refresh-token behavior.
- [ ] No worktree is created.
- [ ] No new branch is created automatically.
- [ ] Connection/Credential remains outside this plan.
- [ ] Full Workspace and affected Identity tests pass.
- [ ] OpenAPI contract validation passes.

# Self-Review Notes

## Spec coverage

Covered:
- Workspace core scope.
- Membership lifecycle.
- owner/member rules.
- default and normalized naming.
- search/filter/sort/pagination.
- Identity enrichment/search.
- active user checks.
- capability abstraction and future permission extensibility.
- Redis/Valkey cache and graceful degradation.
- internal S2S authorization contract.
- public JWT resource-server behavior.
- structured diagnostics.
- persistence race guards.
- future delete extensibility without implementing delete.
- direct-branch/no-worktree requirement.

Deferred intentionally:
- Connection/Credential.
- workspace delete/archive.
- ownership transfer.
- invite flow.
- generic RBAC/custom-role persistence.
- Workflow Service implementation.

## Type consistency

Canonical cross-task types:
- `WorkspaceCapability`
- `WorkspaceAccessSnapshot`
- `IdentityUserSummary`
- `WorkspaceListQuery`
- `MemberListQuery`
- `PageResult<T>`
- `IdentityDirectoryPort`
- `WorkspaceAuthorizationCache`

If the current repository already contains an equivalent type with another established name, reuse and consistently rename references in this plan during execution rather than creating duplicates.

## Placeholder scan

This plan contains no unresolved implementation placeholders. Conditional instructions only exist where the current repository already has a convention/dependency that must be reused instead of duplicated.

