# Work log - Workspace Connection/Credential live validation and GitNexus

## 1. Metadata

| Field | Value |
| --- | --- |
| Work date | `2026-09-20` |
| Time zone | `Asia/Saigon` |
| Repository | `Weav` (`T:\\Weav`) |
| Branch / starting commit | `feature/workspace-service` / `b1154a8` |
| Worker | Workspace Connection/Credential live-validation subagent |
| Reviewer / handoff | `/root` coordinator |
| Final status | Local Workspace API smoke passed; batched GitNexus symbol enumeration complete; graph coverage remains incomplete |
| Scope | Check local live-test feasibility; run complete GitNexus change analysis for Tasks 1-10 |
| Related records | `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`; `docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-20-workspace-connection-final-regression` |

## 2. Executive summary

- No application service was running initially. After authorization, an isolated Workspace API was started with a fresh tmpfs PostgreSQL database and Valkey on loopback-only ports; Flyway V1-V3 passed and the API became ready.
- The live HTTP smoke passed for synthetic auth, create/list, duplicate-name conflict, write-only credential persistence, internal-key rejection, disabled-state resolution, encrypted credential resolution, and non-member denial. The API was restarted bound to `127.0.0.1` after discovering its initial default bind on all interfaces.
- The existing `/connections` screen is demo state. `ConnectionsPage.tsx` renders static records and uses local timers; `connection.api.ts` reads local storage and returns a synthetic success. It is not wired to the Workspace Connection API, so Playwright would not validate this backend change.
- No Google OAuth consent, Telegram message, external account, or real provider request was used. OAuth remains blocked on an approved Google test client and account consent.
- Refreshed GitNexus broad detection reports 126 changed files, 1,751 symbols, 116 affected flows, and `risk_level=critical`. Six isolated batches now enumerate the full indexed symbol set; the review remains unresolved because 17 changed paths have no symbol mapping and flow analysis has documented gaps.

### Quick status

| Area | Status | Evidence |
| --- | --- | --- |
| Local services | `Running, loopback only` | Workspace `127.0.0.1:18082`; Postgres `:15432`; Valkey `:16379`; data stores use tmpfs |
| Browser / auth | `Not exercised` | The current Connections screen is demo-only and has no Workspace API wiring |
| Connections UI | `Not integrated` | Demo list, local state, and timers; no Workspace API call |
| GitNexus index | `Refreshed; flow coverage warns` | 14,472 nodes, 35,783 edges, 602 clusters, 560 flows; analyzer dropped or capped process traces |
| GitNexus detect changes | `CRITICAL / batched listing complete; graph incomplete` | all: 1,751 symbols, 126 files, 116 processes; six batches cover all indexed symbols; 17 paths have no symbol mapping |
| Tests / build | `Coordinator PASS; local HTTP PASS` | Coordinator recorded Workspace `310/310`; this session exercised the real service and local PostgreSQL |
| Commit / push | `Not created` | Coordinator retains review and commit decisions |

## 3. Scope and constraints

### In scope

- Check whether an already-running local web app and Workspace service allow read-only browser/API validation.
- Check whether an existing authenticated browser session is available.
- Run GitNexus change detection over the whole Task 1-10 worktree, including new untracked source and test files.
- Record exact blockers and graph risk without modifying application code or using real provider data.

### Not performed

- No login, Google consent, Telegram request, connection mutation, external account creation, or real provider data change.
- No test/build rerun or frontend implementation change.
- No commit or push.

## 4. Initial live-feasibility findings (before local startup was authorized)

| Check | Result | Evidence / limit |
| --- | --- | --- |
| Listener ports | No local listener | `Get-NetTCPConnection` showed no listeners on `3000`, `3001`, `8080`, or `8082`; `Test-NetConnection` returned false for all four |
| Container access | Blocked in this environment | `docker ps` failed because `docker` was not available on `PATH` |
| Browser | No existing test context | `mcp__chrome_devtools__list_pages` returned one selected `about:blank` page |
| Web implementation | Not a backend integration | `apps/web/src/pages/ConnectionsPage.tsx` renders static demo records and uses React state/timers. `apps/web/src/api/connection.api.ts` uses local storage and synthetic results. No matching Workspace API wiring or Connections e2e spec was found |
| Playwright | Not run | Although the web package includes Playwright, there is no running app, seeded auth context, or real API integration on this screen |

