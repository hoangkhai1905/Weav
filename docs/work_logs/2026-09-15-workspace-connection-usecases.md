# Work log - 2026-09-15

## 1. Metadata

| Field | Value |
| --- | --- |
| Work date | `2026-09-15` |
| Time zone | `Asia/Saigon` |
| Repository | `Weav` (`T:\Weav`) |
| Branch / starting commit | `feature/workspace-service` / `b1154a8` |
| Worker | Workspace Connection CRUD application worker |
| Reviewer / handoff | `/root` coordinator |
| Final status | Task 3 implementation complete; waiting for coordinator review |
| Scope | Connection CRUD DTOs, view assembly, use cases, config boundary, typed persistence translation, and Spring-wired PostgreSQL verification |
| Related plan | `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, Task 3 lines 553-692 |

## 2. Executive summary

### Results

- Added secret-safe `ConnectionResponse`, create/update commands, and a `ConnectionViewAssembler` that applies the accepted OWNER/creator-MEMBER/other-MEMBER visibility matrix.
- Added transactional Create/Get/List/Update/Disable use cases with workspace-scoped membership and connection lookups, provider/auth validation, normalized-name conflict handling, local authorization, and idempotent disable.
- Added a bounded config safety boundary that rejects known credential fields, authorization/cookie header material, and URL user-info without exposing rejected values. It explicitly does not claim to detect arbitrary secrets; provider-specific config validation, credential crypto, provider calls, OAuth, and Workflow usage protection remain later tasks.
- Moved normalized-name conflict translation behind the persistence adapter using the established typed Hibernate constraint pattern. The forced same-transaction collision test is documented as adapter translation coverage, not as a concurrent-race test.
- Added a Spring-injected PostgreSQL flow that persists create/get/list/update/disable operations and verifies OWNER, creator MEMBER, and other MEMBER visibility plus denied mutation readback after transaction completion.

### Quick status

| Area | Status | Evidence |
| --- | --- | --- |
| Compile | `PASS` | Workspace Service Maven compile; 123 source files |
| Focused tests | `PASS` | Comprehensive 26/26 plus final post-refinement application/infrastructure rerun 16/16; zero failures/errors/skips |
| Full Workspace regression | `PASS` | 179/179; zero failures/errors/skips; PostgreSQL, Flyway, Valkey, HTTP/security paths exercised |
| Migration/database | `PASS` | Existing V3 migration and persistence/migration tests remained green; no migration changed in Task 3 |
| Health check | `Not run` | No endpoint/controller is in Task 3 scope |
| Diff review | `Checked` | Targeted source review and `git diff --check` passed |
| Commit/PR | `Not created` | Coordinator instructed no commit or push |

## 3. Scope and acceptance

### In scope

- `ConnectionResponse`, `CreateConnectionCommand`, `UpdateConnectionCommand`.
- `ConnectionViewAssembler` and five application use cases: create, get, list, update, disable.
- Application-level config safety rejection and typed normalized-name conflict translation in the persistence adapter.
- Spring bean wiring for the accepted Task 1 policies and the new config safety policy.
- Focused use-case unit tests, typed translator tests, PostgreSQL/Testcontainers persistence checks, and a Spring-wired CRUD integration flow.

### Out of scope

- Delete and Workflow usage checks.
- Credential encryption, manual credential lifecycle, provider HTTP/network calls, Telegram/Google OAuth, controllers, internal endpoints, and generic RBAC.
- Live migration, branch/worktree creation, commit, push, and changes to the user-provided untracked plan.

### Acceptance covered

- New connections are created through `Connection.createNew` and start `DISABLED`.
- Membership is required for every operation; repository lookups are workspace-scoped.
- Provider/auth combinations use the accepted Task 1 policy and invalid combinations become `BadRequestException`.
- OWNER can manage any same-workspace connection; a MEMBER can manage/attach/view config only for a connection they created. Other members receive metadata with `config == null` and cannot manage or attach.
- Update has only name/config fields. Name-only changes preserve status; changed config disables the connection; disabling an already disabled connection performs no second save.
- Responses expose credential presence/expiry metadata only. They contain no credential ID, encrypted payload, key version, or plaintext credential fields.
- Duplicate normalized names are checked before save and a matching V3 database constraint is translated by the adapter after save; unrelated runtime errors and messages that merely mention the index are preserved.
- Known auth/cookie headers and URL user-info are rejected on create and update; rejected updates save nothing and leave the existing connection unchanged.

## 4. Technical decisions

| Decision | Evidence / reason | Consequence |
| --- | --- | --- |
| Keep provider/auth out of `UpdateConnectionCommand` | Plan declares both immutable and lists only `name` and `config` in PATCH | Controllers cannot request an in-place provider/auth change through this use case |
| Treat `null` config in an update command as omitted; an empty map as replacement | Existing Java command convention and explicit partial-update distinction | Config is only replaced and status disabled when the supplied value differs |
| Keep config validation narrow | Task 5 owns provider-specific `validateConfig`; Task 3 global rule only says config has no secret | The policy rejects known credential keys, auth/cookie header material, and URL user-info recursively, while allowing nonsecret metadata such as `baseUrl`, `testPath`, and `apiKeyHeaderName`; arbitrary secret detection is not claimed |
| Translate the normalized-name constraint in the persistence adapter | Existing Workspace adapters use typed Hibernate `ConstraintViolationException#getConstraintName` translation | CRUD use cases remain free of database index names and unrelated DB/runtime errors propagate unchanged |
| Register Task 1 policies and the config policy in `WorkspaceApplicationConfig` | The policies are plain final classes and Task 3 requires Spring wiring | Spring Boot can construct all new use cases using the same transaction boundary |
| `Map.copyOf` is used only for top-level defensive copies | Java map copy is shallow | Nested config values are not claimed to be deeply immutable; no unrelated deep-copy redesign was introduced |
| Treat the existing collision test as forced same-transaction coverage | The test intentionally inserts a duplicate through a mock repository path in one transaction | It verifies typed adapter translation; it is not evidence of concurrent interleaving or race handling |

