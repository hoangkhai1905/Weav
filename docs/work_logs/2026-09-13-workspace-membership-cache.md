# Workspace Membership and Authorization Cache — 2026-09-13

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-13` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu session | `feature/workspace-service` / `de25043` |
| Người thực hiện | `Workspace membership/cache worker (Luna MAX)` |
| Người review / nhận bàn giao | `Coordinator /root` |
| Trạng thái cuối session | `Hoàn thành implementation; chờ coordinator review` |
| Phạm vi session | `Workspace Service Tasks 6–7 only` |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-12-workspace-core.md` |

## 2. Scope and acceptance

- Task 6: membership add/list/update/remove/leave application behavior,
  Identity-enriched paging, typed errors, exact duplicate-constraint mapping,
  and focused PostgreSQL tests.
- Task 7: domain-specific authorization cache port, JSON StringRedisTemplate
  adapter, cache-aside access resolution, after-commit invalidation, Valkey
  tests, and graceful PostgreSQL fallback.
- Tasks 8+ and unrelated Identity, Connection, Credential, workflow, delete,
  archive, invitation, and ownership-transfer behavior are out of scope.

## 3. Initial findings and decisions

- Existing `Membership`, `MembershipRepository`, `MemberListQuery`,
  `PageResult`, `IdentityDirectoryPort`, and `WorkspaceAuthorizationPolicy`
  already provide the domain seams needed by Tasks 6–7.
- `WorkspaceAccessSnapshot` will live in `domain.model` so the domain cache
  port does not depend on application DTOs. This is a minor location choice
  required by the repository's architecture rule against domain-to-application
  dependencies.
- Membership profile enrichment will omit a membership from the returned item
  list when Identity returns no summary for that page ID, while preserving the
  authoritative membership page totals. This avoids inventing profile data or
  leaking an outside user; the behavior is covered and documented.
- Mutation cache invalidation will register an after-commit action. Redis
  failures are logged with IDs only and never roll back a committed PostgreSQL
  mutation.
- A resolver read/fill racing an after-commit eviction can repopulate a stale
  snapshot. The V1 design provides bounded TTL plus defensive eviction but no
  distributed version token; this residual staleness/security tradeoff is
  explicitly recorded for coordinator review rather than hidden.

## 4. GitNexus pre-edit evidence

The repository was bound as `Weav (T:\Weav)`; the MCP index reports one commit
behind `HEAD` and remains incompatible with the installed LadybugDB reader
(stored version 43, current version 42). The documented local CLI refresh was
attempted with `GITNEXUS_MEMORY=off`; the sandbox first returned Windows
`EPERM` resolving `C:\Users\nhoan`, and the elevated rerun completed without
updating the separately installed MCP index. CLI upstream impact attempts for
`MembershipRepositoryAdapter`, `WorkspaceApplicationConfig`, and
`SpringTransactionRunner` returned `UNKNOWN`/degraded or the storage-version
mismatch. Targeted source search confirmed the existing adapter/configuration
call sites before edits. No HIGH/CRITICAL impact was reported; UNKNOWN remains
an explicit review concern.

## 5. GitNexus and TDD evidence

### Red

The first focused `MembershipUseCasesTest` run was intentionally started before
implementation. Test compilation failed on the missing Task 6/7 commands,
cache port, resolver, and after-commit seam. This established the red baseline
before production implementation.

The first real PostgreSQL/Valkey run also exposed a production defect: the
void-shaped remove/leave use cases returned `null` through the shared
`TransactionRunner`, whose contract rejects null results. The focused test
reported `NullPointerException: transaction result must not be null`; the
use-cases now return a non-null success marker inside the transaction while
retaining their void public API.

### Green

