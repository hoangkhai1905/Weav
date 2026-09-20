# Work log - Workspace runtime connection resolution

## 1. Metadata

| Field | Value |
| --- | --- |
| Work date | `2026-09-19` |
| Time zone | `Asia/Saigon` |
| Repository | `Weav` (`T:\Weav`) |
| Branch / starting commit | `feature/workspace-service` / `b1154a8` |
| Worker | Workspace runtime connection worker |
| Reviewer / handoff | `/root` coordinator |
| Final status | Task 8 implementation complete; awaiting coordinator review |
| Scope | Runtime credential resolution, Google token refresh, attachment authorization, and typed auth-failure reporting |
| Related plan | `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, Task 8 |

## 2. Executive summary

### Results

- Added workspace-scoped runtime resolution for ACTIVE connections. Google credentials return only the access token; non-refreshable credentials with canonical `Credential.expiresAt` in the past are rejected.
- Added Google refresh outside the database transaction. The refreshed token and optional rotated refresh token are encrypted and saved in a short transaction only after rechecking the current ACTIVE connection and credential identity. The old refresh token is retained when Google omits a replacement.
- Added attachment authorization for workspace members who are OWNER or the connection creator, regardless of connection status, and typed reporting that only accepts `AUTHENTICATION_REJECTED`.
- Updated the Workspace README to describe application-layer support and the still-pending HTTP routes.

### Quick status

| Area | Status | Evidence |
| --- | --- | --- |
| Compile | `PASS` | Focused Maven run compiled the Workspace Service and test sources |
| Focused tests | `PASS` | `36/36`; zero failures/errors/skips; PostgreSQL Testcontainers and local Google HTTP fixtures |
| Full Workspace regression | `PASS` | `297/297`; zero failures/errors/skips; Docker/Testcontainers enabled |
| Database | `PASS` | Integration tests applied existing Flyway V1-V3; no schema change in Task 8 |
| Diff / whitespace | `PASS` | `git diff --check` and Task 8 whitespace scan; see final verification section |
| Live Google | `Not run` | Synthetic fixtures only; no client secrets or Google account used |
| Commit / PR | `Not created` | Parent requested an uncommitted handoff |

## 3. Scope and acceptance

### In scope

- `ResolvedConnectionCredential` and runtime connection resolution.
- Google refresh port/adapter support and safe status handling.
- Workflow attachment authorization and confirmed authentication-failure reporting use cases.
- PostgreSQL integration tests, synthetic local HTTP fixtures, README update, and this focused work log.

### Out of scope

- Public/internal HTTP controllers or OpenAPI changes (Task 9).
- Workflow runtime client wiring beyond the application-level use cases.
- Generic OAuth grant frameworks, distributed refresh locks, live provider calls, database migration changes, commits, and pushes.

### Acceptance covered

- Wrong workspace, disabled/invalid connection, missing credential, and expired non-refreshable credentials fail closed.
- Valid Google access tokens return without remote refresh; expired Google tokens refresh outside an ambient transaction and use canonical credential expiry.
- Refresh responses are shape/scope checked. Missing replacement refresh tokens retain the existing refresh token; concurrent refresh and lifecycle changes do not overwrite a replaced/deleted/disabled credential.
- Transient, malformed, or configuration errors preserve the stored credential/status. Only a typed confirmed rejection or inadequate granted scopes marks the still-current authorization INVALID.
- Runtime DTO shape excludes refresh tokens and redacts secrets from `toString()`.
- Attachment authorization requires same-workspace membership plus OWNER or creator rights and ignores connection status.
- Auth-failure reporting accepts only the typed `AUTHENTICATION_REJECTED` value and affects only ACTIVE connections.

## 4. Context and constraints

- **System context:** Tasks 1-7 are accepted shared, uncommitted worktree changes. PostgreSQL remains authoritative; credential payloads reuse the existing encryption envelope and strict codec. Workflow usage protection is reused at its existing boundary.
- **Plan authority:** Task 8 in the agent-ready plan; no separate runtime-resolution design spec was present.
- **Security constraints:** No refresh token in the response DTO. No provider response body, token, or raw provider exception is propagated. No OAuth call is made inside a database transaction. No Redis lock was added.
- **Test data:** Synthetic values and local HTTP/PostgreSQL/Valkey containers only; no `.env` or real provider account accessed.

## 5. Session notes

| Check / action | Result |
| --- | --- |
| GitNexus upstream impact before editing existing OAuth/config/use-case symbols | Several Task 1-7 symbols were absent or returned `UNKNOWN` because the shared uncommitted symbols were not in the index; `WorkspaceApplicationConfig` also had unresolved callers. No HIGH/CRITICAL risk was reported. Targeted source search confirmed the OAuth provider implementation/beans, codec use sites, and usage-protection callers before proceeding. |
| Google refresh protocol review | The official Google web-server guide documents HTTPS `POST https://oauth2.googleapis.com/token` with `client_id`, optional `client_secret`, `grant_type=refresh_token`, and `refresh_token`; it says successful refresh returns a new access token and shows `scope`, `expires_in`, and `token_type`. The adapter uses this form and validates the required response fields. |
| Invalid grant classification | Google documents `invalid_grant` as an expired or invalidated token requiring user reauthorization. Other errors such as `invalid_client` are not classified as user authorization failure; they preserve the current connection state. |
| Scope alias check | Google's scopes reference lists OIDC `email` and Google OAuth2 `userinfo.email` as email scopes. The existing policy normalizes the long user-info email URI to the requested `email` scope while keeping provider data scopes exact. |

