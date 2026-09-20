# Nhật ký làm việc - Workspace Google OAuth Foundation

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-19` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workspace-service` / `b1154a8` |
| Người thực hiện | `Workspace Google OAuth worker` |
| Người review / nhận bàn giao | `Coordinator /root` |
| Trạng thái cuối ngày | `Hoàn thành Task 7; chờ coordinator review` |
| Phạm vi session | `Google OAuth foundation and one-time state only` |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, Task 7 lines 1100-1284 |

## 2. Tóm tắt điều hành

### Kết quả chính

- Added server-owned Google authorization-code start/callback use cases with live membership/manage checks and Task 6 member-only connection usage protection.
- Added exact Gmail and Sheets scope policies, Google provider verification, encrypted OAuth credential persistence, and atomic one-time Valkey state with a 10-minute default TTL and fail-closed outage handling.
- Added local HTTP provider fixtures, real Valkey state tests, injected PostgreSQL lifecycle tests, safe configuration documentation, and a focused work log.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Installed Maven `test-compile`; Java 25 |
| Unit / integration test | `PASS` | Focused OAuth 30/30; full Workspace 280/280, zero failures/errors/skips |
| Migration / database | `PASS` | Full Testcontainers suite applied existing Flyway V1-V3; Task 7 adds no migration |
| Health check | `Chưa kiểm tra` | No Task 7 public OAuth route exists |
| Review thay đổi | `Đã kiểm tra` | Focused source review and `git diff --check`; no commit |
| Commit / PR | `Chưa tạo` | Coordinator requested an uncommitted handoff |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Implement only Task 7's Google OAuth foundation and one-time state flow.
2. Prove OAuth provider behavior with synthetic local HTTP fixtures and prove Redis/Valkey plus PostgreSQL lifecycle behavior with Testcontainers.
3. Document configuration, security boundaries, runtime limits, and exact test evidence for coordinator review.

### Trong phạm vi

- Google OAuth and OAuth state ports/DTOs, exact scope policy, Google provider adapters, properties, Redis state storage, start/callback use cases, Workspace configuration and credential-codec OAuth shape support.
- OAuth unit/provider/state/persistence tests, Workspace README, and this work log.

### Ngoài phạm vi / chủ động chưa làm

- No Task 8 token resolution/refresh or connection attachment/auth-failure endpoints.
- No Task 9 public controllers or UI/browser acceptance; no generic OAuth framework or generic provider-grant abstraction.
- No real Google account, live consent, real credential, `.env` file, or provider-account write was used. No commit, push, or branch/worktree operation was made.
- The untracked agent-ready plan and pre-existing Task 1-6 changes were preserved; the pre-existing deleted `packages/contracts/http/workflow/.gitkeep` was not touched.

### Tiêu chí hoàn thành