Focused command from `services/workspace-service`:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -Dtest=MembershipUseCasesTest,MembershipRepositoryAdapterIntegrationTest,MembershipCacheInvalidationIntegrationTest,RedisWorkspaceAuthorizationCacheIntegrationTest test"
```

Result: 19 tests passed, 0 failures/errors. A second resolver-focused run
(`WorkspaceAccessResolverTest,MembershipUseCasesTest`) passed 12/12.

Real PostgreSQL/Flyway + Valkey evidence includes concurrent duplicate
membership inserts (one success, one `USER_ALREADY_MEMBER`), unrelated
membership foreign-key failure remaining `DataIntegrityViolationException`,
permission update eviction, remove/leave eviction, rollback without
after-commit action, cache eviction failure without database rollback, cache
round-trip, exact TTL expiry, and malformed/duplicate/mismatched payload misses.

The full module command was the same Maven invocation with `test` and no
`-Dtest` selector. Final result after adding the real outage regression:
**90 tests passed, 0 failures/errors/skips**.
`WorkspaceUseCasePersistenceIntegrationTest` was rerun independently at 5/5
after its old duplicate-membership fixture was changed to an unrelated
foreign-key failure, matching the exact constraint translator contract.

## 6. Changes

- Task 6 application: `AddMemberUseCase`, `ListMembersUseCase`,
  `UpdateMemberPermissionsUseCase`, `RemoveMemberUseCase`,
  `LeaveWorkspaceUseCase`, membership command/view records, typed user/owner
  errors, local Identity email normalization, candidate-only search and
  Identity/workspace-owned paging joins.
- Task 6 persistence: exact Hibernate constraint translation in
  `MembershipPersistenceExceptionTranslator`, wired through
  `MembershipRepositoryAdapter`; the existing Task4 integrity fixture now
  uses an unrelated FK violation so exact duplicate membership translation is
  tested independently.
- Task 7 domain/application: `WorkspaceAccessSnapshot`, domain-specific
  `WorkspaceAuthorizationCache`, `ResolveWorkspaceAccessUseCase`, and
  `AfterCommitExecutor`.
- Task 7 infrastructure: `RedisWorkspaceAuthorizationCache` uses
  `StringRedisTemplate` plus explicit JSON and exact keys
  `workspace:authz:{workspaceId}:{userId}`; positive configurable TTL defaults
  to `PT5M`; `SpringAfterCommitExecutor` registers invalidation only after
  commit and swallows/logs cache failures without rolling back the mutation.
- Tests: new membership/use-case, resolver, PostgreSQL concurrency/FK, and
  Valkey/cache invalidation integration coverage.
- No Task 8+ endpoint/security implementation, commit, push, live database,
  or secret access was performed.

## 7. Verification and handoff

- `git diff --check`: passed.
- Full Workspace Maven/Testcontainers suite: 90/90 passed.
- A separate real outage integration test stopped its Valkey container and
  proved resolver read/write failures fall back to the authoritative
  PostgreSQL membership and still return access: 1/1 passed.
  Its focused command used `-Dtest=MembershipCacheOutageIntegrationTest`.
- No commit or push was performed; changes remain reviewable for `/root`.
- Graph change detection was attempted after implementation with
  `node .gitnexus/run.cjs detect-changes --scope all --repo .`, but the local
  index reader rejected stored LadybugDB version 43 with installed reader
  version 42. Upstream impact attempts for edited existing symbols likewise
  returned `UNKNOWN`; targeted source searches corroborated callers and no
  HIGH/CRITICAL result was reported. The documented refresh attempt with
  `GITNEXUS_MEMORY=off` did not repair the separately installed MCP index.
- Coordinator review item: the resolver can refill a stale authorization
  snapshot after a concurrent post-commit eviction. This was corrected in the
  follow-up below with a Redis generation fencing token and atomic rotate/delete
  script; the configured TTL remains the recovery bound when Redis is down.

## 8. Correction pass — coordinator and membership-review findings — 2026-09-13

### GitNexus and source corroboration

Required upstream checks were attempted sequentially before editing
`ResolveWorkspaceAccessUseCase`, `RedisWorkspaceAuthorizationCache`,
`WorkspaceAuthorizationCache`, `GlobalExceptionHandler`, `MembershipRepository`,
`SpringDataMembershipRepository`, `MembershipRepositoryAdapter`,
`UpdateMemberPermissionsUseCase`, `RemoveMemberUseCase`, `LeaveWorkspaceUseCase`,
and `MemberView`. Each CLI result was `UNKNOWN` because the persisted index uses
LadybugDB storage version 43 while the installed reader uses version 42. Targeted
`rg`/source inspection corroborated all callers and implementations; no
HIGH/CRITICAL impact result was reported. No index deletion, global repair, or
tool installation was attempted.

### Red/green correction evidence

The first barrier regression for concurrent permission update reached the real
PostgreSQL path and exposed an incorrect test seam that still delegated through
detached `saveAndFlush`; it produced Hibernate
`ObjectOptimisticLockingFailureException`. After the seam delegated the new
conditional update port, the focused race passed. A second real concurrent
remove/remove regression then reproduced the same untyped optimistic-lock
failure from Spring Data JPA `deleteById`; the adapter now flushes inside its
boundary and translates a zero-row optimistic delete to stable
`RESOURCE_NOT_FOUND`.

Focused rerun from `services/workspace-service`:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -Dtest=MembershipCacheInvalidationIntegrationTest,MembershipUseCasesTest,GlobalExceptionHandlerTest test"
```

Result: **22 tests passed, 0 failures/errors/skips**, including real
PostgreSQL/Flyway + Valkey tests for ambient rollback, permission-update and
leave stale-fill fencing, concurrent update/remove no-resurrection, and
concurrent remove/remove stable not-found behavior. `GlobalExceptionHandlerTest`
also proves `USER_NOT_FOUND` maps to HTTP 404 as required by the add-member
contract. The earlier cache-specific run passed 12/12, including Redis
generation rotation and payload fencing.

### Corrections and reviewer dispositions

- Resolver cache fills now capture a Redis generation before the authoritative
  read, publish only in an after-commit callback, and use an atomic Lua compare
  and set. Mutation eviction atomically rotates the generation and deletes the
  payload. An old read therefore cannot repopulate a usable snapshot after a
  healthy post-commit update/remove/leave. Cache outage remains fail-open to
  PostgreSQL for reads and cannot roll back mutations; stale recovery is bounded
  by the configured `PT5M` TTL when invalidation cannot reach Redis.
