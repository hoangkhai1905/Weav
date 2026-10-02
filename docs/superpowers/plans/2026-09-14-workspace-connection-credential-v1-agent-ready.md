> Consolidated Workspace Service implementation plans. The two milestone plans below retain their original scope, constraints, task checklists, and acceptance criteria.

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


---

# Workspace Connection & Credential V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện Connection + Credential cho Workspace Service V1, gồm CRUD, authorization, encrypted credential storage, provider verification, Google OAuth2, runtime credential resolution và Workflow usage protection.

**Architecture:** Giữ kiến trúc hiện tại của Workspace Service. Application use cases orchestration business flow; domain giữ lifecycle/rules; provider-specific logic nằm sau các outbound ports nhỏ; infrastructure triển khai PostgreSQL/Redis/Google/Telegram/HTTP. Không xây generic plugin framework.

## Architecture & Design Pattern Constraints

This implementation MUST preserve the existing Workspace Service architecture.
Do not redesign unrelated parts of the service.

**Repository convention rule:** Follow existing repository conventions over this plan's illustrative class names when they differ. Do not perform unrelated refactors. If an equivalent abstraction/pattern already exists in the codebase, extend or reuse it instead of creating a parallel implementation.

### Architectural Style

Use the existing **Hexagonal / Ports-and-Adapters** structure:

```text
Controller
  -> Application Use Case
  -> Domain / Policy
  -> Outbound Port
  -> Infrastructure Adapter
  -> External System
```

Dependency direction MUST remain inward:

```text
presentation -> application -> domain
```

Infrastructure implements ports defined by application/domain.

Domain and application code MUST NOT depend directly on:

- Spring Data JPA repositories
- Redis APIs
- `RestClient` / `WebClient`
- Google SDK/API implementation details
- Telegram API implementation details
- Workflow Service HTTP implementation

### Required Patterns

#### 1. Use Case Pattern

Keep business flows as focused use cases, for example:

- `CreateConnectionUseCase`
- `UpdateConnectionUseCase`
- `SaveCredentialUseCase`
- `DeleteCredentialUseCase`
- `TestConnectionUseCase`
- `ResolveConnectionUseCase`
- `StartConnectionOAuthUseCase`
- `CompleteConnectionOAuthUseCase`
- `AuthorizeConnectionAttachmentUseCase`
- `ReportConnectionAuthFailureUseCase`

Do NOT replace these with one large `ConnectionService`.

Each use case should orchestrate one business flow and delegate reusable rules to domain/policy components.

#### 2. Repository Pattern

Domain/application accesses Connection and Credential persistence only through:

- `ConnectionRepository`
- `CredentialRepository`

Infrastructure provides JPA/Spring Data adapters.

Spring Data repository types and JPA entities MUST NOT leak into domain/application code.

#### 3. Strategy Pattern

Provider-specific behavior MUST be isolated behind `ConnectionProviderPort`.

Implementations:

- `TelegramConnectionProvider`
- `HttpConnectionProvider`
- `GoogleConnectionProvider`

Do NOT scatter `switch(provider)` or `if (provider == ...)` branches across use cases.

Provider-specific differences belong inside provider strategies.

#### 4. Registry Pattern

`ConnectionProviderRegistry` resolves the correct provider strategy.

The registry is intentionally small and static for V1.

Do NOT turn it into:

- a dynamic plugin framework
- runtime classpath discovery
- provider manifest system
- database-driven provider registry

#### 5. Policy Pattern

Reusable business rules belong in focused policy classes:

- `ConnectionAuthorizationPolicy`
- `ConnectionProviderPolicy`
- `GoogleOAuthScopePolicy`

Do NOT duplicate authorization, provider/auth compatibility, or OAuth scope rules across controllers and use cases.

#### 6. Adapter Pattern

External dependencies must be represented as infrastructure adapters behind explicit ports.

Examples:

- `WorkflowConnectionUsageClient`
- `RedisOAuthStateStore`
- `GoogleOAuthProvider`
- `TelegramConnectionProvider`
- `HttpConnectionProvider`
- `AesGcmCredentialCrypto`

Application/domain code should only know the corresponding interfaces/contracts.

#### 7. Mapper Pattern

Persistence entities MUST NOT leak into domain/application code.

Use dedicated persistence mapping for:

- `Connection <-> ConnectionJpaEntity`
- `Credential <-> CredentialJpaEntity` when mapping logic is required

Mapping responsibilities must remain separate from business-rule enforcement.

### Patterns Explicitly NOT Required

Do NOT introduce these unless this plan/spec is explicitly revised:

- generic plugin framework
- Abstract Factory hierarchy
- CQRS framework
- Event Sourcing
- Saga orchestration
- generic RBAC engine
- provider inheritance hierarchy
- shared OAuth-grant subsystem
- distributed lock for Google token refresh
- additional microservices
- domain events solely to connect components that already communicate synchronously in-process

### Abstraction Rule

If a new abstraction has only one implementation and does not protect a meaningful architectural boundary or expected V1 variation, do not create it merely for pattern purity.

Single implementations are still justified when they protect an important boundary, for example:

- `CredentialCryptoPort` isolates cryptography from application logic.
- `WorkflowConnectionUsagePort` isolates a cross-service contract.
- `OAuthStateStore` isolates Redis/state persistence.
- `GoogleOAuthPort` isolates external OAuth behavior.

### AI-Agent Implementation Guardrails

Before creating a new class or interface, the implementing agent MUST check whether an equivalent abstraction already exists in the repository.

The agent MUST NOT:

- collapse the use-case structure into a god service
- move business authorization into controllers
- access another service's database
- bypass ports by calling external clients directly from use cases
- create abstractions unrelated to a requirement in this plan
- refactor Workspace Core code unless required for Connection/Credential V1
- replace existing repository architecture with a new architectural style