## 5. GitNexus and upstream impact

Before editing existing symbols, GitNexus was bound to repository `Weav` at `T:\Weav`, indexed at `b1154a8` on `feature/workspace-service`.

- `Connection` class upstream impact reported `CRITICAL`, with 421 impacted entries, one direct caller, 130 processes, and same-name/cross-language noise. This was treated as a warning, not an all-clear.
- Newly added/accepted connection ports, policies, and the application configuration symbol returned `UNKNOWN` or no useful callers in the stale base index. Targeted source search corroborated the current Workspace Java callers before edits.
- `WorkspacePersistenceExceptionTranslator` and `MembershipPersistenceExceptionTranslator` both reported `LOW` risk with one direct caller and provided the typed Hibernate pattern reused by `ConnectionPersistenceExceptionTranslator`.
- `WorkspaceApplicationConfig` reported `UNKNOWN` with no resolved callers; targeted source search confirmed it is the Spring `@Configuration` bean registry. The new connection adapter/policy/use-case symbols were absent from the stale base index (`UNKNOWN`).
- The GitNexus rename preview for the unindexed `ConnectionNameConflictTranslator` returned `Symbol ... not found`; the old new-file symbol was then removed and the typed infrastructure translator was added explicitly. No indexed symbol was silently renamed by text replacement.
- No commit was made, so staged `detect_changes --scope all` remains a coordinator pre-commit step and must include all untracked Task 3 files.

## 6. Coordinator review findings and rulings - 2026-09-15

The coordinator independently reran the original Task 3 focus before these corrections: `ConnectionUseCasesTest` plus `ConnectionUseCasesPersistenceIntegrationTest` passed `10/10` (9 unit, 1 integration), with `git diff --check` clean. That baseline did not cover the concrete config boundary cases, typed adapter ownership, or Spring-wired CRUD persistence flow required by the review.

Findings and resolutions:

1. **Config boundary was too broad in its claim.** The former key blacklist accepted `headers.Authorization`, `Cookie` header descriptors, and URL user-info. `ConnectionConfigPolicy` now rejects those forms recursively, including nested header maps/lists and `https://user:password@host` user-info, before create or update persistence. The policy keeps nonsecret metadata (`baseUrl`, `testPath`, `apiKeyHeaderName`, provider metadata) valid and documents that arbitrary secret detection is impossible. Tests verify bad create config never saves and bad update config leaves name/status/config/updatedAt unchanged; messages do not echo fixture values.
2. **Conflict translation belonged in infrastructure.** The former application message-substring translator was removed. `ConnectionPersistenceExceptionTranslator` now matches only a typed Hibernate `ConstraintViolationException` with the exact constraint name in `ConnectionRepositoryAdapter`; text-only mentions and unrelated typed constraints propagate unchanged. The accepted persistence assertion was updated to the resulting domain conflict because this adapter ownership is the requested contract.
3. **Wiring evidence was insufficient.** The prior integration test manually constructed the create use case and forced duplicate inserts in one transaction. It is now named and documented as same-transaction translation coverage, while a separate test method uses Spring-injected Create/Get/List/Update/Disable beans with PostgreSQL and verifies role visibility, lifecycle/config transitions, transaction-complete readback, and denied mutation preservation. No concurrent-race claim is made.

## 7. Files added or changed by Task 3

| Type | Path | Change |
| --- | --- | --- |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/ConnectionResponse.java` | Secret-safe response record and visibility-safe config field |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/CreateConnectionCommand.java` | Create input record |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/UpdateConnectionCommand.java` | Partial name/config update input with omitted-field helpers |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionConfigPolicy.java` | Recursive credential-field rejection boundary |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/ConnectionPersistenceExceptionTranslator.java` | Typed V3 normalized-name constraint translation |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionViewAssembler.java` | Membership-aware response assembly |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CreateConnectionUseCase.java` | Create flow |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/GetConnectionUseCase.java` | Scoped single-connection read |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ListConnectionsUseCase.java` | Scoped connection list |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/UpdateConnectionUseCase.java` | Name/config mutation flow |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/DisableConnectionUseCase.java` | Authorized idempotent manual disable |
| Add | `services/workspace-service/src/main/java/com/weav/workspace/domain/exception/ConnectionNameAlreadyExistsException.java` | Domain conflict for normalized duplicate names |
| Modify | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/config/WorkspaceApplicationConfig.java` | Registers connection policies for Spring DI |
| Add | `services/workspace-service/src/test/java/com/weav/workspace/application/usecase/ConnectionUseCasesTest.java` | Focused CRUD behavior and secret-safe response tests |
| Add | `services/workspace-service/src/test/java/com/weav/workspace/application/usecase/ConnectionUseCasesPersistenceIntegrationTest.java` | Forced same-transaction translation and Spring-wired PostgreSQL CRUD flow |
| Add | `services/workspace-service/src/test/java/com/weav/workspace/infrastructure/persistence/ConnectionPersistenceExceptionTranslatorTest.java` | Typed-only translation and unrelated-error propagation tests |
| Modify | `services/workspace-service/src/test/java/com/weav/workspace/ConnectionPersistenceTest.java` | Repository duplicate now expects the domain conflict produced by the adapter |

The accepted Task 1/Task 2 files, migration, work logs, and user-provided plan remain in the shared uncommitted worktree. The only prior Task 2 test assertion changed was the duplicate-name expected exception, which is required by the requested adapter-owned translation. No unrelated file was deleted or reset.

## 8. Verification evidence

The following commands were run from `T:\Weav\services\workspace-service` with the installed Maven executable and local cache below. `JAVA_TOOL_OPTIONS` sets UTC for deterministic test timestamps.

Maven executable:

```text
C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd
```

Maven cache:

```text
C:\Users\nhoan\.m2\repository
```

Compile:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -DskipTests compile"
```

Result: `PASS`, 123 source files.

Focused CRUD, persistence translation, persistence, and migration tests:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -Dtest=ConnectionUseCasesTest,ConnectionUseCasesPersistenceIntegrationTest,ConnectionPersistenceExceptionTranslatorTest,ConnectionPersistenceTest,ConnectionMigrationTest test"
```