The final regression log records synthetic provider fixtures and a passing `310/310` Workspace suite. It explicitly does not claim live Google consent or real Telegram provider verification. This session did not repeat those tests.

## 5. GitNexus review

### Index and repository identity

- Repository: `Weav`, path `T:\\Weav`; branch `feature/workspace-service`; HEAD/index commit `b1154a8`.
- `mcp__gitnexus__list_repos({limit:50, offset:0})` showed the index updated at `2026-09-20T03:38:48.485Z` with no stale-index warning.
- `mcp__gitnexus__context({name:"CreateConnectionUseCase", repo:"Weav"})` returned `status=found`, `epistemic=exact`; incoming references included `ConnectionController` and the new use-case tests. No re-index was needed to resolve new untracked symbols.

### Ensuring untracked files were included

The first MCP check saw only the 20 tracked modified/deleted files: 106 changed symbols, one affected process, and medium risk. New files were absent from Git diff. The initial index had no staged changes, so only task-owned untracked paths were staged for analysis:

- `services/workspace-service/**` (95 files: new source and test files)
- `packages/contracts/http/workflow/openapi.yaml`
- Ten Task 1-10 work logs under `docs/work_logs/K/workspace-connection-credential-domain-lifecycle.md`, `2026-09-16-*`, `2026-09-19-*`, and `2026-09-20-workspace-connection-final-regression.md`

The agent-ready plan remained untracked. The 20 pre-existing tracked diffs and `.env.example` remained unstaged; no `.env` file was staged. There are 106 staged task files and no commit.

### Full change detection

Command/tool: `mcp__gitnexus__detect_changes({scope:"all", repo:"Weav"})`

| Run | `partial` | `truncated` | Changed symbols | Changed files | Affected processes | Risk |
| --- | --- | --- | ---: | ---: | ---: | --- |
| First, before including untracked files | `false` | `false` | 106 | 20 | 1 | `medium` |
| After staging task-owned untracked files | `false` | `true` | 1,751 total; 1,000 listed | 126 | 116 | `critical` |
| Repeat after truncation | `false` | `true` | 1,751 total; 1,000 listed | 126 | 116 | `critical` |

Affected process roots include connection create/update/delete/disable, credential save/delete, provider test, Google authorization and callback, credential decrypt/refresh, attachment authorization, internal resolve, and auth-failure reporting. The global `critical` result reflects the breadth of affected security-sensitive execution flows; it is a review warning, not a specific defect finding.

Targeted upstream impact returned exact caller walks:

| Symbol | Direct callers | Per-symbol risk |
| --- | --- | --- |
| `CreateConnectionUseCase` | `ConnectionController` plus five tests | `medium`, exact |
| `SaveCredentialUseCase` | `ConnectionController` plus five tests | `medium`, exact |
| `ResolveConnectionUseCase` | `InternalConnectionController` | `low`, exact |
| `CompleteConnectionOAuthUseCase` | `GoogleOAuthCallbackController` | `low`, exact |

### Initial CLI fallback failures (before elevated access was authorized)

- `node .gitnexus/run.cjs status` failed with `EPERM` while resolving the Windows user-profile path through the pnpm runner.
- `bunx gitnexus@latest detect-changes --scope all --repo .` failed with `bun is unable to write files to tempdir: EPERM`, including when pointed at a temporary directory created under `T:\\Weav`. The temporary directory was verified inside the workspace and removed after the attempt.
- The MCP check was rerun twice after the 1,000-symbol cap and returned the same `truncated=true` result. Do not report it as clean.

## 6. Handoff

### Completed

1. Checked available live services and browser auth context without exposing credentials or changing real provider data.
2. Confirmed that the current Connections page is not connected to the Workspace Connection API.
3. Staged 106 task-owned untracked files so GitNexus could see their new symbols; left the user-owned plan and all tracked working-tree edits untouched.
4. Ran and repeated GitNexus `detect_changes(scope=all)`; recorded the critical risk and the unresolved 1,000-symbol cap.