When the plan's example name differs from an established repository naming convention, preserve the architectural responsibility but use the repository convention.

**Patterns are used to preserve boundaries and reduce provider-specific coupling, not as goals by themselves.**

**Tech Stack:** Java 25, Spring Boot 4.1, Spring WebMVC `RestClient`, Spring Data JPA, PostgreSQL, Flyway, Redis, Spring Security, AES-256-GCM, JUnit 5, Testcontainers.

**Spec:** Validated design from this conversation. Intended repository spec path: `docs/superpowers/specs/2026-09-14-workspace-connection-credential-design.md`.

## Global Constraints

- Connection belongs to Workspace; `createdBy` is audit/management metadata, not ownership that disappears when MEMBER leaves.
- OWNER manages every Connection in Workspace.
- MEMBER can create Connection and manage their own Connection only while it is not referenced by a workflow.
- MEMBER can see metadata of every Connection but full `config` only for Connections they created.
- MEMBER may attach only Connections they created; OWNER may attach any Connection.
- Existing authorized workflow execution may use another member's Connection.
- Workflow definition stores `connectionId`; never `credentialId` or secret.
- `provider` and `authType` are immutable.
- Valid combinations:
  - `GMAIL -> OAUTH2`
  - `GOOGLE_SHEETS -> OAUTH2`
  - `TELEGRAM -> TOKEN`
  - `HTTP -> NONE | API_KEY | TOKEN | BASIC`
- New Connection starts `DISABLED`.
- Successful verification -> `ACTIVE`.
- Confirmed auth rejection -> `INVALID`.
- Replacing/removing credential -> `DISABLED`.
- Manual disable is allowed; there is no direct `DISABLED -> ACTIVE` toggle. Re-enable requires Test/OAuth verification.
- Hard delete Connection only when Workflow reports `inUse=false`.
- Required Workflow usage check failure -> `503`; never fail open.
- Connection names are unique per Workspace after normalization.
- `config` contains no secret.
- Credential payload uses AES-256-GCM.
- Plaintext credentials are never logged, cached, returned publicly, persisted in workflow/execution state, or put into OAuth state.
- Google refresh token never leaves Workspace Service.
- Google OAuth grant remains one Credential per Connection in V1.
- OAuth callback uses one-time Redis state with short TTL and does not require JWT.
- Callback re-checks current Workspace membership and Connection management permission.
- HTTP provider test must enforce SSRF protections.
- Provider/network `5xx`, `429`, timeout, DNS/network failures are transient dependency failures; they do not automatically mark Connection `INVALID`.
- Workspace/archive/delete, invitation, ownership transfer and generic/custom RBAC remain out of scope.

---

## Target File Structure

Existing files to extend:

```text
services/workspace-service/
├── src/main/java/com/weav/workspace/
│   ├── domain/
│   │   ├── model/
│   │   │   ├── Connection.java
│   │   │   └── Credential.java
│   │   ├── port/out/
│   │   │   ├── ConnectionRepository.java
│   │   │   └── CredentialRepository.java
│   │   └── valueobject/
│   │       ├── ConnectionProvider.java
│   │       ├── ConnectionAuthType.java
│   │       └── ConnectionStatus.java
│   ├── application/
│   │   ├── dto/
│   │   ├── port/out/
│   │   ├── service/
│   │   └── usecase/
│   ├── infrastructure/
│   │   ├── cache/
│   │   ├── config/
│   │   ├── persistence/
│   │   ├── security/
│   │   └── web/
│   └── presentation/http/
├── src/main/resources/
│   ├── application.properties
│   └── db/migration/
└── src/test/java/com/weav/workspace/
```

New focused packages:

```text
application/port/out/
├── ConnectionProviderPort.java
├── CredentialCryptoPort.java
├── GoogleOAuthPort.java
├── OAuthStateStore.java
└── WorkflowConnectionUsagePort.java

application/service/
├── ConnectionAuthorizationPolicy.java
├── ConnectionProviderPolicy.java
├── ConnectionViewAssembler.java
├── CredentialPayloadCodec.java
├── GoogleOAuthScopePolicy.java
└── ConnectionProviderRegistry.java

infrastructure/
├── credential/
│   └── AesGcmCredentialCrypto.java
├── provider/
│   ├── google/
│   ├── telegram/
│   └── http/
├── workflow/
│   └── WorkflowConnectionUsageClient.java
└── cache/
    └── RedisOAuthStateStore.java
```

---

### Task 1: Domain lifecycle and authorization rules

**Files:**
- Modify: `services/workspace-service/src/main/java/com/weav/workspace/domain/model/Connection.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionProviderPolicy.java`
- Create: `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionAuthorizationPolicy.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionDomainTest.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionAuthorizationPolicyTest.java`

**Interfaces:**

```java
public final class ConnectionProviderPolicy {
    public void validate(ConnectionProvider provider, ConnectionAuthType authType);
    public boolean requiresCredential(ConnectionAuthType authType);
}

public final class ConnectionAuthorizationPolicy {
    public boolean canViewConfig(Membership membership, Connection connection);
    public boolean canAttach(Membership membership, Connection connection);
    public boolean canManageIgnoringUsage(Membership membership, Connection connection);
}
```

`Connection` exposes:

```java
public static String normalizeName(String name);

public void rename(String name);
public void updateConfig(Map<String, Object> config);

public void markDisabled();
public void markInvalid();
public void markVerified(Instant verifiedAt);
```

`createNew(...)` must initialize `ConnectionStatus.DISABLED`.

- [ ] **Step 1: Write lifecycle tests**