## 6. Technical decisions

| Decision | Reason / evidence | Consequence |
| --- | --- | --- |
| Reuse a narrow refresh method on `GoogleOAuthPort` and the existing fixed-endpoint adapter | Keeps Google-specific protocol outside application logic and avoids a generic OAuth framework | Refresh errors remain typed and provider bodies are discarded |
| Keep the remote refresh before a short final DB transaction | Network calls must not hold database locks; current connection and credential identity must be checked at write time | If state changes during provider latency, the result is discarded |
| Permit duplicate concurrent refreshes without distributed locking | Explicit V1 plan choice; same-grant rotations may both be accepted, while a changed credential/refresh token is rejected | Last successfully encrypted valid token wins, subject to final ACTIVE/identity/expiry checks |
| Treat only `invalid_grant` as a confirmed Google refresh rejection | Google separately documents `invalid_client` and other errors; transient and client-configuration errors must not invalidate user credentials | Confirmed rejection changes a still-current ACTIVE connection to INVALID; other failures preserve it |
| Keep attachment permission independent of status | Plan allows editing a workflow reference for disabled/invalid connections; runtime execution separately requires ACTIVE | Workflow editing can retain a valid membership-owned reference while execution still fails closed |

## 7. Changes

### Code and behavior

- Added `ResolveConnectionUseCase`, `AuthorizeConnectionAttachmentUseCase`, and `ReportConnectionAuthFailureUseCase`.
- Added minimal `ResolvedConnectionCredential`, validated `GoogleOAuthRefreshResponse`, typed `ConnectionAuthFailureCode`, and safe `AuthenticationRejectedException`.
- Extended `GoogleOAuthPort` and `GoogleOAuthProvider` for Google token refresh, safe `invalid_grant` classification, and validated optional refresh-token rotation.
- Added PostgreSQL-wired `InternalConnectionUseCasesTest` coverage for scope, expiry, encryption, status, membership, and concurrent lifecycle behavior. Extended the OAuth local HTTP fixtures for refresh request/response validation.
- Updated `services/workspace-service/README.md` with runtime use-case status and the pending HTTP route boundary.

### Database, schema, and configuration

- No migration, schema, or production environment variable changes in Task 8.
- Existing credential identity, encrypted payload, key version, and `Credential.expiresAt` are reused.

## 8. Files to review

| Kind | Path | Review note |
| --- | --- | --- |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/ResolvedConnectionCredential.java` | Exact auth key/provider shape; refresh token is not representable |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/GoogleOAuthRefreshResponse.java` | Validated fields and redacted `toString()` |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/ConnectionAuthFailureCode.java` | Single supported failure value |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/domain/exception/AuthenticationRejectedException.java` | Safe provider-confirmed signal |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ResolveConnectionUseCase.java` | Workspace isolation, ACTIVE gate, refresh and final rechecks |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/AuthorizeConnectionAttachmentUseCase.java` | Membership + OWNER/creator policy independent of status |
| Added | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ReportConnectionAuthFailureUseCase.java` | Typed-only state transition |
| Extended | `services/workspace-service/src/main/java/com/weav/workspace/application/port/out/GoogleOAuthPort.java` | Adds refresh contract |
| Extended | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/google/GoogleOAuthProvider.java` | Adds fixed-endpoint refresh adapter; file is also part of the accepted Task 7 change |
| Added | `services/workspace-service/src/test/java/com/weav/workspace/application/usecase/InternalConnectionUseCasesTest.java` | Real PostgreSQL persistence with synthetic Google response port |
| Extended | `services/workspace-service/src/test/java/com/weav/workspace/infrastructure/provider/google/GoogleOAuthProviderTest.java` | Local synthetic refresh endpoint fixtures |
| Extended | `services/workspace-service/src/test/java/com/weav/workspace/application/usecase/GoogleOAuthUseCasesTest.java` | Fixture port implements refresh contract |
| Updated | `services/workspace-service/README.md` | Documents application support and pending HTTP routes |
| Added | `docs/work_logs/2026-09-19-workspace-runtime-connection.md` | Task 8 handoff evidence |

