# Identity core authentication: readiness and design

Date: 2026-09-05. Inspected checkout: `dev` at `5b02417`.

Status: readiness assessment complete; core-first scope confirmed by the user. Technical choices below are the proposed design for review. This document does not authorize implementation or deployment.

## 1. Readiness verdict

Ready to begin a bounded core-auth implementation. The existing project compiles on Java 25.0.4; six focused tests pass. PostgreSQL integration and a running service have not been verified in this session because Docker Desktop's Linux engine is unavailable.

| Area | Current evidence | Consequence |
| --- | --- | --- |
| Runtime/build | Service-local Maven Wrapper, Spring Boot 4.1.0, Java 25, MapStruct 1.6.3 with annotation processor | Reuse this service; there is no root Maven reactor |
| Domain | `User`, `UserSession`, `OAuthAccount`, enums, exceptions and three repository ports exist | The statement that there are no repositories means no implementations; interfaces already exist |
| Persistence | Three JPA entities and Flyway V1 exist | Implement adapters and mapping; preserve established schema and data |
| Scaffolds | Eleven main-source files are empty, including Spring Data repositories, adapters, registration use case, mappers and response | Fill relevant existing paths; an empty file is not implemented behavior |
| HTTP | `RegisterUserRequest`, error response and exception advice exist; no production business controllers | Define the contract before controller implementation |
| Security | BCrypt bean, HTTP Basic, broad public `/auth/**`; JWT properties only | Implement issuing/validating bearer tokens and explicit route rules |
| Tests | Two ArchUnit, two validation and two error-handler tests passed | These do not prove login, persistence adapters, JWT or refresh behavior |
| Integration tests | Application/Flyway/JPA and security tests require Docker; `UserPersistenceIntegrationTest.java` is empty | Restore Docker availability and add meaningful adapter tests |
| Consumers | Gateway exposes starter `GET /`; web/mobile are starter screens; auth contract directory has only `.gitkeep` | No implemented consumer constrains the proposed token/API contract |
| Compose | `config --quiet` passed; Identity maps host 8081 to container 8080 | Syntax and variable interpolation are valid; connectivity remains unverified |

## 2. Reconciling Notion with the current checkout

| Topic | Notion context | Current decision/evidence |
| --- | --- | --- |
| Ownership | Identity owns user, session, login OAuth, system roles; Workspace owns membership and credentials | Retain these boundaries. Older combined Identity/Workspace diagrams are superseded |
| Database provider | Some tech-stack pages still say Supabase | Repository properties, setup guide and Compose use Neon pooled PostgreSQL |
| Schema | Examples say `identity_schema` | Actual default and tests use `identity`; do not rename it |
| Password algorithm | Notion says Argon2 | Code and current tests use BCrypt. Proposed milestone retains BCrypt; Argon2 is a separate compatibility decision |
| Cache | Redis + TTL | Redis client dependency exists; setup names Aiven Valkey. Identity has no runtime cache configuration. Core scope does not require OTP/cache |
| OAuth/docs | OAuth2 Client and springdoc are in the intended stack | Neither is declared in Identity's POM; add only when those capabilities are implemented |
| Structure | Notion uses feature folders and a root POM | Follow current `domain/model`, `domain/port/out`, `application/usecase`, `infrastructure`, `presentation/http` and the service-local POM |
| Delivery status | Sprint and Todo contain older unfinished items | Use checked-out source and fresh tests to judge implementation status |

## 3. Scope and alternatives

The user selected core email/password auth first, with the rest of V1 phased afterward.

Recommended: deliver one end-to-end backend slice containing registration, login, access JWT, refresh rotation, logout and current-user lookup. It gives a testable foundation for both future clients.

Alternative: implement repositories for all three aggregates first. This is smaller initially, but provides no usable auth flow and spends effort on unused OAuth adapters.

Alternative: implement full Identity V1 together. This requires email delivery, cache, OAuth callbacks, storage and administration decisions. Keep those as separate milestones to make progress independently verifiable.

This milestone owns Identity code/tests, `packages/contracts/http/auth`, relevant configuration documentation and work logs. Gateway and frontend implementation have their own subsequent integration gate. There is no browser or native UI completion claim for this backend milestone.

## 4. Proposed API contract

Identity-local routes; a future Gateway maps its public prefix explicitly.

| Method/path | Input | Success | Authentication |
| --- | --- | --- | --- |
| `POST /auth/register` | email, password, optional displayName | 201, public user response; does not log in automatically | Public, throttled |
| `POST /auth/login` | email, password | 200, token pair and public user | Public, throttled |
| `POST /auth/refresh` | refreshToken | 200, new token pair and public user | Possession of valid refresh token, throttled |
| `POST /auth/logout` | refreshToken | 204, idempotent for unknown/already-revoked well-formed token | Possession of token; no live access token required |
| `GET /users/me` | no user ID supplied by client | 200, public user | Valid access JWT plus active matching user/session |