```java
@Test
void newConnectionStartsDisabled() {
    Connection connection = Connection.createNew(
            WORKSPACE_ID,
            USER_ID,
            "Telegram",
            ConnectionProvider.TELEGRAM,
            ConnectionAuthType.TOKEN,
            Map.of());

    assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
}

@Test
void verifiedConnectionBecomesActive() {
    Connection connection = newConnection();

    Instant verifiedAt = Instant.parse("2026-09-14T08:00:00Z");
    connection.markVerified(verifiedAt);

    assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.ACTIVE);
    assertThat(connection.getLastVerifiedAt()).isEqualTo(verifiedAt);
}

@Test
void credentialReplacementCanDisableActiveConnection() {
    Connection connection = activeConnection();

    connection.markDisabled();

    assertThat(connection.getStatus()).isEqualTo(ConnectionStatus.DISABLED);
}
```

- [ ] **Step 2: Write provider/auth whitelist tests**

Verify every allowed and rejected combination explicitly.

```java
assertDoesNotThrow(() ->
    policy.validate(ConnectionProvider.HTTP, ConnectionAuthType.BASIC));

assertThrows(BadRequestException.class, () ->
    policy.validate(ConnectionProvider.GMAIL, ConnectionAuthType.TOKEN));
```

- [ ] **Step 3: Write authorization matrix tests**

Cover:

```text
OWNER + any Connection            -> manage=true, attach=true, viewConfig=true
MEMBER + own Connection           -> manage=true, attach=true, viewConfig=true
MEMBER + another Connection       -> manage=false, attach=false, viewConfig=false
```

Usage-dependent authorization is intentionally not implemented here.

- [ ] **Step 4: Implement minimal domain/policy code**

Do not introduce role interfaces or generic RBAC.

Normalization:

```java
public static String normalizeName(String name) {
    if (name == null || name.isBlank()) {
        throw new IllegalArgumentException("Connection name must not be blank");
    }

    return name.trim()
            .replaceAll("\\s+", " ")
            .toLowerCase(Locale.ROOT);
}
```

- [ ] **Step 5: Run tests**

```bash
cd services/workspace-service
./mvnw -Dtest=ConnectionDomainTest,ConnectionAuthorizationPolicyTest test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/workspace-service/src/main/java \
        services/workspace-service/src/test/java
git commit -m "feat(workspace): define connection lifecycle and access rules"
```

---

### Task 2: Persistence, normalized names, and repository adapters

**Files:**
- Create: `services/workspace-service/src/main/resources/db/migration/V3__connection_constraints.sql`
- Modify: `.../infrastructure/persistence/entity/ConnectionJpaEntity.java`
- Create: `.../infrastructure/persistence/mapper/ConnectionPersistenceMapper.java`
- Create: `.../infrastructure/persistence/repository/SpringDataConnectionRepository.java`
- Create: `.../infrastructure/persistence/repository/SpringDataCredentialRepository.java`
- Create: `.../infrastructure/persistence/repository/ConnectionRepositoryAdapter.java`
- Create: `.../infrastructure/persistence/repository/CredentialRepositoryAdapter.java`
- Modify: `.../domain/port/out/ConnectionRepository.java`
- Modify: `.../domain/port/out/CredentialRepository.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/ConnectionPersistenceTest.java`

**Repository interfaces:**

```java
public interface ConnectionRepository {
    Connection save(Connection connection);

    Optional<Connection> findById(UUID id);

    Optional<Connection> findByWorkspaceIdAndId(
            UUID workspaceId,
            UUID connectionId);

    List<Connection> findAllByWorkspaceId(UUID workspaceId);

    boolean existsByWorkspaceIdAndNameNormalized(
            UUID workspaceId,
            String normalizedName,
            UUID excludingConnectionId);

    void delete(Connection connection);
}

public interface CredentialRepository {
    Credential save(Credential credential);

    Optional<Credential> findByConnectionId(UUID connectionId);

    void deleteByConnectionId(UUID connectionId);
}
```

- [ ] **Step 1: Add failing persistence tests**

Cover:

```text
same normalized Connection name in same Workspace -> conflict
same normalized name in different Workspace       -> allowed
Credential connection_id                          -> unique
delete Connection                                 -> Credential cascade deleted
config JSON                                       -> round trips unchanged
```

- [ ] **Step 2: Add Flyway V3**

Use additive migration; do not rewrite V1/V2.

```sql
ALTER TABLE connections
    ADD COLUMN name_normalized VARCHAR(255);

UPDATE connections
SET name_normalized =
    lower(
        regexp_replace(
            trim(name),
            '\s+',
            ' ',
            'g'
        )
    );

ALTER TABLE connections
    ALTER COLUMN name_normalized SET NOT NULL;

CREATE UNIQUE INDEX uk_connections_workspace_name_normalized
    ON connections (workspace_id, name_normalized);
```

- [ ] **Step 3: Persist `nameNormalized` explicitly**

`ConnectionJpaEntity` gets:

```java
@Column(name = "name_normalized", nullable = false, length = 255)
private String nameNormalized;
```

Mapper must derive it from `Connection.normalizeName(connection.getName())`; persistence is not allowed to invent a different normalization rule.

- [ ] **Step 4: Implement Spring Data repositories/adapters**

Use existing Workspace repository adapter conventions.

Do not create a generic base repository.

- [ ] **Step 5: Run persistence tests**

```bash
./mvnw -Dtest=ConnectionPersistenceTest test
```

Expected: PASS with PostgreSQL Testcontainer.

- [ ] **Step 6: Commit**

```bash
git add services/workspace-service/src/main/resources/db/migration \
        services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence \
        services/workspace-service/src/main/java/com/weav/workspace/domain/port/out \
        services/workspace-service/src/test/java/com/weav/workspace/ConnectionPersistenceTest.java

git commit -m "feat(workspace): persist connections and credentials"
```

---

### Task 3: Connection CRUD application use cases

