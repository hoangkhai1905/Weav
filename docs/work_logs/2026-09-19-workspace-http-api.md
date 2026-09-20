# Work log - Workspace Connection HTTP API

## 1. Metadata

| Field | Value |
| --- | --- |
| Work date | `2026-09-19` |
| Time zone | `Asia/Saigon` |
| Repository | `Weav` (`T:\Weav`) |
| Branch / starting commit | `feature/workspace-service` / `b1154a8` |
| Worker | Workspace Connection HTTP API worker |
| Reviewer / handoff | `/root` coordinator |
| Final status | Task 9 callback error-boundary correction complete; awaiting coordinator acceptance |
| Scope | Public/internal Connection HTTP APIs, callback redirects, OpenAPI, security, tests, and documentation |
| Related plan | `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, Task 9 |

## 2. Executive summary

### Results

- Exposed the public Connection CRUD, write-only credential, test, disable, OAuth-authorize, and Google callback operations, plus all three Workflow-facing internal operations.
- Kept controller authorization in existing use cases. Public routes require the authenticated JWT subject; internal routes retain the service-key filter; only the Google callback is unauthenticated.
- Added a safe 302 callback redirect to the configured frontend URL, with an allow-listed result and no trusted connection identifier when state is invalid. OAuth-start and internal credential responses use `Cache-Control: no-store`.
- Updated both Workspace OpenAPI documentation and the service README; added real HTTP/security/PostgreSQL/Valkey integration checks and DTO secret-redaction tests.

### Quick status

| Area | Status | Evidence |
| --- | --- | --- |
| Compile | `PASS` | Focused Maven run compiled 173 service sources and 59 test sources |
| Focused tests | `PASS` | Task 9 focus `17/17`; affected OAuth focus `15/15`; zero failures/errors/skips |
| Full Workspace regression | `PASS` | `306/306`; zero failures/errors/skips |
| Database | `PASS` | Integration suite applied existing Flyway V1-V3; no Task 9 migration |
| Diff / whitespace | `PASS` | `git diff --check`; only shared tracked-file line-ending notices |
| Commit / PR | `Not created` | Task 9 handoff remains uncommitted as requested |

The coordinator's independent pre-correction Task 9 check was `15/15` (12 SecurityConfig/contract checks and 3 HTTP/DTO checks). The added callback HTTP scenarios increase the current Task 9-focused count to `17/17`.

## 3. Scope and acceptance

### In scope

- All 11 public operations: connection create/list/get/update/delete; credential replace/remove; test; disable; Google OAuth start; and callback.
- Internal attachment authorization, runtime resolve, and confirmed auth-failure reporting.
- OpenAPI, Workspace contract README, service README, controller/request/response DTOs, callback result mapping, security wiring, and focused tests.

### Out of scope

- Task 10 broad end-to-end/secret-regression suite, UI/browser flow, live Google consent, and any real provider account.
- Controllers do not accept client-selected callback or frontend redirect URLs. No generic OAuth abstraction, commit, push, branch, or worktree operation was added.
- The shared Task 1-8 changes and untracked plan were preserved. The existing deleted `packages/contracts/http/workflow/.gitkeep` was not touched.

### Acceptance covered

- JWT is required on public routes, including OAuth start; the internal service key alone cannot authenticate public routes. Callback passes the Spring Security chain without a JWT.
- Missing/wrong internal keys are rejected. A successful resolve response is no-store and contains access authentication only, never a Google refresh token.
- Callback consumes server-bound state through the existing use case, does not accept a connection identifier or redirect target from the caller, never echoes code/provider error/token, and emits only documented failure codes. Invalid state omits `connectionId`.
- Real HTTP tests cover member metadata redaction, CRUD/credential/test/disable/OAuth operations, callback success/denial/replay, internal attachment/resolve/auth-failure, and secret-free errors.

## 4. Context, constraints, and graph review

- **System context:** Tasks 1-8 are accepted shared uncommitted work. PostgreSQL is authoritative for connection state; Redis/Valkey is the one-time OAuth-state authority. Task 9 reuses the existing controller, service-key filter, response, error, and use-case conventions.
- **Plan authority:** Task 9 and global contracts in the agent-ready plan; no separate HTTP design spec was present.
- **Security constraints:** No secrets in public metadata, DTO diagnostics, or redirects. Internal resolve is explicitly secret-bearing, no-store, and excludes refresh tokens. Authorization and lifecycle policy remain in use cases.
- **GitNexus:** The index remains at `b1154a8`, before the shared Tasks 1-8 edits. Path-qualified `SecurityConfig` and `WorkspaceContractValidationTest` impacts returned `UNKNOWN`; a name-only `SecurityConfigTest` query was ambiguous and showed a broad `CRITICAL` candidate, not a path-specific caller set. `JwtActor` was `LOW` with two existing controller importers. Source review confirmed the configured Spring chain, default authenticated rule, and internal-key filter before adding the callback permit rule. `UNKNOWN` remains unresolved for graph purposes; no `Connection` or `Credential` domain symbols were changed in Task 9.
- **Test data:** Synthetic JWTs, credentials, OAuth state, provider values, and local Workflow fixture only. PostgreSQL and Valkey were real Testcontainers; no `.env` or live Google account was accessed.

## 5. Changes

### API and security behavior

- Added thin `ConnectionController`, `InternalConnectionController`, and `GoogleOAuthCallbackController` adapters. The new update request supports config-only PATCH and rejects an empty patch.
- Added request DTOs for create, update, credential replacement, attachment authorization, and auth-failure reporting. Credential/config DTO diagnostics redact their values.
- Added the OAuth authorization and minimal runtime response DTOs; their diagnostics redact the authorization URL and auth map.
- Added `GoogleOAuthCallbackResult` and a narrow callback use-case outcome adapter so HTTP never consumes state twice or parses exception messages. Failure outcomes use the five documented codes only.
- Configured only `GET /oauth/google/callback` as permit-all. All other public paths remain authenticated; existing internal routes continue through the constant-time service-key filter.
- Added `no-store` to OAuth-start and internal resolve responses. Callback redirects use only the configured frontend URI and drop invalid state IDs.

### Contract and documentation

- Added 14 Task 9 operations to `packages/contracts/http/workspace/openapi.yaml`, including JWT/internal-key/callback security, request/response schemas, safe callback outcomes, and no-store headers.
- Updated the Workspace contract README and service README with the route table, callback behavior, metadata redaction, server-owned redirects, and internal credential response boundary.
- Corrected the PATCH request schema and Java validation to allow a name-only or config-only patch while rejecting an empty patch.

### Files owned by Task 9

| Kind | Path | Change |
| --- | --- | --- |
| Updated | `packages/contracts/http/workspace/openapi.yaml` | Public/internal routes, schemas, security and cache-control contract |
| Updated | `packages/contracts/http/workspace/README.md` | Connection/OAuth security and runtime usage notes |
| Updated | `services/workspace-service/README.md` | Route inventory and secret handling notes |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/ConnectionController.java` | Public HTTP adapter |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/InternalConnectionController.java` | Internal HTTP adapter |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/GoogleOAuthCallbackController.java` | Server-owned callback redirect |
| Added | `presentation/http/request/CreateConnectionRequest.java`, `UpdateConnectionRequest.java`, `SaveCredentialRequest.java`, `AuthorizeConnectionAttachmentRequest.java`, `ReportConnectionAuthFailureRequest.java` | HTTP request records; sensitive values are redacted where present |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/response/OAuthAuthorizationHttpResponse.java` | Redacted OAuth-start response |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/response/ResolvedConnectionHttpResponse.java` | Minimal no-store runtime auth response |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/GoogleOAuthCallbackResult.java` | Typed allow-listed callback outcome |
| Updated | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CompleteConnectionOAuthUseCase.java` | Safe callback outcome method, preserving single state consumption |
| Updated | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/security/SecurityConfig.java` | Permit only the Google callback GET |
| Updated | `services/workspace-service/src/test/java/com/weav/workspace/SecurityConfigTest.java` | Callback/JWT/internal-key security checks |
| Updated | `services/workspace-service/src/test/java/com/weav/workspace/WorkspaceContractValidationTest.java` | Operation/security/schema checks |
| Added | `services/workspace-service/src/test/java/com/weav/workspace/presentation/http/WorkspaceConnectionHttpIntegrationTest.java` | Real HTTP lifecycle/security with PostgreSQL and Valkey |
| Added | `services/workspace-service/src/test/java/com/weav/workspace/presentation/http/ConnectionHttpDtoTest.java` | DTO `toString()` secret redaction |
| Added | `docs/work_logs/2026-09-19-workspace-http-api.md` | Task 9 evidence and coordinator handoff |

The shared worktree also contains accepted Tasks 1-8 and the unchanged untracked plan; this list describes Task 9 ownership only.

## 6. Verification

Focused Task 9 command (installed Maven, local cache, UTC, Docker Testcontainers):

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml -Dtest=SecurityConfigTest,WorkspaceContractValidationTest,WorkspaceConnectionHttpIntegrationTest,ConnectionHttpDtoTest test"
```