### Required before commit

1. Coordinator reviews the 116 affected processes, with particular attention to credential, OAuth, authorization, provider-verification, and internal-resolution flows.
2. Obtain a non-truncated GitNexus change listing using an execution environment that can run the CLI, or otherwise complete review in bounded graph scopes. The current result is not a clean pre-commit check.
3. A browser user-flow remains unavailable because the Connections page is not wired to the Workspace API. Real Google OAuth still requires an approved test client and explicit account consent.

### Verification boundary

- No application source was changed in this session.
- The prior Task 10 log records `310/310` tests, Compose validation, and `git diff --check`; that evidence was not rerun here.
- No secret values, `.env` content, tokens, or live provider credentials were read or recorded.

## Coordinator correction - Docker availability

- Rechecked outside sandbox with approved elevation: docker info returned server version 29.8.0; Docker is running and reachable.
- docker ps returned no running containers. No listening sockets were found on ports 3000, 3001, 8080 or 8082.
- The earlier statement that Docker was unavailable described sandbox CLI access, not Docker Desktop/daemon state. Live application services were not running; no services were started by this read-only recheck.

## 7. Authorized local runtime and Workspace API smoke

### Startup and isolation

- Inspected `compose.yml`, `compose.dev.yml`, Workspace `README.md`, and `application.properties`. The base Compose file has a fixed RabbitMQ container and persistent volume; the development Workspace service expects external `WORKSPACE_DB_*` values. To avoid touching those resources or resolving the configured Neon connection, this check used independent containers and synthetic local environment variables. No `.env` file or configured secret was read.
- The new containers have no named or bind volumes. PostgreSQL and Valkey storage is tmpfs; published ports are bound to `127.0.0.1`. No pre-existing containers or volumes were stopped, removed, or reused.

| Service | Container/process | Binding | State |
| --- | --- | --- | --- |
| PostgreSQL 16 | `weav-ws-liveval-pg-20260920` | `127.0.0.1:15432` | Ready; database `workspace_live_validation`; tmpfs `/var/lib/postgresql/data` (512 MiB) |
| Valkey 8 | `weav-ws-liveval-valkey-20260920` | `127.0.0.1:16379` | `PONG`; tmpfs `/data` (64 MiB) |
| Workspace Service | Java PID `39732`, Maven session `20402` | `127.0.0.1:18082` | Readiness `UP`; remains running for coordinator review |

- Docker commands (password value redacted; it was synthetic and local-only):

```text
docker run -d --name weav-ws-liveval-pg-20260920 --tmpfs /var/lib/postgresql/data:rw,size=512m -p 127.0.0.1:15432:5432 -e POSTGRES_DB=workspace_live_validation -e POSTGRES_USER=weav_live_test -e POSTGRES_PASSWORD=<synthetic local-only value> postgres:16-alpine
docker run -d --name weav-ws-liveval-valkey-20260920 --tmpfs /data:rw,size=64m -p 127.0.0.1:16379:6379 valkey/valkey:8-alpine
```

- `mvnw.cmd -version` failed in the managed PowerShell wrapper with `icm : Cannot index into a null array`. The cached Maven 3.9.16 binary worked when launched directly with `-Dmaven.repo.local=C:\Users\nhoan\.m2\repository -q -Dstyle.color=never spring-boot:run`. The first direct attempt without an explicit repository path failed before application startup because Maven resolved its default cache as `C:\.m2\repository`.
- The app was configured only with synthetic local DB/JWT/encryption/internal keys; Identity and Workflow base URLs were set to unused loopback ports, Redis pointed at the new local Valkey, and Google OAuth variables were empty. Only the environment-variable names are recorded; no values from `.env` were used.
- Initial readiness was `HTTP 200 UP`. Flyway history in the fresh database was `1:true,2:true,3:true`. One synthetic workspace and owner membership were inserted for HTTP auth. After noticing the first app bind was `0.0.0.0:18082`, the Maven process was stopped and restarted with `SERVER_ADDRESS=127.0.0.1`; the final listener is loopback-only. Readiness remained `UP`.

### HTTP evidence

All requests targeted the running Workspace JVM and the tmpfs database. The API key value, JWT, and internal key were synthetic test values; they were held in memory and never printed or written to the log.