**Files:**
- Create: `.../application/dto/ConnectionResponse.java`
- Create: `.../application/dto/CreateConnectionCommand.java`
- Create: `.../application/dto/UpdateConnectionCommand.java`
- Create: `.../application/service/ConnectionViewAssembler.java`
- Create:
  - `CreateConnectionUseCase.java`
  - `GetConnectionUseCase.java`
  - `ListConnectionsUseCase.java`
  - `UpdateConnectionUseCase.java`
  - `DisableConnectionUseCase.java`
- Create: `.../application/usecase/ConnectionUseCasesTest.java`

Do not implement delete yet; it requires Workflow usage integration.

**Response model:**

```java
public record ConnectionResponse(
        UUID id,
        UUID workspaceId,
        UUID createdBy,
        String name,
        ConnectionProvider provider,
        ConnectionAuthType authType,
        ConnectionStatus status,
        Map<String, Object> config,
        boolean hasCredential,
        Instant credentialExpiresAt,
        Instant lastVerifiedAt,
        boolean canManage,
        boolean canAttach,
        Instant createdAt,
        Instant updatedAt) {
}
```

Rules:

```text
OWNER:
config     = visible
canManage  = true
canAttach  = true

creator MEMBER:
config     = visible
canManage  = true at local ownership level
canAttach  = true

other MEMBER:
config     = null
canManage  = false
canAttach  = false
```

`canManage` is only local ownership-level permission. Actual mutation still performs authoritative Workflow usage check later.

- [ ] **Step 1: Write create/get/list/update/disable tests**

Include:

```text
non-member -> workspace-style not found/forbidden behavior matching existing service convention
duplicate normalized name -> ConflictException
provider/auth invalid -> BadRequestException
provider/auth immutable through update
OWNER may update any Connection
MEMBER may update own Connection before usage protection is added
MEMBER cannot update another Connection
manual disable ACTIVE -> DISABLED
disable already DISABLED -> idempotent
```

- [ ] **Step 2: Implement CreateConnectionUseCase**

Flow:

```text
verify membership
→ validate provider/auth
→ normalize name / duplicate check
→ create Connection(DISABLED)
→ save
→ assemble response
```

- [ ] **Step 3: Implement Get/List**

Do not call Workflow Service from list/get.

Load Credential metadata only to calculate:

```text
hasCredential
credentialExpiresAt
```

Never expose:

```text
encryptedPayload
encryptionKeyVersion
credential id
plaintext auth fields
```

- [ ] **Step 4: Implement Update/Disable**

`PATCH` updates only:

```text
name
config
```

`provider` and `authType` are not update-command fields.

Any non-secret config change that can affect runtime validity must call:

```java
connection.markDisabled();
```

- [ ] **Step 5: Run tests**

```bash
./mvnw -Dtest=ConnectionUseCasesTest test
```

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(workspace): add connection CRUD use cases"
```

---

### Task 4: Credential encryption and manual credential lifecycle

**Files:**
- Create: `.../application/port/out/CredentialCryptoPort.java`
- Create: `.../application/service/CredentialPayloadCodec.java`
- Create: `.../infrastructure/credential/AesGcmCredentialCrypto.java`
- Create: `.../infrastructure/config/CredentialEncryptionProperties.java`
- Create:
  - `SaveCredentialUseCase.java`
  - `DeleteCredentialUseCase.java`
- Modify: `src/main/resources/application.properties`
- Create:
  - `.../infrastructure/credential/AesGcmCredentialCryptoTest.java`
  - `.../application/usecase/CredentialUseCasesTest.java`

**Encryption interface:**

```java
public interface CredentialCryptoPort {
    byte[] encrypt(byte[] plaintext);
    byte[] decrypt(byte[] encryptedPayload);
    String currentKeyVersion();
}
```

Environment:

```properties
weav.credential.encryption-key=${CREDENTIAL_ENCRYPTION_KEY}
weav.credential.encryption-key-version=${CREDENTIAL_ENCRYPTION_KEY_VERSION:v1}
```

`CREDENTIAL_ENCRYPTION_KEY` is Base64 encoding of exactly 32 random bytes.

Binary envelope:

```text
byte 0      : format version = 1
bytes 1..12 : random 12-byte GCM nonce
remaining   : ciphertext + 128-bit GCM authentication tag
```

- [ ] **Step 1: Write crypto tests**

```text
encrypt -> decrypt roundtrip
same plaintext twice -> different ciphertext
tampered ciphertext -> decryption failure
wrong key -> decryption failure
invalid key length -> application startup/config failure
```

- [ ] **Step 2: Implement AES-256-GCM**

Use:

```java
Cipher.getInstance("AES/GCM/NoPadding");
GCMParameterSpec(128, nonce);
SecureRandom();
```

Never use a static IV.

- [ ] **Step 3: Implement provider-specific credential payload validation**

Accepted manual payloads:

```json
TELEGRAM/TOKEN
{ "token": "..." }

HTTP/TOKEN
{ "token": "..." }

HTTP/API_KEY
{ "apiKey": "..." }

HTTP/BASIC
{ "username": "...", "password": "..." }
```

Reject manual credential storage for:

```text
GMAIL/OAUTH2
GOOGLE_SHEETS/OAUTH2
HTTP/NONE
```

- [ ] **Step 4: Implement save/delete use cases**

Save:

```text
authorize
→ validate credential shape
→ JSON serialize
→ encrypt
→ upsert Credential
→ connection.markDisabled()
→ save Connection
```

Delete:

```text
authorize
→ delete Credential
→ if authType != NONE: connection.markDisabled()
→ save Connection
```

Do not auto-test here.

- [ ] **Step 5: Assert secret-safe failures**

Tests must verify exception messages do not contain:

```text
token
apiKey value
password value
encrypted bytes
```

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=AesGcmCredentialCryptoTest,CredentialUseCasesTest test

git add services/workspace-service
git commit -m "feat(workspace): encrypt and manage connection credentials"
```

