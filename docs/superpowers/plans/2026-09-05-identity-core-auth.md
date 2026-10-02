# Identity Core Authentication Implementation Plan

> For agentic workers: implement task by task with explicit file ownership and review/test gates. Use an available subagent-driven-development or executing-plans workflow when implementation is authorized; do not assume unavailable skills ran. Checkboxes track future implementation, not work completed by this planning session.

**Goal:** Deliver registration, login, current-user lookup, refresh rotation and logout on the existing Identity foundation.

**Architecture:** Preserve the current domain/application/infrastructure/presentation layout. Plain use cases consume repository, password, token and transaction ports; Spring/JPA/HTTP adapters implement the edges. Identity owns authentication and system roles; Workspace authorization stays in Workspace.

**Tech Stack:** Existing Java 25, Spring Boot 4.1.0, service-local Maven Wrapper, Spring Security/JOSE, BCrypt, Spring Data JPA, Flyway, PostgreSQL, JUnit and Testcontainers.

**Status:** Core-first scope confirmed. Proposed design and ordered implementation plan ready for review; no business code implemented. Read [the design and readiness evidence](../specs/2026-09-05-identity-core-auth-design.md) before executing. Exact bodies of production classes will be developed and reviewed during implementation; this is a design/task plan, not a prevalidated source patch.

## Working rules

- Use the existing task branch `feat/identity-service`, created by the user and verified during document restoration. The original inspected base was `dev` / `5b02417`; recheck HEAD and worktree before implementation. Do not run destructive reset/checkout or remove existing empty files.
- Main Java root below means `services/identity-service/src/main/java/com/weav/identity`; test Java root means `services/identity-service/src/test/java/com/weav/identity`. Paths in task tables are relative to those explicitly defined roots unless a full repository path is shown.
- Existing scaffold files are modified in place. Create only files needed by the core scope. OAuth repository/mapper/controller implementation is excluded from this milestone.
- Run GitNexus upstream impact before every existing symbol edit. Use fresh CLI evidence when MCP serves stale data. UNKNOWN requires text inspection; partial output is incomplete.
- Run failing behavioral tests before implementation where the task changes logic, then focused tests and the milestone gate. No automatic commits during this planning session. Before any later approved commit, review staging and run complete graph change detection.
- Configuration examples contain variable names only; preserve local secret files and existing V1 migration.

## Task 0: Make the baseline reproducible

**Files:** test `TestcontainersConfiguration.java`, `IdentityServiceApplicationTests.java`, `infrastructure/security/SecurityConfigTest.java`; `services/identity-service/pom.xml` only if needed for repeatable test JVM settings; `docs/development/SETUP.md` for the exact Identity test command.

- [ ] Confirm Docker Linux engine availability with `docker version --format '{{.Server.Version}}'`. The engine was unavailable during planning; do not classify this as a source failure.
- [ ] Confirm the target PostgreSQL major using an authorized metadata-only connection before pinning the container tag. Use an explicit matching image tag in Testcontainers, replacing `postgres:latest`.
- [ ] Add a test-only JWT property source using generated secure values, plus explicit issuer/audience and default durations. Use `@ServiceConnection` for disposable PostgreSQL so tests cannot migrate the development Neon database.
- [ ] Run all existing tests with UTC from the service directory. Preserve existing assertions unless the security behavior deliberately changes in Task 6.

```powershell
Set-Location T:\Weav\services\identity-service
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' test
```

Expected: full baseline passes when Docker is available. A Docker failure blocks integration sign-off, not work on pure domain/use-case tests.

## Task 1: Publish the core contract before wiring endpoints

**Files:** create `packages/contracts/http/auth/openapi.yaml` and `packages/contracts/http/auth/README.md`.

- [ ] Encode all five endpoints, request fields, success shapes, statuses, bearer security and shared error schema from design sections 4-7 in OpenAPI. Require JSON content types and explicit maximum lengths. Mark only `/users/me` with bearer security; public auth operations override inherited security.
- [ ] Define UTC date-time strings, UUIDs, nullable public profile fields, `expiresIn` seconds and absolute `refreshExpiresAt`. Reject registration role/status/hash fields with an explicit request binding policy tested in Task 6.
- [ ] Document canonical email policy, unverified email ownership, native/API JSON transport, single-use rotation, idempotent logout and the browser integration gate.
- [ ] Document issuer/audience/algorithm/claim names and the limitation that HMAC verifier keys are signing-capable. No Gateway changes are hidden in this Identity milestone.