Result: `PASS`, 26/26, zero failures/errors/skips. The run used Docker/Testcontainers PostgreSQL and applied the real V3 migration. Breakdown: 11 CRUD unit, 2 CRUD integration, 3 typed translator, 9 persistence, 1 migration. After the final test-only naming/coverage refinement, the focused application/infrastructure selector (`ConnectionUseCasesTest,ConnectionUseCasesPersistenceIntegrationTest,ConnectionPersistenceExceptionTranslatorTest`) passed `16/16` at `2026-09-15T04:23:17Z`.

Full Workspace regression:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never test"
```

Result: `PASS`, 179/179, zero failures/errors/skips. The final post-refinement run completed at `2026-09-15T04:24:25Z`.

Static checks:

```text
git diff --check
```

Result: `PASS`. No commit or push was performed.

## 9. Risks, limitations, and blockers

| Level | Item | Current handling / owner |
| --- | --- | --- |
| Medium | GitNexus `Connection` impact is `CRITICAL` and noisy; new symbols were `UNKNOWN` in the base index | Source search and full tests corroborate the bounded change; `/root` must review and run staged change detection before any commit |
| Low | Config safety rejects known credential forms but cannot prove arbitrary metadata contains no secret | Task 5 provider strategies own provider-specific shape validation; later API/credential work must keep secrets out of config |
| Low | MEMBER usage-dependent mutation protection is not present | Task 6 must add the Workflow usage port and fail-closed guard before exposing mutation endpoints |
| Low | No public HTTP endpoint or real authenticated browser flow exists in this task | Controller/security/browser validation belongs to later tasks |

No blocker remains for coordinator review. The exact setup error `helper_unknown_error: setup refresh had errors` did not occur.

## 10. Handoff

1. Read this log and the Task 3 section of the agent-ready plan.
2. Review the new use cases, DTOs, config policy, and response assembler against the accepted Task 1/Task 2 contracts.
3. Run GitNexus staged `detect_changes --scope all` before any commit, with all untracked files visible.
4. Keep the user-provided plan unchanged and preserve all accepted uncommitted work.

Coordinator review is required; this worker does not claim acceptance.

## 11. Session end

| Field | Value |
| --- | --- |
| Stopped | `2026-09-15 11:25 Asia/Saigon` |
| Worktree | Uncommitted changes retained; user plan preserved |
| Commit/PR | Not created |
| Log owner | Workspace Connection CRUD application worker |
| Read first next time | This log, Task 3 plan section, `git status`, and Task 1/Task 2 logs |

## Checklist

- [x] Scope, completed behavior, and out-of-scope work are explicit.
- [x] Decisions and remaining limitations are recorded.
- [x] Changed files and reproducible commands are listed.
- [x] Focused and full test counts are recorded.
- [x] No secret, token, connection string, or generated output is recorded.
- [x] Worktree/commit status is accurate; no commit or push was performed.

## Coordinator acceptance - 2026-09-15

Reviewed config rejection corrections, infrastructure-only typed constraint translation, application removal of database-message parsing, and Spring-injected PostgreSQL CRUD flow. Independent rerun passed 16/16: 11 use-case unit tests, 2 persistence integration tests, and 3 translator tests; zero failures/errors/skips. The integration flow exercises committed create/get/list/update/disable behavior and OWNER/creator MEMBER/other MEMBER permissions. Forced duplicate insertion is accurately documented as constraint translation, not concurrent execution.

Task 3 accepted for progression to Task 4. Worker full Workspace result is 179/179; coordinator independently reran affected tests only. Whitespace check passed. Config safety rejects known credential representations but does not detect arbitrary secrets disguised as metadata; provider schema/network validation remains Task 5. Workflow usage protection remains Task 6 and HTTP exposure Task 9. No commit/push. Recorded GitNexus coverage limits remain unresolved graph limitations; change detection required before any commit.