| Request/check | Result |
| --- | --- |
| `GET /actuator/health/readiness` | `200`, `UP` |
| Unauthenticated `GET /workspaces/{workspaceId}/connections` | `401` |
| Synthetic owner list / post-restart list | `200`; one persisted synthetic connection after restart |
| Create HTTP/API_KEY connection | `201`; created disabled, no credential |
| Create duplicate normalized name | `409` |
| Save credential | `200`; presence reported, cleartext absent from response |
| Read connection detail | `200`; cleartext and encrypted payload absent |
| Wrong `X-Internal-Service-Key` on resolve | `401` |
| Resolve a disabled connection | `422` |
| Resolve with valid internal key after a local SQL-only `ACTIVE` fixture update | `200`; AES decrypt round-trip matched the synthetic credential in memory; stored envelope was 91 bytes |
| Read as a signed non-member | `404` |

The direct SQL `ACTIVE` update was only a fixture step for the internal decrypt/resolve endpoint. It does not validate provider verification, API-driven activation, or a real runtime provider. The HTTP provider test endpoint was not called, so no external target was contacted. The owner path does not need a Workflow usage request. Valkey readiness was verified with `valkey-cli ping`, but OAuth state storage was not exercised through the API because no approved Google test client/consent was available.

### Browser and provider limits

- Playwright was not run: the Connections frontend remains static/local-storage demo state and does not call the Workspace endpoints. A browser run on that screen would be synthetic UI evidence, not a live Workspace integration test.
- No Google authorization URL was opened, no OAuth consent was requested, no Telegram request was sent, and no Identity/Workflow service was started. Real Google validation needs an approved configured test client plus a consenting test account.

## 8. Refreshed GitNexus graph result and limitations

### Re-index and change detection

```text
node .gitnexus/run.cjs status
node .gitnexus/run.cjs analyze --index-only
node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 5000
node .gitnexus/run.cjs detect-changes --scope staged --repo . --limit 5000
node .gitnexus/run.cjs detect-changes --scope unstaged --repo . --limit 5000
```

- The first elevated `status` confirmed the index was stale due to the new live-validation work log. After updating this log, the final `analyze --index-only` refresh completed without touching repository metadata or Git staging: incremental result `changed=1, added=0, deleted=0`; graph size `14,472 nodes / 35,783 edges / 602 clusters / 560 flows`; indexed commit remained `b1154a8`.
- The analyzer warned that 18 Java files lacked reliable package facts, 126 cross-language property read/write sites were not linked, and flow enumeration was truncated: 560 flows reported; 977 of 1,177 candidate entry points were not ranked in, 978 callees were skipped at the branching cap, and 13 walks hit the trace budget. Treat affected-flow coverage as incomplete.
- Change summaries:

| Scope | Changed files | Changed symbols | Affected processes | Risk | Listing |
| --- | ---: | ---: | ---: | --- | --- |
| all | 126 | 1,751 | 116 | `critical` | capped at 1,000 |
| staged | 106 | 1,645 | 116 | `critical` | capped at 1,000 |
| unstaged | 20 | 106 | 1 | `medium` | not capped |

- The backend summary did not report `partial`; it did report `truncated=true`. The reported counts/risk cover all 1,751 observed changed symbols, but the names list is not complete.
- The CLI advertises `--limit`, but installed GitNexus 1.6.12's detect-changes command does not pass it to the backend. The backend schema has no `limit` or `offset`, and the implementation hard-caps the changed-symbol array at 1,000. The human formatter prints only 15 names. Splitting by supported `staged` / `unstaged` scopes isolates the 106 unstaged symbols, but staged Task 1-10 remains 1,645 symbols. There is no supported file-level filter or pagination; the staged graph listing cannot be made complete through these documented CLI options. No additional paths were staged to work around it.
- Follow-up correction: Section 10 records a complete indexed-symbol enumeration using isolated temporary indexes and six bounded direct-backend calls. The graph still has unmapped files and incomplete flow coverage.
- The existing stage was preserved exactly: 106 staged paths, 20 tracked unstaged paths, and two untracked paths (the user-owned plan and this validation log). This session staged nothing; `.env.example` remained unstaged; `.env` was not accessed.