- [x] Gmail asks only for `openid`, `email`, and `gmail.metadata`; Sheets asks only for `openid`, `email`, and `spreadsheets`.
- [x] Callback state is atomic and one-time in Valkey; callback checks state, current membership/manage permission, provider/workspace match, required scopes, and Workflow usage before final persistence.
- [x] Tokens are encrypted at rest, missing refresh token never reuses an older refresh token, and transient failures preserve the previous credential.
- [x] Focused provider/Valkey/PostgreSQL tests, full Workspace regression, documentation, and diff checks pass.

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Tasks 1-6 are accepted but remain uncommitted in this shared worktree. PostgreSQL owns connection/credential data. Task 6's `ConnectionUsageProtection` checks live local authorization, performs Workflow usage checks outside transactions, then reauthorizes before writes.
- **Giả định đã dùng:** Workspace is a confidential Google OAuth web client. The authorization-code exchange uses the configured client secret, so this task does not introduce PKCE; Google redirect URI and frontend return URL come only from server configuration.
- **Ràng buộc:** Redis/Valkey is the only OAuth callback-state authority. State is a random 256-bit URL-safe value; Redis stores only workspaceId, connectionId, userId, and provider. A Redis outage fails closed. No plaintext OAuth token is placed in Redis, logs, exceptions, DTO diagnostics, or test output.
- **Nguồn sự thật:** Task 7 in the agent-ready plan, current Workspace code/configuration, and the 2026-09-15/16 connection, credential, provider-verification, and usage-protection logs. Google protocol details were checked against [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail users.getProfile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile), and the [Google OAuth2 tokeninfo API method](https://developers.google.com/resources/api-libraries/documentation/oauth2/v2/java/latest/com/google/api/services/oauth2/Oauth2.Tokeninfo.html).

## 5. Nhật ký theo session / thời gian

### Session 1 - Task 7 implementation and verification

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| `16:00` | Read Task 7, repo guidance, Workspace README, prior accepted logs, and worktree state | Confirmed untracked plan and Task 1-6 edits; preserved them | Xong |
| `16:05` | Ran GitNexus upstream impact before edits | `Connection` and `Credential` reported `CRITICAL` and were not edited; configuration/codec/registry symbols were `UNKNOWN` or unindexed and manually corroborated in source | Xong |
| `16:10` | Added Google OAuth ports, DTOs, scope policy, properties, provider adapters, state store, use cases, codec support, and Spring wiring | Server-controlled redirect; fixed Google endpoints; finite HTTP deadlines; redirects disabled; safe error classification | Xong |
| `16:19` | Added Google scope/HTTP fixtures and Valkey/PostgreSQL lifecycle tests | 28/28 focused tests passed using synthetic values and local/Testcontainers fixtures | Xong |
| `16:26` | Ran complete Workspace regression | 278/278 tests passed; 0 failures, 0 errors, 0 skipped | Xong |
| `16:27` | Updated README and work log; reviewed diff and whitespace | No public OAuth route or live Google flow claimed | Xong |
| `16:28` | Captured access-token expiry from exchange receipt and guarded against a token expiring during verification | Persistence uses the returned lifetime from issuance time, not a later database-write time | Xong |
| `16:37` | Re-ran focused OAuth tests after aligning the expiry assertion with PostgreSQL timestamp precision | 28/28 passed; 0 failures, 0 errors, 0 skipped | Xong |
| `16:39` | Re-ran full Workspace regression after the final expiry adjustment | 278/278 passed; 0 failures, 0 errors, 0 skipped | Xong |
| `16:40` | Re-ran diff and trailing-whitespace checks | `git diff --check` exited 0; the Task 7 whitespace scan found no matches | Xong |
| `17:00` | Added a second access-token expiry check inside the final mutation and deterministic time control to the lifecycle test | The member callback expires the token during Workflow usage check #3; prior credential and disabled status are preserved | Xong |
| `17:03` | Checked Google OIDC scopes and OAuth2 API v2 tokeninfo method against the official discovery document and Java SDK | Accepts `email` / `userinfo.email` as equivalent for validation; uses documented POST with `access_token` query parameter | Xong |
| `17:06` | Re-ran focused OAuth regression | 30/30 passed; 0 failures, 0 errors, 0 skipped | Xong |
| `17:08` | Re-ran full Workspace regression | 280/280 passed; 0 failures, 0 errors, 0 skipped | Xong |

### Diễn giải quan trọng

- `StartConnectionOAuthUseCase` builds the configured Google authorization URL, applies member usage protection, reauthorizes in a short local transaction to disable the connection, then stores one-time state in Valkey. If the state write fails, the connection remains disabled and no URL is returned.
- `CompleteConnectionOAuthUseCase` consumes state before processing denial or code input; checks the bound connection/provider and live permissions; exchanges and verifies outside the short database transaction; checks live membership and usage again; then atomically stores encrypted credentials and activates the connection. Confirmed authentication failure marks the connection `INVALID` while retaining the previous credential. Transient exchange/verification failure, missing refresh token, insufficient scopes, or usage protection does not replace a stored credential.
- `Credential.expiresAt` is derived from the token exchange receipt plus Google's `expires_in`. Expiry is checked after provider verification and again inside the final local mutation after the Workflow usage check, before credential/status writes. An expired token leaves the prior credential and disabled connection status intact.
- PostgreSQL stores timestamps to microsecond precision, so the expiry integration assertion tolerates up to one second around the exchange receipt while still asserting that the deliberately delayed verification did not extend the token lifetime.
- Google documents the short OIDC `email` scope and the URI scope `https://www.googleapis.com/auth/userinfo.email`; the callback validation treats these spellings as equivalent while keeping the requested scope string and persisted granted-scope list unchanged.
- The official OAuth2 API v2 discovery document defines access-token `tokeninfo` as `POST /oauth2/v2/tokeninfo` with `access_token` in the query. The Java SDK exposes that parameter through `Oauth2.Tokeninfo.setAccessToken`; GET plus a Bearer header is not the documented transport for this access-token validation method. The app sends this fixed Google request over HTTPS and does not log the request URI or propagate transport diagnostics.
- State consumption uses a Lua GET+DEL operation. Unknown fields, duplicate JSON fields, trailing JSON, malformed values, expiration, replay, concurrency, and Redis outage are covered. There is no process-memory fallback.
- One initial test assertion expected the wrong `ResourceNotFoundException` message. It was corrected to assert the safe stable prefix, then the focused suite and full suite passed.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Keep an exact provider-specific scope allow-list | Gmail needs metadata/profile verification; Sheets needs the `spreadsheets` scope. Gmail send and broad Drive access are not needed now. | Broad Drive scope or Gmail send permission | Expand only when a matching product operation ships, then require consent again. |
| Normalize Google's email-scope aliases during grant validation | Google OIDC examples request `email` and show the response scope may include `https://www.googleapis.com/auth/userinfo.email`; the OAuth2 scope catalog and API discovery use the URI spelling. | Require the short string to be byte-for-byte present in every response | Treat the documented URI and OIDC alias as equivalent for validation only; authorization still requests `email` and stored `grantedScopes` preserve Google's response. |
| Match the documented OAuth2 API v2 `tokeninfo` access-token request | Google API discovery declares `POST /oauth2/v2/tokeninfo` and places `access_token` in the query; the Java SDK exposes `setAccessToken`. | POST a form-body parameter or assume GET with a Bearer header | Use the fixed OAuth2 API v2 endpoint and encoded query parameter; do not log outbound URIs or expose provider exception text. |
| Store callback state only in Valkey and consume it atomically | Concurrent callbacks must have one winner; process-local fallback would break replay protection across service instances. | GET followed by DEL from the application, or in-memory fallback | Lua GET+DEL runs atomically; outage is a sanitized dependency failure. |
| Reject a token exchange with no refresh token | A new account's access token must never be paired with an old account's refresh token. | Reuse the previous refresh token | Keep existing credential untouched and leave the reauthorization disabled until the user reconnects with offline access. |
| Use configured redirects and fixed Google endpoints | API clients cannot choose callback/return URLs; redirects can carry OAuth codes or bearer credentials. | Client-supplied redirect or provider-selected endpoint | Redirect URIs are validated at startup; provider transport has 3s connect/5s read deadlines and redirect following disabled. |
| Anchor `Credential.expiresAt` at exchange receipt and recheck at the final write boundary | Google `expires_in` is relative to token issuance; the final member Workflow usage check can add delay. | Compute expiry at final persistence or check only before the final remote call | Reauthorization never extends token lifetime; a final in-transaction check rejects expiry and preserves existing credential/status. |
| Keep remote exchange and verification outside database transactions | Google/Workflow latency must not hold a connection transaction; live membership and usage are rechecked before persistence. | One long transaction around remote calls | Preserves short transactions; a cross-service usage change after the last check remains the existing Task 6 race boundary. |
| Treat only confirmed auth failures as `INVALID` | Gmail 401 and tokeninfo invalid-token/scope/audience evidence are confirmed; 429/5xx/network/oversized or malformed responses are transient/dependency failures. | Treat every non-2xx or parse problem as an invalid credential | Transient failures preserve existing encrypted credential and safe disabled status. |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- Added `application/port/out/GoogleOAuthPort.java` and `OAuthStateStore.java`; added `OAuthPendingState`, `OAuthAuthorizationResponse`, and validated/redacted `GoogleOAuthTokenResponse` DTOs.
- Added `GoogleOAuthScopePolicy` with exact Gmail and Sheets requested scopes plus validation for Google's documented `email` / `userinfo.email` aliases.
- Added `RedisOAuthStateStore` with key prefix `workspace:oauth-state:`, 256-bit state validation, configured TTL, strict payload parsing, atomic consume, and fail-closed dependency handling.
- Added `GoogleOAuthProvider` using the fixed Google authorization, token, Gmail profile, and OAuth2 API v2 tokeninfo endpoints; tokeninfo uses the documented POST/query access-token parameter. Authorization-code form data, tokens, bearer headers, and response bodies are never propagated in errors.
- Added `GoogleConnectionProvider` for `GMAIL` and `GOOGLE_SHEETS`; registered both in `WorkspaceApplicationConfig` and injected them through the existing registry.
- Added `GoogleOAuthProperties` and production/test OAuth properties with safe defaults and redacted diagnostics.
- Added `StartConnectionOAuthUseCase` and `CompleteConnectionOAuthUseCase`; callback state, membership, manage permission, provider, required scope, usage, encryption, and final persistence are checked in the stated order. Access-token expiry is anchored at exchange receipt and rechecked inside the final mutation before writes.
- Added explicit Google OAuth credential encode/decode to `CredentialPayloadCodec`; manual credential encode continues to reject OAuth payloads.
- Updated Workspace README to distinguish the app-level foundation from pending public routes and runtime token resolution/refresh.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Existing `workspace` schema.
- **Migration:** None in Task 7; full tests applied existing Flyway V1-V3.
- **Data:** Integration tests use synthetic users, connections, tokens, local Workflow fixtures, PostgreSQL Testcontainers, and Valkey Testcontainers.
- **Tính tương thích:** Existing credential row identity and `createdAt` are preserved on successful OAuth rotation. `Credential.expiresAt` stores access-token expiry. No API route or database contract was changed.

### 7.3. Cấu hình, hạ tầng và dependency

- Added `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `GOOGLE_OAUTH_FRONTEND_RETURN_URL`, and `GOOGLE_OAUTH_STATE_TTL` configuration names. Defaults are documented in the Workspace README; secret values remain in a local/deployment secret manager.
- Uses the existing Spring Data Redis/Valkey client and existing encrypted credential codec/crypto ports. No dependency was added.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** No HTTP route was added. Use cases are wired for the later controller task.
- **Security:** Start/callback use the authenticated actor and current connection-management authorization. Callback state binds workspace, connection, user, and provider. Member usage checks remain fail closed; owners skip the member-only check per Task 6.
- **Validation/error response:** Server configuration owns redirect URIs; exact scopes and strict token/state response shapes are enforced. User-facing exceptions contain stable sanitized messages only.
- **Logging:** No new OAuth payload logging. DTO and config `toString()` redact authorization URLs/client credentials/tokens.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/port/out/GoogleOAuthPort.java` | Google authorize/exchange/verify boundary | No generic grant framework |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/port/out/OAuthStateStore.java` | One-time state storage contract | Valkey is authoritative |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/OAuthPendingState.java` | Four-field non-secret state payload | Contains no code/token |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/OAuthAuthorizationResponse.java` | Start response with redacted diagnostics | URL is not logged by `toString()` |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/dto/GoogleOAuthTokenResponse.java` | Validated token response with safe diagnostics | Token values are redacted |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/service/GoogleOAuthScopePolicy.java` | Least-privilege Gmail/Sheets scope matrix | No Gmail send or broad Drive scope |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/StartConnectionOAuthUseCase.java` | Authorized, guarded OAuth start | No HTTP controller yet |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/CompleteConnectionOAuthUseCase.java` | Consume, verify, encrypt, and persist callback | Remote calls outside short transactions |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/cache/RedisOAuthStateStore.java` | Atomic Valkey state lifecycle | No in-memory fallback |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/config/GoogleOAuthProperties.java` | Validated and redacted Google client properties | Only server-owned redirect values |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/google/GoogleOAuthProvider.java` | Fixed endpoint HTTP/token adapter | 3s/5s deadlines, no redirects, bounded body |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/google/GoogleConnectionProvider.java` | Gmail/Sheets verification adapters | Existing provider registry reused |
| `Sửa` | `services/workspace-service/src/main/java/com/weav/workspace/application/service/CredentialPayloadCodec.java` | Server-only OAuth payload codec support | Manual writes still reject OAuth shape |
| `Sửa` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/config/WorkspaceApplicationConfig.java` | Google properties, client, state, and provider beans | File also contains accepted Task 1-6 wiring |
| `Sửa` | `services/workspace-service/src/main/resources/application.properties` | Production Google OAuth property names/defaults | No secret values |
| `Sửa` | `services/workspace-service/src/test/resources/application.properties` | Synthetic OAuth test configuration | Test-only client values |
| `Sửa` | `services/workspace-service/README.md` | App-level OAuth status and configuration documentation | Calls out pending routes/token refresh |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/application/service/GoogleOAuthScopePolicyTest.java` | Scope matrix and rejection tests | No live Google calls |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/infrastructure/provider/google/GoogleOAuthProviderTest.java` | Local HTTP endpoint/protocol/error fixtures | Synthetic values only |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/infrastructure/cache/RedisOAuthStateStoreTest.java` | Valkey TTL, replay, concurrency, and outage tests | Real Valkey Testcontainers |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/application/usecase/GoogleOAuthUseCasesTest.java` | PostgreSQL/Valkey start/callback lifecycle | Synthetic Google port + local Workflow fixture |
| `Thêm` | `docs/work_logs/2026-09-19-workspace-google-oauth.md` | Task 7 decisions/evidence/handoff | This log |

## 9. Kiểm tra và bằng chứng

The first sandbox compile could not read the configured Maven cache (`AccessDeniedException`). The same repository-documented installed Maven command was rerun with approved access. All final runs used UTC and the local Maven cache.

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml -DskipTests test-compile"
```

Result: `PASS`.

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml -Dtest=GoogleOAuthScopePolicyTest,GoogleOAuthProviderTest,RedisOAuthStateStoreTest,GoogleOAuthUseCasesTest test"
```

Result: `PASS; 30/30; 0 failures/errors/skips`. This includes local Google HTTP fixtures, real Valkey expiry/replay/concurrency, deterministic expiry during the final Workflow usage check, email-scope alias validation, and PostgreSQL persistence with synthetic Google responses.

```powershell
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -f services\workspace-service\pom.xml test"
```

Result: `PASS; 280/280; 0 failures/errors/skips`. Full Workspace suite ran with Docker/Testcontainers enabled and applied existing Flyway V1-V3.

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Static/diff check | `git diff --check` plus whitespace scan of Task 7 additions | `PASS` | Shared worktree also contains accepted Task 1-6 changes and a pre-existing deletion |
| GitNexus | Upstream `impact` before editing | `Connection`, `Credential`: `CRITICAL`; not edited. `CompleteConnectionOAuthUseCase`, `GoogleOAuthScopePolicy`, and `GoogleOAuthProvider` were absent from the index (`UNKNOWN`); targeted text search confirmed Spring wiring/provider-policy call sites and tests. `WorkspaceApplicationConfig` returned no resolvable callers (`UNKNOWN`) and its bean wiring was manually inspected. | Index points at b1154a8 and is stale for the shared uncommitted Task 1-7 files; no `detect_changes` run because there is no commit in this task |
| Live Google | No live consent or provider account call | `Not run` | Local HTTP fixtures establish adapter protocol behavior only |
| Browser/UI | No public OAuth route/controller in Task 7 | `Not run` | Task 9 owns public endpoints and later UI acceptance |

### Điều chưa được kiểm tra

- No deployed Google client, live consent, live Google token exchange, or real Gmail/Sheets account was configured. Test fixtures do not prove external account configuration.
- No public callback URL or browser route exists yet; full authenticated browser acceptance belongs to Task 9 after controller/UI work.
- GitNexus index does not include all Task 1-7 untracked symbols. Coordinator should re-index/stage as required and run complete change detection before any later commit.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| `Trung bình` | Sandbox Maven invocation could not resolve the configured cache JAR | `AccessDeniedException` under the configured user Maven cache | Reran the documented command with approved access; test-compile, focused tests, and full regression passed | Coordinator can reuse the documented command |
| `Trung bình` | Public OAuth start/callback is not callable by clients | Controller work is Task 9 and out of scope here | Use cases are wired and tested directly | Task 9 / coordinator |
| `Thấp` | Workflow usage can change after the last remote usage check | Existing cross-service check/write race documented in Task 6 | Recheck membership and usage after Google exchange/verification, immediately before local write | Existing Task 6 limitation; do not claim a global distributed lock |
| `Trung bình` | OAuth2 API v2 requires the target access token as a query parameter for `tokeninfo` | The official discovery document assigns `access_token` to `location: query` on POST | Uses the fixed HTTPS Google endpoint, sanitized errors, and no request-URI logging | Review future HTTP tracing/proxy diagnostics to ensure query values remain redacted |

### Lỗi có thể tái lập

```text
Sandbox compilation may fail while resolving a JAR from the local Maven cache. The documented installed-Maven command with approved cache access succeeds.
```

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator can review the Task 7 files and preserve the shared uncommitted Task 1-6 changes.
2. Task 8 can add runtime token resolution/refresh without changing the one-time state payload or weakening fail-closed Redis handling.
3. Task 9 can expose start/callback controllers using the configured redirect values and authenticated actor; add real browser acceptance only after the UI route is available.
4. Before a later commit, re-index/stage as requested, rerun GitNexus `detect_changes`, and review the full combined worktree diff.

### Cần quyết định / quyền truy cập từ người khác

- Live Google acceptance still needs a real OAuth web client and registered server callback URI in the intended environment. No credentials or account were provided or used in this task.

### Hướng dẫn cho AI agent tiếp theo

- Read this log, Task 7 in the agent-ready plan, `AGENTS.md`, and `git status` before editing.
- Treat all current Task 1-7 worktree content as shared and uncommitted. The agent-ready plan remains untracked and unchanged; the existing `.gitkeep` deletion was not part of Task 7.
- Do not add OAuth tokens to Redis, logs, exceptions, test output, or API diagnostics. Do not treat a transient provider error as confirmed credential invalidity.

## 12. Tham chiếu

- `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, Task 7.
- `docs/work_logs/2026-09-15-workspace-connection-domain.md`.
- `docs/work_logs/2026-09-15-workspace-connection-persistence.md`.
- `docs/work_logs/2026-09-15-workspace-connection-usecases.md`.
- `docs/work_logs/2026-09-15-workspace-credential-lifecycle.md`.
- `docs/work_logs/2026-09-16-workspace-connection-usage-protection.md`.
- `docs/work_logs/2026-09-16-workspace-provider-verification.md`.
- [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server).
- [Google OpenID Connect guide](https://developers.google.com/identity/openid-connect/openid-connect) and [OAuth 2.0 Scopes for Google APIs](https://developers.google.com/identity/protocols/oauth2/scopes).
- [Gmail users.getProfile](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/getProfile).
- [Google OAuth2 tokeninfo API method](https://developers.google.com/resources/api-libraries/documentation/oauth2/v2/java/latest/com/google/api/services/oauth2/Oauth2.Tokeninfo.html).
- [Google OAuth2 API v2 discovery document](https://www.googleapis.com/discovery/v1/apis/oauth2/v2/rest) (`tokeninfo` method: POST; `access_token`: query parameter).

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-19 Asia/Saigon` |
| Trạng thái worktree | `Có thay đổi chưa commit; Task 1-7 shared worktree content` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Workspace Google OAuth worker` |
| Cần đọc trước khi tiếp tục | `Mục 11, Task 7 plan, git status` |

---

## Checklist trước khi đóng log

- [x] Summary states completed and not-yet-completed work.
- [x] Material security and lifecycle decisions include reasons.
- [x] Affected files and configuration names are listed without secret values.
- [x] Test commands and actual pass counts are recorded.
- [x] Risks, next owners, and live-provider/browser limitations are explicit.
- [x] No secrets, tokens, connection strings, cookies, or user data are recorded.
- [x] Worktree and commit status are accurate; no commit or PR was created.

## Coordinator acceptance - 2026-09-19

- Task 7 accepted after source review of final transactional expiry check, deterministic Workflow-wait regression, scope alias validation, and tokeninfo transport/error handling.
- Independent focused Maven run: GoogleOAuthScopePolicyTest, GoogleOAuthProviderTest, RedisOAuthStateStoreTest, GoogleOAuthUseCasesTest: 30 tests, 0 failures/errors/skips, BUILD SUCCESS. Real PostgreSQL and Valkey containers plus synthetic HTTP fixtures used.
- Worker reported full Workspace regression 280/280; coordinator did not repeat the full suite this turn. git diff --check passed (line-ending warnings only).
- Live Google consent remains unverified. Task 8 runtime resolve/refresh is next; Task 9 controllers remain pending. No commit; graph change detection remains required before committing.