Contract example shape (metavariables describe generated credentials, not example secrets):

```text
POST /auth/register -> 201 UserResponse
POST /auth/login -> 200 { accessToken, refreshToken, tokenType, expiresIn, refreshExpiresAt, user }
POST /auth/refresh { refreshToken } -> 200 same token response shape
POST /auth/logout { refreshToken } -> 204 empty body
GET /users/me + Authorization: Bearer <access token> -> 200 UserResponse
```

Gate: compare every contract operation with the later HTTP test inventory; no undocumented success/error route.

## Task 2: Repair aggregate/persistence round trips

**Modify main:** `domain/model/UserSession.java`, `infrastructure/persistence/entity/UserJpaEntity.java`, `infrastructure/persistence/entity/UserSessionJpaEntity.java`, existing `infrastructure/persistence/mapper/UserPersistenceMapper.java`.

**Create main:** `infrastructure/persistence/mapper/UserSessionPersistenceMapper.java`.

**Create tests:** `domain/model/UserSessionTest.java`, `infrastructure/persistence/mapper/UserPersistenceMapperTest.java`, `infrastructure/persistence/mapper/UserSessionPersistenceMapperTest.java`.

- [ ] Add tests that round-trip manually chosen UUIDs/timestamps and preserve every public/domain state field. A restored revoked session must remain inactive; restoring `lastUsedAt` must not replace it with the current time.
- [ ] Add session reconstitution including both nullable historical timestamps. Add `rotateRefreshToken(newHash, now)` with active/expiry checks. Add idempotent `revoke(now)` that also succeeds for an expired session; expiry must not turn logout into an error. Keep existing callers compatible.
- [ ] Add JPA construction/mapping access that preserves supplied IDs and creation times. Keep existing convenience constructors for current tests. Do not generate another identity when mapping an existing domain model.
- [ ] Use explicit mappings for restoration and updates. MapStruct is available, but getters plus fresh-ID constructors are insufficient; either give it a safe full-state construction path or write a small explicit mapper. Do not use reflection.
- [ ] Verify updates preserve identity and immutable fields; JPA auditing and application time ownership must be consistent.

Required test arrangement and assertions:

```text
Given session(id=S, userId=U, revokedAt=R, lastUsedAt=L, createdAt=C, expiresAt=E)
When domain -> JPA -> domain
Then id=S, userId=U, revokedAt=R, lastUsedAt=L, createdAt=C, expiresAt=E
And isActive(now)=false when R is non-null or E <= now

Given active session S with expiration E and old hash H1
When rotated at N to hash H2
Then id and expiration remain S/E; hash=H2; lastUsedAt=N
```

Run: `.\mvnw.cmd '-Dtest=UserSessionTest,UserPersistenceMapperTest,UserSessionPersistenceMapperTest,IdentityCleanArchitectureTest' test`.

## Task 3: Implement persistence adapters and canonical uniqueness

**Modify main:** `domain/port/out/UserRepository.java`, `domain/port/out/UserSessionRepository.java`; existing `infrastructure/persistence/repository/SpringDataUserRepository.java`, `SpringDataUserSessionRepository.java`, `UserRepositoryAdapter.java`, `UserSessionRepositoryAdapter.java`.

**Create migration:** `services/identity-service/src/main/resources/db/migration/V2__unique_canonical_user_email.sql`.

**Modify/create tests:** existing empty `infrastructure/persistence/UserPersistenceIntegrationTest.java`; new `infrastructure/persistence/UserSessionPersistenceIntegrationTest.java`.

- [ ] Add real PostgreSQL tests for create/read/update, nullable OAuth-only password, canonical lookup, duplicate race, and revoked-session reload. Assert the number of user records is unchanged by an update.
- [ ] Implement Spring Data repositories and domain adapters using Task 2 mapping. Resolve canonical lookup with the same expression as the index, including legacy mixed-case/space-padded email rows.
- [ ] Add a repository port operation for locked refresh-hash lookup. Use a JPA write lock inside a surrounding transaction; do not let the adapter's transaction end before rotation finishes.
- [ ] Add V2 with the SQL below. Test both successful migration and failure on an intentionally duplicated canonical-email fixture. Do not edit V1.