Staged paths retained unchanged:

```text
+docs/work_logs/K/workspace-connection-credential-domain-lifecycle.md#source-2026-09-15-workspace-connection-domain
docs/work_logs/K/workspace-connection-credential-domain-lifecycle.md#source-2026-09-15-workspace-connection-persistence
docs/work_logs/K/workspace-connection-credential-domain-lifecycle.md#source-2026-09-15-workspace-connection-usecases
docs/work_logs/K/workspace-connection-credential-domain-lifecycle.md#source-2026-09-15-workspace-credential-lifecycle
docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-16-workspace-connection-usage-protection
docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-16-workspace-provider-verification
docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-19-workspace-google-oauth
docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-19-workspace-http-api
docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-19-workspace-runtime-connection
docs/work_logs/K/workspace-connection-credential-provider-runtime.md#source-2026-09-20-workspace-connection-final-regression
packages/contracts/http/workflow/openapi.yaml
services/workspace-service/src/main/java/com/weav/workspace/application/dto/ConnectionAuthFailureCode.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/ConnectionResponse.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/ConnectionTestResult.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/CreateConnectionCommand.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/GoogleOAuthCallbackResult.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/GoogleOAuthRefreshResponse.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/GoogleOAuthTokenResponse.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/OAuthAuthorizationResponse.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/OAuthPendingState.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/ResolvedConnectionCredential.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/SaveCredentialCommand.java
services/workspace-service/src/main/java/com/weav/workspace/application/dto/UpdateConnectionCommand.java
services/workspace-service/src/main/java/com/weav/workspace/application/port/out/ConnectionProviderPort.java
services/workspace-service/src/main/java/com/weav/workspace/application/port/out/CredentialCryptoPort.java
services/workspace-service/src/main/java/com/weav/workspace/application/port/out/GoogleOAuthPort.java
services/workspace-service/src/main/java/com/weav/workspace/application/port/out/OAuthStateStore.java
services/workspace-service/src/main/java/com/weav/workspace/application/port/out/WorkflowConnectionUsagePort.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionAuthorizationPolicy.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionConfigPolicy.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionProviderPolicy.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionProviderRegistry.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionUsageProtection.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionViewAssembler.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/CredentialPayloadCodec.java
services/workspace-service/src/main/java/com/weav/workspace/application/service/GoogleOAuthScopePolicy.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/AuthorizeConnectionAttachmentUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CompleteConnectionOAuthUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CreateConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/DeleteConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/DeleteCredentialUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/DisableConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/GetConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ListConnectionsUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ReportConnectionAuthFailureUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ResolveConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/SaveCredentialUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/StartConnectionOAuthUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/TestConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/application/usecase/UpdateConnectionUseCase.java
services/workspace-service/src/main/java/com/weav/workspace/domain/exception/AuthenticationRejectedException.java
services/workspace-service/src/main/java/com/weav/workspace/domain/exception/ConnectionNameAlreadyExistsException.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache/RedisOAuthStateStore.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/config/CredentialEncryptionProperties.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/config/GoogleOAuthProperties.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/config/WorkflowServiceProperties.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/credential/AesGcmCredentialCrypto.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/ConnectionPersistenceExceptionTranslator.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/mapper/ConnectionPersistenceMapper.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/repository/ConnectionRepositoryAdapter.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/repository/CredentialRepositoryAdapter.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/repository/SpringDataConnectionRepository.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/persistence/repository/SpringDataCredentialRepository.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/google/GoogleConnectionProvider.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/google/GoogleOAuthProvider.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/http/HttpConnectionProvider.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/http/HttpTargetValidator.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/http/PinnedHttpTransport.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/telegram/TelegramConnectionProvider.java
services/workspace-service/src/main/java/com/weav/workspace/infrastructure/workflow/WorkflowConnectionUsageClient.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/ConnectionController.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/GoogleOAuthCallbackController.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/InternalConnectionController.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/request/AuthorizeConnectionAttachmentRequest.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/request/CreateConnectionRequest.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/request/ReportConnectionAuthFailureRequest.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/request/SaveCredentialRequest.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/request/UpdateConnectionRequest.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/response/OAuthAuthorizationHttpResponse.java
services/workspace-service/src/main/java/com/weav/workspace/presentation/http/response/ResolvedConnectionHttpResponse.java
services/workspace-service/src/main/resources/db/migration/V3__connection_constraints.sql
services/workspace-service/src/test/java/com/weav/workspace/ConnectionPersistenceTest.java
services/workspace-service/src/test/java/com/weav/workspace/WorkflowContractValidationTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/service/GoogleOAuthScopePolicyTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/ConnectionUsageProtectionTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/ConnectionUseCasesPersistenceIntegrationTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/ConnectionUseCasesTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/CredentialUseCasesPersistenceIntegrationTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/CredentialUseCasesTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/GoogleOAuthUseCasesTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/InternalConnectionUseCasesTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/TestConnectionUseCasePersistenceIntegrationTest.java
services/workspace-service/src/test/java/com/weav/workspace/application/usecase/TestConnectionUseCaseTest.java
services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionAuthorizationPolicyTest.java
services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionDomainTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/cache/RedisOAuthStateStoreTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/credential/AesGcmCredentialCryptoTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/persistence/ConnectionMigrationTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/persistence/ConnectionPersistenceExceptionTranslatorTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/provider/google/GoogleOAuthProviderTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/provider/http/HttpConnectionProviderTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/provider/http/HttpTargetValidatorTest.java
services/workspace-service/src/test/java/com/weav/workspace/infrastructure/provider/telegram/TelegramConnectionProviderTest.java
services/workspace-service/src/test/java/com/weav/workspace/presentation/http/ConnectionHttpDtoTest.java
services/workspace-service/src/test/java/com/weav/workspace/presentation/http/CredentialSecretRegressionTest.java
services/workspace-service/src/test/java/com/weav/workspace/presentation/http/WorkspaceConnectionHttpIntegrationTest.java
```