Result: `PASS; 15/15; 0 failures/errors/skips`. The integration test used real HTTP on the Spring security chain, PostgreSQL and Valkey Testcontainers, and synthetic Google/Workflow fixtures.

Full Workspace regression:

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml test"
```

Result: `PASS; 304/304; 0 failures/errors/skips`. The suite applied existing Flyway V1-V3. Testcontainers teardown emitted non-failing Lettuce reconnect warnings as per-class Redis containers stopped.

`git diff --check` exited 0. Git reported line-ending conversion notices for shared tracked files; no whitespace errors were reported. No live Google or browser acceptance was performed.

## 7. Risks and handoff

| Level | Limitation | Current treatment / next step |
| --- | --- | --- |
| Medium | No live Google client, consent or account was exercised | This proves fixture behavior only; configure and validate a real consent flow in the later user-authorized environment |
| Medium | Task 10 broad end-to-end/security regression is not in scope | Task 9 focused real HTTP/DB/Valkey suite passed; continue with Task 10 separately |
| Low | GitNexus index excludes current uncommitted Tasks 1-9 symbols | Re-index and run `detect_changes` before any later commit; do not interpret current `UNKNOWN` as unaffected |

### Ready for coordinator review

1. Review the HTTP controller methods and OpenAPI operations against Task 9.
2. Verify the safe callback outcome mapping in `CompleteConnectionOAuthUseCase` and the no-store internal/OAuth-start responses.
3. Re-run `git diff --check`; no commit was created. The untracked agent-ready plan and unrelated existing worktree changes remain untouched.

## 8. References and end of session

- `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, global constraints and Task 9.
- `docs/work_logs/2026-09-15-workspace-connection-domain.md`, `docs/work_logs/2026-09-15-workspace-connection-persistence.md`, `docs/work_logs/2026-09-15-workspace-connection-usecases.md`, `docs/work_logs/2026-09-15-workspace-credential-lifecycle.md`, `docs/work_logs/2026-09-16-workspace-provider-verification.md`, `docs/work_logs/2026-09-16-workspace-connection-usage-protection.md`, `docs/work_logs/2026-09-19-workspace-google-oauth.md`, and `docs/work_logs/2026-09-19-workspace-runtime-connection.md`.
- `packages/contracts/http/workspace/openapi.yaml` and `services/workspace-service/README.md` are the current HTTP/API configuration references.