Public user: `id`, `email`, `displayName`, `avatarStorageKey`, `systemRole`, `status`, `createdAt`, `updatedAt`. Nullable profile fields remain nullable. Never serialize a domain/JPA entity directly. Password hash and refresh hash must not appear in a response.

Token response: `accessToken`, `refreshToken`, `tokenType: Bearer`, `expiresIn` in seconds, `refreshExpiresAt` as UTC timestamp, and `user`. Token responses carry `Cache-Control: no-store`. All auth bodies use JSON. No passwords/tokens in query strings, logs or exception details.

Use existing `ApiErrorResponse`: 400 validation/malformed input; 401 generic invalid credentials/token/account/session; 409 duplicate canonical email; 429 throttled with `Retry-After`; 500 sanitized unexpected error. Wrong password, missing user, OAuth-only user and disabled account return the same login error. Security-filter errors must use this envelope too.

## 5. Application and persistence design

Retain pure domain models and repository ports. Application use cases operate on commands and public result DTOs; Spring Security, JPA and HTTP types stay at the edges. Supply a `Clock` for deterministic time. Wire plain use cases with configuration beans.

Use an application `TransactionRunner` port backed by Spring `TransactionTemplate` for multi-operation transactions and row-lock lifetime. This is a real application boundary, not an interface for every class. Hash passwords before opening the database transaction. Return token material only after the transaction commits successfully.

Required foundation adjustments:

1. Add explicit state-preserving construction/mapping for `UserJpaEntity` and `UserSessionJpaEntity`. Existing convenience constructors can remain. Domain-generated UUIDs and existing creation times must survive save/reload; updating a user must not create another record.
2. Add session rehydration that accepts `revokedAt` and `lastUsedAt`. The current constructor silently cannot represent those persisted states. Preserve null versus populated timestamps exactly.
3. Add session rotation and idempotent revoke operations taking an explicit time. Rotation preserves the session ID and absolute expiration.
4. Implement `UserRepository` and `UserSessionRepository` adapters. Add a locked refresh-token lookup to the session port, with `PESSIMISTIC_WRITE` confined to Spring Data. No OAuth adapter is needed for core auth.
5. Test full domain-to-database-to-domain round trips, including UUID, roles, timestamps, nullable password/profile and revoked sessions. Mapper implementation must not use fresh-ID convenience constructors when restoring state.

Canonicalize email by removing only boundary U+0020 spaces and lowercasing with `Locale.ROOT`. Reject other whitespace rather than allowing Java `strip()` to disagree with PostgreSQL `btrim`. Accept ASCII email identifiers in core auth; internationalized identifiers require an explicit normalization policy. Do not perform provider-specific dot/plus rewriting or rewrite existing account data automatically. Add a V2 expression unique index on `lower(btrim(email))` to enforce concurrent canonical uniqueness. Before applying it to an existing database, perform read-only counts of canonical duplicate groups and unsupported legacy email forms; if either is nonzero, stop deployment and obtain a data-resolution decision. Do not edit V1 or merge/delete users. Preserve existing supported stored email spelling in read responses.

## 6. Password and token choices

Retain the existing BCrypt encoder behind a password-hashing port. Keep current minimum eight characters, enforce the encoder's 72 UTF-8-byte maximum as well as request bounds, and test non-ASCII boundary cases. Do not trim or normalize passwords. Tune cost using the target runtime before public release. Registration always creates `USER` / `ACTIVE`; callers cannot supply role/status/avatar/password hash. Email ownership is unverified in this milestone; later OAuth linking and recovery must not infer ownership from registration alone.

Proposed access JWT: HS256 using the existing `JWT_ACCESS_SECRET`; explicit algorithm allowlist, minimum 32-byte key validation, issuer `weav-identity`, audience `weav-api`, `sub` as user UUID, `sid` as session UUID, `system_role`, `token_use=access`, `iat`, `nbf`, `exp`. Default lifetime 15 minutes. Use Spring JOSE encoder/decoder and validate issuer, audience, expiry, subject/session shape and token kind. HMAC verification secrets also permit signing: restrict distribution to trusted backend components. A later asymmetric-key/JWKS change is a separate rollout.

Proposed refresh token: 32 cryptographically random bytes encoded as unpadded base64url. Store only its SHA-256 hash. Default session lifetime seven days from login, absolute rather than sliding. `JWT_REFRESH_SECRET` can remain as a legacy configuration field but is not used for opaque refresh tokens; do not remove secret configuration from other services or local env files.

Refresh transaction: hash the submitted token, lock the matching session, reject revoked/expired sessions, check active user, generate a replacement refresh token, update the stored hash and `lastUsedAt`, mint access JWT, commit, return. Two concurrent requests using the same token must produce at most one successful rotation. The losing request must not overwrite or revoke the winner's current session.