```sql
CREATE UNIQUE INDEX uk_users_canonical_email
    ON users (lower(btrim(email)));
```

Deployment preflight (only aggregate counts leave the database):

```sql
SELECT count(*) AS duplicate_groups
FROM (
    SELECT lower(btrim(email))
    FROM identity.users
    GROUP BY lower(btrim(email))
    HAVING count(*) > 1
) AS collisions;
```

- [ ] Translate only the known canonical-email constraint violation into the duplicate-email response; do not classify unrelated DB failures as duplicate email. Flush within the transaction and handle rollback properly.
- [ ] For an existing deployment, require duplicate_groups=0 and count unsupported legacy email forms using the same Task 5 input policy before migration. Keep all row values private; report counts only. If either count is nonzero, stop that deployment step and obtain a data reconciliation decision. Rolling application code back does not require dropping the additive index.

Run: `.\mvnw.cmd '-Dtest=UserPersistenceIntegrationTest,UserSessionPersistenceIntegrationTest,IdentityServiceApplicationTests' test`.

## Task 4: Add password, token and transaction boundaries

**Create main:** `application/port/out/PasswordHasher.java`, `AccessTokenIssuer.java`, `RefreshTokenGenerator.java`, `TransactionRunner.java`; `application/dto/IssuedAccessToken.java`, `GeneratedRefreshToken.java`; `infrastructure/security/BcryptPasswordHasher.java`, `JwtAccessTokenIssuer.java`, `SecureRefreshTokenGenerator.java`; `infrastructure/persistence/SpringTransactionRunner.java`; `infrastructure/config/IdentityApplicationConfig.java`.

**Modify main:** `infrastructure/security/JwtProperties.java`, `SecurityConfig.java`; `services/identity-service/src/main/resources/application.properties` for issuer/audience properties and validation.

**Create tests:** `infrastructure/security/TokenServiceTest.java`, `BcryptPasswordHasherTest.java`, `JwtPropertiesTest.java`.

- [ ] Define the boundary types and pass `Clock` explicitly. Keep Spring/JPA/HTTP out of application/domain; application transaction execution uses `Supplier<T>` and an infrastructure `TransactionTemplate` adapter.
- [ ] Wrap the existing BCrypt encoder. Preserve compatibility with existing BCrypt hashes; reject inputs beyond 72 UTF-8 bytes before encoding. Test 72/73 ASCII bytes and multibyte boundary strings, correct/wrong password and existing hashes.
- [ ] Generate opaque refresh tokens with JDK `SecureRandom`, base64url without padding, and SHA-256 hashes. Plaintext is transient return material, never persistent entity state.
- [ ] Issue HS256 access JWTs using Spring JOSE. Validate configuration early; bound positive expiry settings and validate the access key without logging it. Retain but do not use the existing refresh-secret property.
- [ ] Test real encode/decode, bad signatures, wrong algorithm/issuer/audience/token kind, malformed/missing UUID claims, expired token and future `nbf`. Require numeric `iat`, `nbf`, `exp`; test missing `exp`, wrong claim types, `exp <= iat`, `exp <= nbf` and `iat` beyond a 30-second clock tolerance. Session expiry is strict server time and does not inherit JWT tolerance. Keep fake clocks and generated test keys inside tests.

Boundary sketch for implementation:

```java
public interface TransactionRunner {
    <T> T required(java.util.function.Supplier<T> work);
}

public record IssuedAccessToken(String value, java.time.Instant expiresAt) {}
public record GeneratedRefreshToken(String value, String hash) {}
```

Run: `.\mvnw.cmd '-Dtest=TokenServiceTest,BcryptPasswordHasherTest,JwtPropertiesTest,IdentityCleanArchitectureTest' test`.

## Task 5: Implement register, login and current-user use cases

**Modify main:** existing `application/dto/RegisterUserCommand.java`, `application/usecase/RegisterUserUseCase.java`.

**Create main:** `application/dto/LoginCommand.java`, `AuthenticatedUserResult.java`, `TokenPairResult.java`; `application/usecase/LoginUseCase.java`, `GetCurrentUserUseCase.java`; `application/validation/AuthInputPolicy.java`.