### Impact findings

- The change-set risk remains `critical`; this is a graph breadth warning, not a single defect finding. Representative affected flows include `create`, `saveCredential`, `resolve`, attachment authorization, connection update/normalization, and Google authorization/callback.
- Current method impacts found `ConnectionController.create` (5-step `create` flow), `ConnectionController.saveCredential` (6-step `saveCredential` flow), and `InternalConnectionController.resolve` (9-step `resolve` flow). Those method-level walks are `LOW` but `epistemic=lower-bound`: GitNexus dropped three `execute` call sites at index time because receiver types could not be established. The low number is not a complete caller claim.
- OAuth completion method lookup returned multiple `execute` overload candidates, including an `UNKNOWN` result; the class-level caller is `GoogleOAuthCallbackController`. Real source/tests remain the corroboration for the missing graph edges.
- Before commit, retain a manual review of the security-sensitive connection/credential/OAuth/internal-resolution paths and account for the graph's missing file mappings and incomplete flows. The 1,000-symbol listing cap is resolved by Section 10, but the graph result is still not a clean pre-commit gate.

## 9. Final worktree and running-process state

- Final `git status` counts at handoff: 106 staged, 20 tracked unstaged, two untracked (the agent-ready plan and this live-validation log). No commit or push was created.
- PostgreSQL and Valkey containers remain running with tmpfs storage on loopback; Workspace runs as Java PID `39732` on `127.0.0.1:18082`. These were left running for coordinator review. No existing named volume was mounted or removed.
- No application source was modified by this validation. Maven/build artifacts remain under ignored `services/workspace-service/target`.
- Remaining provider prerequisite: an approved Google OAuth test client and an account authorized to grant consent. Until then the API smoke is fixture-backed and must not be called real Google OAuth success.

## Coordinator review of live-validation handoff