- `WorkspaceAuthorizationCache` exposes generation operations as required port
  methods rather than an unsafe default fallback, so every adapter must honor
  fencing semantics. Redis payloads carry the generation and reject missing,
  mismatched, malformed, or unauthorized shapes.
- The confirmed detached-membership update race is handled by an additive
  conditional JPQL update (`WHERE id = :id`) followed by a fresh read. A deleted
  row returns stable `RESOURCE_NOT_FOUND` and cannot be reinserted by merge.
- The confirmed concurrent delete race is handled by flushing the repository
  delete inside the adapter and translating Hibernate's zero-row optimistic
  failure to `RESOURCE_NOT_FOUND`. Spring Data JPA 4.1's `deleteById` itself is
  otherwise optional/idempotent when a row is already absent; sequential
  non-member calls still fail at the use-case membership check.
- `UserNotFoundException` now maps to HTTP 404, matching the OpenAPI add-member
  response. `MemberView` no longer exposes the uncontracted `membershipId`
  property while `additionalProperties: false` remains valid.
- `UpdateMemberPermissionsUseCase` continues to return the domain `Membership`
  for Task 8's presentation mapping; it does not call Identity or widen Task 6
  into a public controller. Task 8 must map that result to the contract's
  enriched `MemberView`. The broader ListMembers transaction/Identity-call
  boundary was reviewed and left unchanged as an out-of-scope redesign.

No commit or push was made. Coordinator review remains pending.

## 9. Final verification after correction pass

The complete Workspace module command from `services/workspace-service` was
rerun after all cache, membership-race, handler, and DTO corrections:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never test"
```

Final result: **97 tests passed, 0 failures/errors/skips**, including Flyway
V1/V2 PostgreSQL Testcontainers, Valkey Testcontainers, Redis outage fallback,
cache TTL/payload fencing, and the concurrent membership regressions.
`git diff --check` passed with only the existing CRLF normalization notice.
The worktree remains uncommitted for coordinator review.

## 10. Cache payload fixture correction — 2026-09-13

The final coordinator review found that the original malformed/duplicate/
mismatched payload test wrote only the payload key. Because the cache adapter
requires a generation key before it parses or validates the payload, those
assertions could stop at the missing-generation guard. The test now seeds a
matching generation and an otherwise valid member payload for each payload
validation case. Separate tests cover malformed JSON, mismatched workspace or
user IDs, duplicate capabilities, and invalid authorization capabilities.
Missing-generation and mismatched-generation cases remain explicit separate
tests, and the existing rotated-generation fence remains covered.

The required GitNexus upstream impact attempt was made against
`RedisWorkspaceAuthorizationCacheIntegrationTest` and
`RedisWorkspaceAuthorizationCache` in repository `Weav`. Both targets were
not present in the indexed commit (`de25043`) because the cache implementation
is part of the staged Tasks 6–7 batch; the tool returned `UNKNOWN/not found`.
Targeted source inspection confirmed the test-only scope and the adapter's
generation/shape/schema guards. No index refresh was started because the
coordinator's refresh was already running, and no production file changed.

Focused real Valkey/Testcontainers command:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -Dtest=RedisWorkspaceAuthorizationCacheIntegrationTest test"
```

Result: **9 tests passed, 0 failures/errors/skips**. Changes are limited to
the cache integration test and this work-log append; they remain unstaged for
coordinator review.

## 11. Coordinator acceptance

Reviewed generation fencing, after-commit publication, conditional membership
updates, concurrent deletion translation, and member DTO/status contracts.
Independent Maven reruns passed 25/25 (MembershipCacheInvalidationIntegrationTest,
MembershipUseCasesTest, GlobalExceptionHandlerTest, WorkspaceAccessResolverTest)
and then 9/9 corrected RedisWorkspaceAuthorizationCacheIntegrationTest cases,
using real PostgreSQL/Valkey Testcontainers. Worker full suite previously passed
97/97 before the final test-only expansion. No production changes followed it.

GitNexus 1.6.12 index-only refresh succeeded. Complete LocalBackend detect_changes
(scope all, repo T:/Weav) returned 249 symbols, 38 files, 3 affected processes,
medium risk, partial=false and truncated=false. Reviewed delete/constraint/error
and email-normalization flows. Index construction still reports bounded flow
enumeration and Java attribution gaps; source review and runtime tests supplement
those limits, and missing flows are not evidence of no impact. Earlier worker
storage-reader mismatch is superseded by this successful local CLI analysis.
Both staged and unstaged diff whitespace checks passed.

Tasks 6-7 accepted for a local milestone commit. Remaining designed limitation:
failed Redis invalidation can retain prior access until the configured five-minute
TTL expires. Task 8 must enrich the permission-update HTTP MemberView; public JWT
controllers and internal-key authorization endpoint remain the next batch.