---

### Task 5: Provider abstraction, Telegram verification, and HTTP verification

**Files:**
- Create:
  - `.../application/port/out/ConnectionProviderPort.java`
  - `.../application/dto/ConnectionTestResult.java`
  - `.../application/service/ConnectionProviderRegistry.java`
- Create:
  - `.../infrastructure/provider/telegram/TelegramConnectionProvider.java`
  - `.../infrastructure/provider/http/HttpConnectionProvider.java`
  - `.../infrastructure/provider/http/HttpTargetValidator.java`
- Create: `.../application/usecase/TestConnectionUseCase.java`
- Create tests under:
  - `.../infrastructure/provider/telegram/`
  - `.../infrastructure/provider/http/`
  - `.../application/usecase/TestConnectionUseCaseTest.java`

**Port:**

```java
public interface ConnectionProviderPort {
    ConnectionProvider provider();

    void validateConfig(
            ConnectionAuthType authType,
            Map<String, Object> config);

    ConnectionTestResult test(
            Connection connection,
            Map<String, Object> decryptedCredential);
}
```

**Result:**

```java
public enum ConnectionTestOutcome {
    VERIFIED,
    AUTH_INVALID,
    DEPENDENCY_FAILURE
}
```

- [ ] **Step 1: Write Telegram verification tests**

Telegram TOKEN test calls:

```text
GET https://api.telegram.org/bot{token}/getMe
```

Classification:

```text
2xx + ok=true        -> VERIFIED
401/404/bad token    -> AUTH_INVALID
429/5xx/timeout      -> DEPENDENCY_FAILURE
```

Do not include token in logs or exception messages.

- [ ] **Step 2: Write HTTP config/SSRF tests**

Safe:

```text
https://api.example.com
https://api.example.com/health
```

Reject production targets resolving to:

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
::1
fc00::/7
fe80::/10
0.0.0.0/8
multicast/reserved/unspecified
common cloud metadata hosts/IPs
```

Validation algorithm:

```text
parse URI
→ scheme must be http/https
→ require host
→ resolve all host addresses immediately before request
→ reject if any resolved address is unsafe
→ reject URL user-info
→ disable/fail redirects rather than following to another target
```

Production may require HTTPS via configuration; dev/test override is explicit.

- [ ] **Step 3: Define HTTP auth application**

```text
NONE:
no Authorization/header injection

TOKEN:
Authorization: Bearer <token>

BASIC:
Authorization: Basic base64(username:password)

API_KEY:
header name comes from non-secret config `apiKeyHeaderName`
secret value comes from encrypted Credential
```

Do not support API key query-string placement in V1.

- [ ] **Step 4: Implement HTTP test behavior**

With `testPath`:

```text
baseUrl + testPath
→ SSRF validation
→ outbound request
→ classify result
```

Without `testPath`:

```text
validate URL/config/auth shape
→ VERIFIED
→ no network call
```

- [ ] **Step 5: Implement TestConnectionUseCase**

```text
load + authorize
→ decrypt credential if required
→ providerRegistry.resolve(provider)
→ test
→ VERIFIED          => markVerified(now)
→ AUTH_INVALID      => markInvalid()
→ DEPENDENCY_FAILURE => preserve previous status and throw DependencyUnavailableException
```

If Connection was `DISABLED` and provider dependency fails, leave it `DISABLED`.

If previously `ACTIVE` and provider dependency temporarily fails, leave it `ACTIVE`.

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=TelegramConnectionProviderTest,HttpConnectionProviderTest,TestConnectionUseCaseTest test

git add services/workspace-service
git commit -m "feat(workspace): verify telegram and http connections"
```

---

### Task 6: Workflow usage contract and fail-closed mutation protection

**Files:**
- Create: `packages/contracts/http/workflow/openapi.yaml`
- Remove after contract file exists: `packages/contracts/http/workflow/.gitkeep`
- Create: `.../application/port/out/WorkflowConnectionUsagePort.java`
- Create: `.../infrastructure/workflow/WorkflowConnectionUsageClient.java`
- Create: `.../infrastructure/config/WorkflowServiceProperties.java`
- Modify:
  - `UpdateConnectionUseCase.java`
  - `SaveCredentialUseCase.java`
  - `DeleteCredentialUseCase.java`
- Create: `DeleteConnectionUseCase.java`
- Modify: `application.properties`
- Create: `.../application/usecase/ConnectionUsageProtectionTest.java`

**Workflow contract:**

```http
GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage
X-Internal-Service-Key: ...
```

Response:

```json
{
  "inUse": true
}
```

Port:

```java
public interface WorkflowConnectionUsagePort {
    boolean isInUse(UUID workspaceId, UUID connectionId);
}
```

- [ ] **Step 1: Write usage-protection tests**

Required cases:

```text
MEMBER + own + inUse=false  -> update credential/config allowed
MEMBER + own + inUse=true   -> 409
OWNER + inUse=true          -> update credential/config allowed
DELETE + inUse=true         -> 409 for OWNER and MEMBER
Workflow unavailable        -> 503, no mutation
```

- [ ] **Step 2: Configure Workflow client**

```properties
weav.workflow.base-url=${WORKFLOW_SERVICE_URL:http://localhost:8082}
weav.workflow.connect-timeout=${WORKFLOW_CONNECT_TIMEOUT:3s}
weav.workflow.read-timeout=${WORKFLOW_READ_TIMEOUT:5s}
weav.workflow.internal-service-key=${WORKFLOW_INTERNAL_SERVICE_KEY:}
```

- [ ] **Step 3: Implement mutation guard**