| Field | Value |
| --- | --- |
| Stopped | `2026-09-19 19:31 Asia/Saigon` |
| Worktree | `Uncommitted shared Tasks 1-9 work; plan unchanged` |
| Commit / PR | `Not created` |
| Log owner | Workspace Connection HTTP API worker |
| Read before continuing | This log, Task 9 plan, and current `git status` |

## Follow-up after coordinator review - callback operational failures

### Correction

- `CompleteConnectionOAuthUseCase.executeForCallback` now maps Spring `DataAccessException` and `TransactionException` failures to the allow-listed reason for the current callback stage. This catch is limited to the HTTP callback result boundary; the normal `execute` behavior is unchanged. The callback does not log or return exception text and cannot turn a failed mutation or commit into success.
- The HTTP integration fixtures inject a persistence failure during final callback mutation after state consumption and after the credential write is attempted. PostgreSQL confirms the transaction rolled back: the connection remains `DISABLED` and no credential row was stored. The redirect is a 302 to configured `localhost /connections`, includes only `oauth`, `reason`, and the connection ID recovered from consumed state, and contains no synthetic exception, code, or token text. Replaying the state returns `state_invalid` without a connection ID.
- Added HTTP callback outcomes for denial (`authorization_denied`), exchange dependency failure (`token_exchange_failed`), verification dependency failure (`verification_failed`), and member removal during provider exchange (`authorization_changed`). Callback calls omit JWTs; each returns the expected safe redirect. Membership removal is committed inside the synthetic exchange hook so final authorization re-reads current membership.

### Verification after correction

| Check | Command / result | Notes |
| --- | --- | --- |
| Affected OAuth tests | `-Dtest=WorkspaceConnectionHttpIntegrationTest,GoogleOAuthUseCasesTest test` — `15/15` | Real Spring HTTP, PostgreSQL and Valkey Testcontainers; provider/workflow fixtures are synthetic |
| Task 9 focused regression | Existing focused command above — `17/17` | SecurityConfig 9, contract validation 3, HTTP integration 4, DTO redaction 1 |
| Full Workspace regression | `mvn -B -Dstyle.color=never -f services\workspace-service\pom.xml test` — `306/306` | No failures/errors/skips; PostgreSQL and Valkey Testcontainers; UTC JVM setting |
| Whitespace review | `git diff --check` and targeted trailing-whitespace scan — `PASS` | No commit was created |

The first sandboxed Maven attempt was blocked while `javac` closed the cached Tomcat JAR under `C:\Users\nhoan\.m2`; the same focused command passed with the previously approved elevated Maven setup. This was an environment access issue, not a source compilation diagnostic.

### Handoff

- Task 9 follow-up is ready for coordinator review. No Task 10 work or commit was performed. The GitNexus method impact remains `UNKNOWN` because the index predates these uncommitted symbols; targeted source search found the callback controller as the sole production caller, and the existing HTTP integration suite covers the route.

## Coordinator acceptance - 2026-09-20

- Task 9 accepted after review of callback operational-failure handling, safe reason mapping, state consumption and rollback regression. Existing non-callback execute semantics remain unchanged.
- Independent selector SecurityConfigTest,WorkspaceContractValidationTest,WorkspaceConnectionHttpIntegrationTest,ConnectionHttpDtoTest,GoogleOAuthUseCasesTest passed 28/28, zero failures/errors/skips, BUILD SUCCESS. Tests used real HTTP, PostgreSQL and Valkey with synthetic provider fixtures.
- Worker recorded full regression 306/306; coordinator did not repeat full suite this turn. git diff --check passed with line-ending notices only.
- Live Google consent remains unverified. Task 10 end-to-end/secret regression and documentation is next. No commit; pre-commit graph analysis remains pending.