**Create tests:** `application/usecase/RegisterUserUseCaseTest.java`, `LoginUseCaseTest.java`, `GetCurrentUserUseCaseTest.java`.

- [ ] Add tests for canonical duplicate email, role injection resistance, password hashing, absent/null profile values and no leaked password hash. Canonicalization happens once in `AuthInputPolicy`: accept ASCII email identifiers, remove only boundary U+0020 spaces, lowercase with `Locale.ROOT`, and reject other whitespace. This must agree with the PostgreSQL expression in Task 3. Password is never normalized.
- [ ] Register with server-selected USER/ACTIVE, persist only the encoded password and return the public result. Registration returns 201 without a session/token pair.
- [ ] Add login tests for wrong/missing/disabled/OAuth-only accounts returning the same 401 domain result. Use a dummy BCrypt check for absent/unusable password hashes to avoid an obvious fast branch.
- [ ] On valid login, create one session per login using generated refresh hash and absolute seven-day expiration; persist and issue access material under the defined transaction boundary. Failure must not leave a partially created session presented as successful.
- [ ] Implement current user by validated JWT `sub` and `sid`, verifying matching session ownership, active/unexpired/unrevoked session and active user. Never select the target from a request-supplied user ID.

Run: `.\mvnw.cmd '-Dtest=RegisterUserUseCaseTest,LoginUseCaseTest,GetCurrentUserUseCaseTest' test`.

## Task 6: Wire controllers, bearer validation, errors and throttling

**Create main:** `presentation/http/AuthController.java`, `UserController.java`; `presentation/http/request/LoginRequest.java`, `RefreshTokenRequest.java`; `presentation/http/response/TokenResponse.java`; `infrastructure/security/ApiAuthenticationEntryPoint.java`, `ApiAccessDeniedHandler.java`, `AuthRateLimitFilter.java`, `AuthRateLimiter.java`.

**Modify main:** existing `presentation/http/request/RegisterUserRequest.java`, `presentation/http/response/UserResponse.java`, `presentation/http/mapper/UserPresentationMapper.java`, `infrastructure/security/SecurityConfig.java`, `infrastructure/config/IdentityApplicationConfig.java`, and `infrastructure/web/GlobalExceptionHandler.java` only for sanitized auth-related error handling/logging.

**Modify/create tests:** existing `infrastructure/security/SecurityConfigTest.java`, `presentation/http/request/RegisterUserRequestValidationTest.java`; new `presentation/http/AuthControllerTest.java`, `UserControllerTest.java`, `infrastructure/security/AuthRateLimiterTest.java`.

- [ ] Replace HTTP Basic with Spring resource-server JWT support. Permit exactly the four public POST auth operations and health GET routes; default-deny anonymous access elsewhere. Reject malformed bearer credentials consistently; clients call refresh/logout without an expired bearer header.
- [ ] Map request -> command -> use case -> public response. Reject unsupported privileged registration fields. Set no-store on token responses and return an empty 204 for logout.
- [ ] Reuse `ApiErrorResponse` in authentication entry point and access-denied handler. Set bearer challenge headers appropriately. Preserve generic login errors; avoid logging raw DB exceptions that can contain email or token hashes in auth conflict handling.
- [ ] Implement the single-instance limits in design section 7, with an injected clock and atomic window accounting. Cap the map at 10,000 entries; remove expired entries before insertion and reject excess new-key requests with 429 rather than silently disabling limits. Tests cover limits, expiration, capacity and concurrent increments. Do not log account/IP keys.
- [ ] Keep Basic/form/cookie auth off for this API-only milestone. Future cookie auth requires explicit CSRF/transport changes; do not add browser localStorage handling here.
- [ ] Update the old security test's synthetic `/auth/ping` expectation to the actual explicit route policy and add signed JWT tests. Keep password compatibility and default protection assertions.

Run: `.\mvnw.cmd '-Dtest=AuthControllerTest,UserControllerTest,AuthRateLimiterTest,SecurityConfigTest,RegisterUserRequestValidationTest,GlobalExceptionHandlerTest' test`.

## Task 7: Implement atomic refresh and idempotent logout

**Create main:** `application/dto/RefreshTokenCommand.java`; `application/usecase/RefreshSessionUseCase.java`, `LogoutUseCase.java`.