- Independently confirmed local PostgreSQL/Valkey containers running on loopback ports 15432/16379, Workspace readiness HTTP 200 at 127.0.0.1:18082, and unauthenticated /workspaces HTTP 401.
- Reviewed worker HTTP evidence: synthetic create/save/redaction/duplicate/non-member/persistence checks passed. ACTIVE was seeded directly in the local database for resolve; this does not prove provider verification or API-driven activation.
- The earlier Not performed list refers to external/real-user operations; local synthetic connection creation and credential mutation were performed after startup authorization.
- At that handoff point, GitNexus remained unresolved with a truncated symbol listing. Section 10 supersedes the listing-cap finding: all indexed symbols are now covered by batches, but 17 changed paths remain unmapped and the broad risk remains `critical`. No commit was created. Browser/API UI integration and real Google consent are not verified; local test services remain running for user review.

## 10. Follow-up: bounded GitNexus enumeration and graph review

### Method and index safety

- The capped baseline was reproduced with `node .gitnexus/run.cjs detect-changes --scope all --repo . --limit 5000`: 126 changed files, 1,751 changed symbols, 116 affected processes, `risk_level=critical`, `truncated=true` with 1,000 listed symbols. The installed CLI's `--limit` does not reach the backend; `LocalBackend.detectChanges` enforces a fixed 1,000-symbol result cap, and its text formatter prints at most 15 symbol names.
- To enumerate the entire indexed result without changing real staging, six mutually disjoint file batches were reviewed through `LocalBackend.callTool('detect_changes', {scope:'staged', repo:process.cwd()})`. For each batch, `GIT_INDEX_FILE` pointed at `.gitnexus/workspace-connection-batch-review-20260920-v1/alternate-index`; the temporary index was reset from `HEAD` with `git -c core.splitIndex=false read-tree HEAD`, populated with only that batch's current working-tree paths using `git add -- <paths>`, and checked with `git diff --cached --name-only` against the batch manifest before calling GitNexus. No task paths were added to the real index.
- The exact six structured reports and capped baseline are retained (ignored) under `.gitnexus/workspace-connection-batch-review-20260920-v1/`. Each batch was below 1,000 symbols, returned its full `changed_count` array without partial/truncated results, and contained only symbols from its verified manifest.

| Batch | Files | Symbols | Affected flows | Batch risk |
| --- | ---: | ---: | ---: | --- |
| `docs-contracts` | 14 | 280 | 0 | `low` |
| `service-config-docs` | 5 | 18 | 0 | `low` |
| `main-application-domain` | 45 | 372 | 98 | `critical` |
| `infrastructure-core` | 17 | 159 | 11 | `high` |
| `provider-security-http` | 17 | 222 | 88 | `critical` |
| `tests` | 28 | 700 | 0 | `low` |
| **Total / distinct union** | **126** | **1,751** | **116 unique** | **`critical` overall** |

- Validation of the union: 1,751 total symbols and 1,751 distinct IDs (zero overlap); all 1,000 IDs shown in the capped baseline were included; the six batches' process-ID union exactly matched all 116 baseline process IDs (no missing or extra IDs); report file counts sum to 126 and match `git diff HEAD --name-only`. No reported symbol path fell outside those 126 changed paths.
- The real `.git\index` SHA-256 before and after the probe and six full batches was `8BB5304BCF677ADFB4D1F774E2134AF4FF29211021B3A431831E3D7B52D1F7C4`. Current status remains 106 staged, 20 tracked unstaged, and two untracked paths (the user-owned plan and this log); the 126-path task diff is the 106 staged plus 20 tracked unstaged paths. `.env.example` remained unstaged; `.env` was not accessed.

### Remaining graph coverage gap and caller review