The shared worktree also contains accepted Tasks 1-7 and the unchanged untracked plan; this list describes Task 8 ownership only.

## 9. Verification

Commands used an installed Maven distribution, existing local Maven cache, Docker Testcontainers, and UTC timezone configuration:

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml -Dtest=InternalConnectionUseCasesTest,GoogleOAuthProviderTest,GoogleOAuthUseCasesTest test"
```

Result: `PASS; 36/36; 0 failures/errors/skips`. This includes real PostgreSQL integration for runtime state and encrypted credential persistence, local Google HTTP fixtures, expiry boundary, scope alias, transient/confirmed failure handling, lifecycle races, and attachment policy.

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml test"
```

Result: `PASS; 297/297; 0 failures/errors/skips`. The full suite started Docker containers and applied Flyway V1-V3 in integration tests.

`git diff --check` and a targeted trailing-whitespace scan of Task 8 Java, test, README, and log files passed with no whitespace errors. Git printed only line-ending conversion notices for shared tracked Task 1-6 files. No live Google consent or account was used; HTTP fixtures prove adapter protocol handling only.

## 10. Risks and limitations

| Level | Limitation | Current treatment / next step |
| --- | --- | --- |
| Medium | Public/internal HTTP routes are not implemented | Expose these use cases through Task 9 controllers and contract tests |
| Medium | No live OAuth client/account configuration was exercised | Later configure the intended redirect URI and verify through an actual consent flow |
| Low | Duplicate Google refresh requests are intentionally unlocked in V1 | Final persistence rechecks prevent overwriting changed credentials; no cross-request distributed lock is introduced |
| Low | Task 1-7 uncommitted symbols are not fully represented in current GitNexus index | Re-index and run full graph change detection before any later commit |

## 11. Handoff

1. Coordinator review can start with `ResolveConnectionUseCase` and `InternalConnectionUseCasesTest`.
2. Task 9 can expose the use cases; keep refresh tokens out of the runtime response and accept only the typed auth-failure code.
3. Before any future commit, inspect the full shared diff, re-index/stage as required, and run GitNexus `detect_changes`.

## 12. References

- `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, global contracts and Task 8.
- Accepted Task 1-7 logs under `docs/work_logs/2026-09-15-*`, `docs/work_logs/2026-09-16-*`, and `docs/work_logs/2026-09-19-workspace-google-oauth.md`.
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) — refresh POST fields, response, and `invalid_grant` behavior.
- [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes) — Gmail/Sheets and email scope references.
- [Google API Client Library for Java Tokeninfo model](https://developers.google.com/resources/api-libraries/documentation/oauth2/v2/java/latest/com/google/api/services/oauth2/model/Tokeninfo.html) — token scope and audience fields (from the accepted Task 7 verification log).

## 13. End of session

| Field | Value |
| --- | --- |
| Stopped | `2026-09-19 Asia/Saigon` |
| Worktree | `Uncommitted shared Tasks 1-8 work; plan unchanged` |
| Commit / PR | `Not created` |
| Log owner | Workspace runtime connection worker |
| Read before continuing | `Task 8 plan, this log, and current git status` |

## Coordinator acceptance - 2026-09-19

- Task 8 accepted after source review of runtime payload restriction/redaction, refresh classification, final expiry and connection/credential rechecks, attachment policy and typed auth-failure handling.
- Independent Maven selector InternalConnectionUseCasesTest,GoogleOAuthProviderTest,GoogleOAuthUseCasesTest passed: 36 tests, 0 failures/errors/skips, BUILD SUCCESS. Real PostgreSQL/Valkey and synthetic provider fixtures used.
- Worker reported full suite 297/297; coordinator did not repeat the full suite this turn. git diff --check passed with line-ending warnings only.
- Live Google accounts remain unverified; HTTP exposure is Task 9. Final read/check/write operations are not evidence of serializable protection against every simultaneous mutation; tests cover lifecycle changes completed during remote refresh and tolerated duplicate refresh calls.
- No commit created. Pre-commit graph indexing/change analysis remains pending. Next: Task 9 HTTP APIs and OpenAPI contract.