This provides single-use rotation and old-token rejection. Historical token-family reuse detection is not claimed; it requires additional retained token history. Logout revokes the current session and is repeatable, including when the session has already expired. Expiry prevents rotation, not idempotent revocation. `/users/me` checks the session and user, so logout/disable is effective there immediately. Other future JWT-only consumers may accept a previously issued access token until its expiration unless they implement revocation checks.

Require the presence and numeric-date types of `iat`, `nbf` and `exp`; reject `exp <= iat`, `exp <= nbf` and issuance times beyond a configured 30-second clock tolerance. Test missing/invalid claims separately from expired-token rejection. Session expiration uses the server clock strictly; it does not inherit JWT clock tolerance.

If the refresh transaction commits but the response is lost, the retained old token cannot be retried successfully. Core milestone recovery is a new login; the inaccessible old session expires at its original deadline. Do not silently retry rotation or claim that logout with the old token revokes the replacement. Token-history or idempotency support can improve recovery in a later milestone.

## 7. Transport and exposure boundaries

The core service is a bearer/JSON API tested through HTTP clients and native-compatible contracts. It does not use cookies for authentication and does not implement browser token persistence. Keep CSRF disabled only while all credentials are explicitly supplied in JSON or bearer headers and Basic/form login are disabled.

Before browser delivery, define and test a secure refresh-cookie or BFF transport with CSRF protection, explicit allowed origins and Gateway proxy behavior. Do not persist refresh tokens in browser localStorage as an implicit consequence of this API. Native delivery can store refresh material in the already-declared Expo SecureStore. These clients are follow-up work, not prerequisites for testing this service directly.

Add a bounded single-instance auth throttle for this development milestone: per remote IP, 20 login attempts/minute, 5 registrations/minute and 30 refresh attempts/minute; per canonical account key, 10 login attempts/15 minutes. Return 429 before costly password hashing when exceeded. Use a clock, expiring windows, a capped map and deterministic tests. Do not trust forwarded headers until a trusted proxy is configured. Shared throttling across replicas belongs to the Gateway/Valkey integration gate; do not expose this milestone as a complete public multi-instance auth system.

## 8. Validation and completion gates

Baseline command already run from `services/identity-service`:

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=IdentityCleanArchitectureTest,RegisterUserRequestValidationTest,GlobalExceptionHandlerTest' test
```

Result: main/test compilation completed; 6 tests, 0 failures, 0 errors, 0 skipped. Docker-dependent tests not run. `docker compose -f compose.yml -f compose.dev.yml config --quiet` passed.

Implementation gate: all focused and full tests pass against disposable PostgreSQL, V1/V2 migrate and Hibernate validates, concurrent refresh and duplicate registration are exercised, actual random-port HTTP auth sequence succeeds, and secret/role/error/rollback tests pass. Test JWT configuration must use generated nonproduction values; tests must not fall back to Neon credentials. Pin the PostgreSQL test image after confirming the target database major instead of leaving `postgres:latest`.

GitNexus refresh succeeded locally, but FTS remains unavailable and the long-lived MCP reports its old index. MCP impact for UserSession/UserJpaEntity/SecurityConfig returned UNKNOWN/partial, not an all-clear. Fresh CLI UserSession impact returned LOW with one direct caller (`createNew`) and zero processes. Text inspection confirms session repository ports and existing JPA/security tests as relevant consumers. Rerun fresh upstream impact for every existing symbol at implementation time; warn before HIGH/CRITICAL changes. No code symbol was edited during this assessment.

## 9. Subsequent Identity milestones

1. Email verification/OTP and password recovery using Valkey TTL and an agreed mail provider; single-use state, resend/attempt limits, ownership proof and session revocation policy.
2. Google login and safe explicit account linking; provider credentials, callbacks, verified-email policy and OAuth2 Client dependency.
3. Profile editing/avatar lifecycle and session list/revoke-all; storage provider and upload constraints.
4. Admin enable/disable accounts; controlled admin provisioning and authorization/audit coverage.
5. Gateway/web/native delivery integration with secure session transport and real client acceptance tests; this can follow core auth before the other optional Identity features.

## 10. Sources

- [Identity schema V1](https://app.notion.com/p/3bd8722217d580b7b5d3c26e86ffaab3).
- [Identity tech stack](https://app.notion.com/p/3bf8722217d580679395c56c0c1ec82a).
- [Current service boundaries](https://app.notion.com/p/3ba8722217d580afb13aed54d596463e).
- [Class ownership in Diagrams](https://app.notion.com/p/3ba8722217d580809d5dd3e3fac9dfd8).
- `docs/work_logs/2026-09-01.md`, `docs/work_logs/2026-09-02-clean-architecture-refactor.md`, `docs/development/SETUP.md` and inspected source.
- [Spring Security JWT configuration](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html): encoder/decoder/resource-server wiring and issuer/audience validation.
- [Spring Security password storage](https://docs.spring.io/spring-security/reference/features/authentication/password-storage.html): password encoder integration and adaptive hashing.