- The six reports contain symbols from 109 distinct changed file paths, leaving 17 of the 126 changed paths with no mapped symbol. The earlier GitNexus Cypher query returned five `File` nodes with zero `DEFINES` edges: `compose.dev.yml`, both Workspace/Workflow OpenAPI contracts, `services/workspace-service/pom.xml`, and `V3__connection_constraints.sql`. Twelve other changed paths had no `File` node: ten Java files listed below, `.env.example`, and the deleted `packages/contracts/http/workflow/.gitkeep`.
- The ten unmapped Java files are `ConnectionProviderPort`, `CredentialCryptoPort`, `GoogleOAuthPort`, `OAuthStateStore`, `TransactionRunner`, `WorkflowConnectionUsagePort`, `ConnectionRepository`, `CredentialRepository`, `RedisOAuthStateStore`, and `RedisOAuthStateStoreTest`. `context()` reported representative absent symbols as `Symbol not found`. This is unresolved graph coverage, not evidence those files have no callers.
- Targeted source inspection found the missing relationships: three provider classes implement `ConnectionProviderPort`; `AesGcmCredentialCrypto` implements `CredentialCryptoPort`; `GoogleOAuthProvider` implements `GoogleOAuthPort`; `RedisOAuthStateStore` implements `OAuthStateStore` and is wired by `WorkspaceApplicationConfig`; `SpringTransactionRunner` implements `TransactionRunner`, which is injected across 24 source files; `WorkflowConnectionUsageClient` implements the usage port; and the repository adapters/use cases depend on the missing repository interfaces. Affected security-sensitive flow families include connection create/update/delete/disable, credential save/delete/resolve/decrypt/refresh, Google authorization/callback/token refresh/provider verification, attachment authorization, internal resolve, and authorization-failure reporting.
- Manual source/test corroboration found `RedisOAuthStateStore` uses one-time Redis Lua GET+DEL, bounded 1-second-to-1-hour TTLs, strict state parsing, and fail-closed handling for malformed state or Redis outages. `RedisOAuthStateStoreTest` covers expiry, 24 concurrent consumers with one winner, malformed/unknown state, and outage behavior. The recorded Workspace suite remains `310/310` from the prior final regression log; it was not rerun in this follow-up. No concrete defect was identified in this review slice.
- GitNexus still reports broad `critical` risk. This is a breadth/security-sensitivity warning, not a specific defect, and smaller per-batch risk values do not waive it. The refreshed index also warns about unreliable package facts in 18 Java files, 126 unlinked cross-language property read/write sites, dropped candidate entry points and branch-capped traces. An MCP concept query warned `FTS indexes missing — keyword search degraded`; its empty result was not treated as absence of callers. A repeat Cypher attempt in this follow-up failed because LadybugDB could not replay shadow pages in read-only mode; the previously saved result plus targeted source review remain the evidence, and the query was not retried.
- Recommendation: the cap itself is no longer a reason to block review, but GitNexus is not a clean pre-commit signoff while these file/dispatch gaps remain. The coordinator should explicitly review or accept the missing-mapping and lower-bound-flow caveats before deciding whether to commit this logical Workspace milestone. No commit or push was made.

### Runtime and final checks

- Rechecked after the bounded run: local readiness `UP`; isolated PostgreSQL and Valkey containers still running on loopback ports `15432` and `16379`; Workspace remains on `127.0.0.1:18082`. These hold only synthetic tmpfs-backed test data and were left running for coordinator review.
- Playwright remains inapplicable to this backend change because the current Connections page is demo/local-storage state and has no Workspace API wiring. The running service was tested directly over HTTP as recorded in Section 7. No real Google consent, Telegram send, external account, or production/Neon mutation occurred.
- `git diff --check` and `git diff --cached --check` passed; only line-ending conversion warnings were printed. No application code, source tooling, real Git index, or commit was changed by this follow-up.

## 11. Coordinator final graph review

- Independently parsed all six structured reports: 126 file counts, 1751 symbols/1751 distinct IDs, 116 distinct flows, no partial/truncated flags and no changed_count/array mismatches. Real index SHA256 remains 8BB5304BCF677ADFB4D1F774E2134AF4FF29211021B3A431831E3D7B52D1F7C4. Both staged and unstaged diff checks pass.
- Reviewed the unmapped application/domain port contracts and RedisOAuthStateStore source, corroborating prior implementation/wiring and test reviews. Missing graph edges are not treated as unused code. Redis state retains strict canonical random-state validation, atomic GET+DEL, bounded expiry, strict JSON and safe dependency errors.
- The symbol-list cap is resolved through complete bounded analysis. CRITICAL overall breadth and missing Java/config graph mappings remain explicit tool limitations, not an identified application defect. Manual review plus the independently recorded 310/310 suite and local synthetic HTTP evidence support proceeding to a logical backend commit; this is a qualified coordinator assessment, not a claim of complete automated graph coverage.
- No additional source change or test rerun was required in this review. No commit/push performed. Real provider consent and frontend integration remain outside verified scope.