**Modify main:** Task 6 AuthController wiring and Task 3 session adapter/port only as needed for the locked lifecycle operations.

**Create tests:** `application/usecase/RefreshSessionUseCaseTest.java`, `LogoutUseCaseTest.java`; `infrastructure/persistence/RefreshConcurrencyIntegrationTest.java`.

- [ ] Add use-case tests for expiration at exactly now, revoked/unknown token, disabled user, unchanged session ID/absolute expiration, one new refresh hash and persisted last-used time.
- [ ] Implement refresh inside `TransactionRunner.required`: lock by hash, validate session/user, rotate, save, mint access result, commit. The application returns plaintext tokens only after this transaction succeeds.
- [ ] Use two independent transactions/connections synchronized with a barrier to submit the same refresh token concurrently against PostgreSQL. Assert exactly one rotation succeeds, old token fails, new token succeeds, and the loser cannot replace or revoke the winning token.
- [ ] Implement logout using locked lookup and idempotent `revoke(now)`. Unknown, expired or already-revoked well-formed token returns 204; test each case independently. Malformed JSON/token shape returns 400.
- [ ] Add refresh-versus-logout race coverage. Lock order determines the winner; after logout commits against the current token, that session cannot refresh. Document that an already-rotated old token cannot identify its replacement without retained token history.
- [ ] Simulate a committed rotation whose response the client loses: discard the returned replacement, retry the old token and assert 401, then verify a fresh login succeeds. Document re-login as the recovery path; the old inaccessible session expires at its existing absolute deadline. Do not add an unplanned rotation grace period or promise old-token logout revokes a replacement.

Run: `.\mvnw.cmd '-Dtest=RefreshSessionUseCaseTest,LogoutUseCaseTest,RefreshConcurrencyIntegrationTest' test`.

## Task 8: Prove the running HTTP flow and close the milestone

**Create tests:** `presentation/http/CoreAuthHttpIntegrationTest.java`, using a real random-port Spring Boot server and disposable PostgreSQL.

**Modify docs:** `packages/contracts/http/auth/README.md`, `docs/development/SETUP.md`, the current day's work log using `docs/work_logs/log_template.md`.

- [ ] Exercise the real HTTP sequence below without mocked controllers, token verification or repositories. Keep generated credentials/token values in test memory and redact failure output.

```text
register -> 201
same canonical email -> 409
wrong password -> 401 generic error
login -> 200; tokens issued; database contains hash only
GET /users/me with real signed access token -> 200 matching user
refresh old token -> 200 new pair, same session and absolute expiration
refresh old token again -> 401
logout new token -> 204
GET /users/me using that session's access token -> 401
refresh logged-out token -> 401
repeat logout -> 204
```

- [ ] Also cover untrusted role fields, Unicode password byte bounds, DB uniqueness races, expired JWT/session, invalid signature/claims, session ownership mismatch, transaction rollback, 429 envelope and absence of secret fields.
- [ ] Run the full suite once, then package without repeating it. From the service directory:

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' test
.\mvnw.cmd -B '-Dstyle.color=never' -DskipTests package
```

- [ ] From repository root, validate Compose and inspect the complete diff. Run fresh GitNexus change detection before any commit; do not accept partial/truncated output as a clean graph check.

```powershell
docker compose -f compose.yml -f compose.dev.yml config --quiet
git diff --check
git status --short --untracked-files=all
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

- [ ] Record tests, migrations, real HTTP evidence, limitations and changed files. A subsequent development Compose/Neon smoke requires the migration preflight and an authorized development database; it is not implied by passing disposable-database tests.

## Execution ownership and review

Task 0 and contract decisions precede integration-dependent work. After Task 1, persistence/model work (Tasks 2-3) and token primitives (Task 4) can run independently in isolated worktrees with disjoint files. The coordinating reviewer owns shared `SecurityConfig`, configuration and contract files. Merge reviewed foundations before Tasks 5-7; Task 8 runs on the integrated result. Controller wiring may be completed after Task 7 so no intermediate milestone is misrepresented as runnable.

Use a separate logical milestone for Gateway/web/native delivery. That work must test the real Fastify Gateway proxy, browser transport/CSRF, web login-refresh-logout using Playwright and native SecureStore integration. Starter-screen tests are not substitutes for those flows.