```java
if (membership.getRole() == MembershipRole.MEMBER
        && workflowConnectionUsagePort.isInUse(
                connection.getWorkspaceId(),
                connection.getId())) {
    throw new ConflictException("Connection is used by a workflow");
}
```

OWNER skips usage guard for update/credential rotation.

- [ ] **Step 4: Implement deletion**

All roles must usage-check.

```text
authorize local ownership/OWNER
→ call Workflow usage endpoint
→ unavailable -> DependencyUnavailableException
→ inUse -> ConflictException
→ short transaction
→ re-read Connection
→ delete
```

Credential cascade is handled by FK.

- [ ] **Step 5: Ensure no DB transaction wraps remote Workflow call**

The remote call must occur before the short deletion/mutation transaction.

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=ConnectionUsageProtectionTest test

git add packages/contracts/http/workflow \
        services/workspace-service
git commit -m "feat(workspace): protect referenced connections"
```

---

### Task 7: Google OAuth foundation and one-time state

**Files:**
- Create:
  - `.../application/port/out/GoogleOAuthPort.java`
  - `.../application/port/out/OAuthStateStore.java`
  - `.../application/dto/OAuthPendingState.java`
  - `.../application/dto/OAuthAuthorizationResponse.java`
  - `.../application/service/GoogleOAuthScopePolicy.java`
- Create:
  - `.../infrastructure/cache/RedisOAuthStateStore.java`
  - `.../infrastructure/provider/google/GoogleOAuthProvider.java`
  - `.../infrastructure/provider/google/GoogleConnectionProvider.java`
  - `.../infrastructure/config/GoogleOAuthProperties.java`
- Create:
  - `StartConnectionOAuthUseCase.java`
  - `CompleteConnectionOAuthUseCase.java`
- Modify: `application.properties`
- Create OAuth/state tests.

**Google configuration:**

```properties
weav.google.oauth.client-id=${GOOGLE_OAUTH_CLIENT_ID:}
weav.google.oauth.client-secret=${GOOGLE_OAUTH_CLIENT_SECRET:}
weav.google.oauth.redirect-uri=${GOOGLE_OAUTH_REDIRECT_URI:http://localhost:8080/oauth/google/callback}
weav.google.oauth.frontend-return-url=${GOOGLE_OAUTH_FRONTEND_RETURN_URL:http://localhost:3000/connections}
weav.google.oauth.state-ttl=${GOOGLE_OAUTH_STATE_TTL:PT10M}
```

Do not accept arbitrary redirect URL from API clients.

- [ ] **Step 1: Implement scope policy**

V1 scopes:

```text
GMAIL:
openid
email
https://www.googleapis.com/auth/gmail.metadata
```

This is enough to authorize/identify/test Gmail without granting send permission before a Gmail send node exists.

When a Gmail send node is introduced, expand policy on the same Connection with:

```text
https://www.googleapis.com/auth/gmail.send
```

and require re-consent.

Current V1 Google Sheets operations include read rows and append row, therefore use:

```text
openid
email
https://www.googleapis.com/auth/spreadsheets
```

Do not add broad Drive scope merely to make testing easier.

- [ ] **Step 2: Implement Redis OAuth state**

Key:

```text
workspace:oauth-state:<random-256-bit-state>
```

Value:

```json
{
  "workspaceId": "...",
  "connectionId": "...",
  "userId": "...",
  "provider": "GOOGLE_SHEETS"
}
```

TTL: 10 minutes by default.

Consume semantics must be atomic:

```text
read + delete exactly once
```

Use Redis operation/Lua/GETDEL equivalent supported by current Spring Data Redis version.

- [ ] **Step 3: Write replay/expiry tests**

```text
valid state -> returned once
second consume -> absent
expired state -> absent
wrong provider/connection -> callback rejected
```

- [ ] **Step 4: Implement StartConnectionOAuthUseCase**

```text
JWT actor
→ membership
→ manage permission
→ provider must GMAIL or GOOGLE_SHEETS
→ mark DISABLED
→ persist
→ create one-time state
→ build Google authorization URL
→ return { authorizationUrl }
```

Google authorization request uses:

```text
response_type=code
access_type=offline
include_granted_scopes=true
prompt=consent when refresh-token acquisition/re-consent requires it
```

- [ ] **Step 5: Implement callback exchange**

Callback flow:

```text
consume state
→ load Connection
→ verify workspace/provider
→ re-check current membership of state.userId
→ re-check management permission
→ exchange authorization code
→ validate granted scopes contain policy-required scopes
→ serialize/encrypt OAuth credential
→ save Credential
→ verify Google connection
→ VERIFIED     => ACTIVE
→ AUTH_INVALID => INVALID
```

Credential payload contains:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "tokenType": "Bearer",
  "grantedScopes": ["..."]
}
```

Use `Credential.expiresAt` as canonical access-token expiry.

- [ ] **Step 6: Define Google verification**

Gmail:

```text
GET Gmail users/me/profile
```

Google Sheets:

```text
validate token through Google's OAuth endpoint
+
verify required `spreadsheets` scope is granted
```

Do not request Drive scope and do not store a spreadsheet ID in Connection merely for testing.

- [ ] **Step 7: Run tests and commit**

```bash
./mvnw -Dtest=RedisOAuthStateStoreTest,GoogleOAuthProviderTest,GoogleOAuthUseCasesTest test

git add services/workspace-service
git commit -m "feat(workspace): add google oauth connection flow"
```

---

### Task 8: Runtime resolve, Google refresh, attachment authorization, and auth-failure reporting

**Files:**
- Create:
  - `.../application/dto/ResolvedConnectionCredential.java`
  - `.../application/usecase/ResolveConnectionUseCase.java`
  - `.../application/usecase/AuthorizeConnectionAttachmentUseCase.java`
  - `.../application/usecase/ReportConnectionAuthFailureUseCase.java`
- Extend: `GoogleOAuthPort.java`
- Create tests: `InternalConnectionUseCasesTest.java`

**Resolve signature:**

```java
public ResolvedConnectionCredential execute(
        UUID workspaceId,
        UUID connectionId);
```

- [ ] **Step 1: Write resolve tests**

Cases:

```text
wrong workspaceId                  -> not found
DISABLED                           -> conflict/invalid state
INVALID                            -> conflict/invalid state
missing required credential        -> invalid state
expired non-refreshable credential -> invalid
active Telegram                    -> returns token
active HTTP BASIC                  -> returns username/password
Google valid access token          -> returns access token only
Google expired access token        -> refreshes then returns new access token
```

- [ ] **Step 2: Implement minimum runtime credential response**

Examples:

```json
{
  "provider": "GMAIL",
  "authType": "OAUTH2",
  "auth": {
    "accessToken": "..."
  }
}
```

```json
{
  "provider": "TELEGRAM",
  "authType": "TOKEN",
  "auth": {
    "token": "..."
  }
}
```

Never return Google `refreshToken`.

- [ ] **Step 3: Implement Google refresh**

```text
decrypt current credential
→ expiresAt still valid -> return access token
→ expired -> call Google token endpoint using refresh token
→ receive new access token
→ preserve old refresh token if Google does not return a new one
→ encrypt updated credential
→ short DB transaction
→ save
→ return new access token
```

For V1, duplicate concurrent refresh requests are tolerated; do not add Redis locking. Last successfully encrypted valid token wins.

- [ ] **Step 4: Implement attachment authorization**

```java
public void execute(
        UUID userId,
        UUID workspaceId,
        UUID connectionId);
```

Require:

```text
Connection belongs to workspace
user is member
OWNER OR connection.createdBy == userId
```

Do not require Connection to be currently ACTIVE when editing a workflow; runtime resolve enforces ACTIVE.

- [ ] **Step 5: Implement auth-failure reporting**

Only confirmed auth failures call:

```java
connection.markInvalid();
```

Endpoint payload later supports only:

```text
AUTHENTICATION_REJECTED
```

Do not support arbitrary provider error bodies.

- [ ] **Step 6: Run and commit**

```bash
./mvnw -Dtest=InternalConnectionUseCasesTest test

git add services/workspace-service
git commit -m "feat(workspace): resolve runtime connection credentials"
```

---

### Task 9: Public and internal HTTP APIs + OpenAPI contract

**Files:**
- Modify: `packages/contracts/http/workspace/openapi.yaml`
- Modify: `packages/contracts/http/workspace/README.md`
- Create:
  - `.../presentation/http/ConnectionController.java`
  - `.../presentation/http/InternalConnectionController.java`
  - `.../presentation/http/GoogleOAuthCallbackController.java`
- Create request records:
  - `CreateConnectionRequest.java`
  - `UpdateConnectionRequest.java`
  - `SaveCredentialRequest.java`
  - `ReportConnectionAuthFailureRequest.java`
- Create response records:
  - `OAuthAuthorizationHttpResponse.java`
  - `ResolvedConnectionHttpResponse.java`
- Modify:
  - `.../infrastructure/security/SecurityConfig.java`
  - `services/workspace-service/src/test/java/com/weav/workspace/SecurityConfigTest.java`
  - `WorkspaceContractValidationTest.java`
- Create controller integration tests.

**Public endpoints:**

```text
POST   /workspaces/{workspaceId}/connections
GET    /workspaces/{workspaceId}/connections
GET    /workspaces/{workspaceId}/connections/{connectionId}
PATCH  /workspaces/{workspaceId}/connections/{connectionId}
DELETE /workspaces/{workspaceId}/connections/{connectionId}

PUT    /workspaces/{workspaceId}/connections/{connectionId}/credential
DELETE /workspaces/{workspaceId}/connections/{connectionId}/credential

POST   /workspaces/{workspaceId}/connections/{connectionId}/test
POST   /workspaces/{workspaceId}/connections/{connectionId}/disable

POST   /workspaces/{workspaceId}/connections/{connectionId}/oauth/authorize

GET    /oauth/google/callback
```

The explicit `/disable` route is required to expose the already-approved manual-disable lifecycle without allowing clients to set arbitrary status values.

**Internal endpoints:**

```text
POST /internal/workspaces/{workspaceId}/connections/{connectionId}/authorize-attachment

POST /internal/workspaces/{workspaceId}/connections/{connectionId}/resolve

POST /internal/workspaces/{workspaceId}/connections/{connectionId}/auth-failure
```

- [ ] **Step 1: Extend OpenAPI first**

Public `ConnectionResponse` documents that:

```text
config may be null when caller may only see metadata
credential secret is never exposed
credentialExpiresAt is safe metadata
```

- [ ] **Step 2: Add controllers**

Controllers only:

```text
parse HTTP input
extract JwtActor
call use case
map result
```

No authorization logic in controller.

- [ ] **Step 3: Configure security**

Rules:

```text
/oauth/google/callback -> permitAll

/internal/** -> internal-service-key filter/security chain

/workspaces/** -> authenticated JWT
```

OAuth start remains JWT-protected.

- [ ] **Step 4: Implement callback redirect**

Success:

```text
302 <configured-frontend-return-url>?connectionId=<id>&oauth=success
```

Failure:

```text
302 <configured-frontend-return-url>?connectionId=<id>&oauth=failed&reason=<safe-code>
```

Safe failure codes only:

```text
state_invalid
authorization_denied
authorization_changed
token_exchange_failed
verification_failed
```

Never include Google error detail, authorization code, access token or refresh token in URL.

- [ ] **Step 5: Write security/contract tests**

Verify:

```text
callback succeeds through security chain without JWT
oauth authorize requires JWT
internal resolve rejects missing/wrong internal key
public endpoints reject internal key as user authentication
OpenAPI contains all Connection routes
```

- [ ] **Step 6: Run tests and commit**

```bash
./mvnw -Dtest=SecurityConfigTest,WorkspaceContractValidationTest,ConnectionControllerTest,InternalConnectionControllerTest,GoogleOAuthCallbackControllerTest test

git add packages/contracts/http/workspace \
        services/workspace-service
git commit -m "feat(workspace): expose connection and credential APIs"
```

---

### Task 10: End-to-end security regression and documentation

**Files:**
- Create: `services/workspace-service/src/test/java/com/weav/workspace/ConnectionEndToEndTest.java`
- Create: `services/workspace-service/src/test/java/com/weav/workspace/CredentialSecretRegressionTest.java`
- Modify: `services/workspace-service/README.md`
- Modify environment/documentation examples as applicable.

- [ ] **Step 1: Add end-to-end Telegram/manual credential scenario**

```text
create Connection
→ DISABLED

save Credential
→ DISABLED

test
→ provider mock returns success
→ ACTIVE

internal resolve
→ returns runtime token

replace Credential
→ DISABLED
```

- [ ] **Step 2: Add Google OAuth scenario**

Using provider mock/stub:

```text
create GOOGLE_SHEETS Connection
→ start OAuth
→ state stored
→ callback exchange
→ credential encrypted
→ verification succeeds
→ ACTIVE
→ callback redirects success
→ state replay fails
→ resolve returns access token only
```

- [ ] **Step 3: Add usage protection E2E**

```text
Workflow usage mock = true

MEMBER update own Connection -> 409
OWNER rotate credential      -> allowed
DELETE                        -> 409

Workflow unavailable
DELETE/mutation requiring check -> 503
```

- [ ] **Step 4: Add secret regression assertions**

Serialize/log/error paths and assert output does not contain seeded secrets:

```text
telegram-secret-123
http-password-123
google-access-secret
google-refresh-secret
```

Also inspect Redis OAuth state and confirm none appear there.

- [ ] **Step 5: Update README**

Replace Connection/Credential "deferred" wording with implemented V1 behavior.

Document environment variables:

```text
CREDENTIAL_ENCRYPTION_KEY
CREDENTIAL_ENCRYPTION_KEY_VERSION

GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_OAUTH_FRONTEND_RETURN_URL

WORKFLOW_SERVICE_URL
WORKFLOW_INTERNAL_SERVICE_KEY
```

Document status semantics:

```text
DISABLED = configured/incomplete/unverified/manually disabled
ACTIVE   = verified and usable
INVALID  = known-bad authentication
```

- [ ] **Step 6: Run complete Workspace test suite**

```bash
cd services/workspace-service
./mvnw test
```

Expected:

```text
all existing Workspace Core tests remain green
all Connection/Credential tests green
```

- [ ] **Step 7: Validate contract and migration from clean DB**

Run test suite with fresh Testcontainers PostgreSQL/Redis to guarantee V1 -> V2 -> V3 migration works from zero.

- [ ] **Step 8: Final commit**

```bash
git add services/workspace-service \
        packages/contracts/http/workspace \
        packages/contracts/http/workflow

git commit -m "feat(workspace): complete connection and credential v1"
```

---

# Recommended Implementation Order

```text
Task 1  Domain rules
   ↓
Task 2  Persistence
   ↓
Task 3  Connection CRUD
   ↓
Task 4  Credential crypto
   ↓
Task 5  Telegram + HTTP test
   ↓
Task 6  Workflow usage protection
   ↓
Task 7  Google OAuth
   ↓
Task 8  Runtime resolve/internal flows
   ↓
Task 9  HTTP/OpenAPI/security
   ↓
Task 10 E2E + docs + full regression
```

This order deliberately gets a working manual Connection flow before Google OAuth is introduced.

A useful checkpoint after **Task 6** is:

```text
Telegram + HTTP Connection/Credential V1 works end-to-end
+
workflow usage protection exists
```

Google OAuth can then be implemented without destabilizing core Connection behavior.

# Definition of Done

Workspace Service V1 is complete when all of the following are true:

```text
Connection CRUD works.
Connection name uniqueness is enforced by normalized DB constraint.
Provider/auth combinations are enforced.
Credential secrets are AES-256-GCM encrypted.
Public APIs never expose credential secrets.
Telegram can save/test/resolve TOKEN credentials.
HTTP NONE/API_KEY/TOKEN/BASIC can validate/test/resolve credentials.
HTTP outbound test has SSRF protections.
Google Gmail/Sheets OAuth authorization flow works.
OAuth state is one-time and expiring.
Google refresh tokens never leave Workspace.
Expired Google access tokens can refresh during resolve.
Connection lifecycle follows DISABLED/ACTIVE/INVALID rules.
OWNER/MEMBER management rules are enforced.
MEMBER cannot mutate referenced Connection.
OWNER can rotate referenced Connection.
Referenced Connection cannot be deleted.
Workflow outage fails closed for protected mutations.
Workflow can authorize connection attachment through Workspace.
Worker can resolve minimum runtime auth.
Worker can report confirmed auth failure.
Transient provider failure does not incorrectly mark INVALID.
Existing Workspace Core tests remain green.
README/OpenAPI reflect implemented behavior.
```

# Explicitly Not Included

```text
Workspace delete/archive
invitations
ownership transfer
custom roles / generic RBAC
shared OAuth grants between Gmail and Sheets
KMS/per-workspace encryption keys
generic provider plugin framework
HTTP API key query-string injection
automatic force-detach of Connections from workflows
secret caching
full provider execution proxying through Workspace Service
```
