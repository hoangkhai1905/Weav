# Work log - 2026-09-05 Identity core authentication

## 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | `2026-09-05` / `Asia/Saigon` |
| Repository | `T:\\Weav` |
| Branch / base commit | `feat/identity-service` / `c029341` |
| Implementer | Codex coordinator and delegated test workers |
| Reviewer | Codex |
| End state | Core backend slice complete; uncommitted |
| Scope | Register, login, access JWT, refresh rotation, logout, current user |

## 2. Executive summary

Identity now has a runnable core-auth backend slice. It supports email/password registration, login, access JWTs, opaque refresh tokens stored only as SHA-256 hashes, atomic refresh rotation, idempotent logout, and `GET /users/me`. Four auth POST operations and health GET are explicitly public; other routes require bearer authentication.

| Check | Result | Evidence |
| --- | --- | --- |
| Compile/package | PASS | Spring Boot executable jar built |
| Unit/integration tests | PASS | 62 tests, 0 failures/errors/skips |
| Migration/database | PASS | PostgreSQL 18 Testcontainers, Flyway V1/V2, Hibernate validate |
| Real HTTP | PASS | Random-port Tomcat completed the core auth sequence |
| Compose | PASS | Base plus development config validated |
| Commit/PR | None | User did not request a commit |

## 3. Scope and acceptance

In scope:

- Identity application, persistence, security, and HTTP presentation layers.
- Identity-local OpenAPI contract and additive V2 canonical-email index.
- Disposable PostgreSQL verification, database races, and real HTTP integration.

Out of scope:

- Email OTP/recovery, Google OAuth, profile/avatar, admin controls, and session-management UI.
- Gateway and web/mobile token transport, browser cookies, CORS, and CSRF policy.
- Shared multi-replica throttling; this milestone intentionally uses a bounded process-local limiter.
- Applying V2 to development Neon; no live data or secret file was changed.

Acceptance completed:

- [x] Register/login/refresh/logout/current-user work through real HTTP.
- [x] Canonical email uniqueness and refresh rotation are enforced by PostgreSQL.
- [x] JWT, generic auth errors, throttling, and credential/token log redaction are tested.
- [x] Full suite, package, Compose, and diff gates are recorded.

## 4. Technical decisions

| Decision | Reason | Follow-up |
| --- | --- | --- |
| Retain BCrypt | Compatible with the current foundation; enforce 72 UTF-8 byte bound | Treat Argon2 as a separate migration |
| HS256 access JWT | Fits current configuration and Spring JOSE | Keep secret with trusted backends; later consider asymmetric/JWKS |
| 32-byte opaque refresh token | No session data in token; persist hash only | Lost rotation response requires a fresh login |
| Configured absolute session lifetime | Default is seven days without unplanned sliding expiry | `JWT_REFRESH_EXPIRES_IN` controls login expiry; rotation preserves `expiresAt` |
| Pessimistic lock by refresh hash | At most one old-token rotation succeeds | Verified with two real transactions |
| Fixed-window local throttle | Matches the development milestone; atomic and capped at 10,000 keys | Replace/augment at Gateway with Valkey before multi-replica exposure |
| Redacted HTTP record `toString()` | Spring DEBUG stringifies bodies | Prevent plaintext passwords and tokens in framework debug output |

## 5. Changes

### Code and behavior

- Added application DTOs, outbound ports, validation policy, and use cases for all five core operations.
- Completed state-preserving user/session persistence mappers and repository adapters.
- Added JWT issue/validation, BCrypt adapter, secure refresh generator, transaction runner, and Spring wiring.
- Added auth/current-user controllers, strict unknown-field handling, public response mapping, no-store token responses, and JSON security errors.
- Added per-IP and per-account rate limits with `429` and `Retry-After`; forwarded headers are not trusted.
- Added redacted string representations for credential/token HTTP records.
- Final review made duplicate-email conflict translation compatible with both the canonical V2 index and the legacy V1 exact-email constraint.
- Final review wired refresh-session lifetime from `JWT_REFRESH_EXPIRES_IN` and disabled public health-detail disclosure.

### Data and configuration

- Added `V2__unique_canonical_user_email.sql` using `lower(btrim(email))`; V1 remains unchanged.
- Added issuer, audience, access/refresh duration, and clock-skew JWT settings; access keys require at least 32 UTF-8 bytes.
- Test configuration is isolated to schema `identity` and does not fall back to Neon credentials.
- Pinned Testcontainers to `postgres:18-alpine` after a read-only target-major check.

### Contracts and docs

- Added `packages/contracts/http/auth/openapi.yaml` and its README.
- Updated `docs/development/SETUP.md` with Identity secret and disposable-test guidance.

## 6. Affected file groups

| Group | Path |
| --- | --- |
| Contract | `packages/contracts/http/auth/*` |
| Application | `services/identity-service/src/main/java/com/weav/identity/application/**` |
| Domain | `.../domain/model/UserSession.java`, `.../domain/port/out/UserSessionRepository.java` |
| Persistence | `.../infrastructure/persistence/**` |
| Security | `.../infrastructure/security/**` |
| HTTP | `.../presentation/http/**` |
| Migration/config | `services/identity-service/src/main/resources/**`, `src/test/resources/application.properties` |
| Tests | `services/identity-service/src/test/java/**` |
| Docs | `docs/development/SETUP.md`, this work log |

No existing file was deleted.

## 7. Verification evidence

From `services/identity-service`:

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' test
.\mvnw.cmd -B '-Dstyle.color=never' -DskipTests package
```

- Full suite: `62 tests`, `0 failures`, `0 errors`, `0 skipped`, `BUILD SUCCESS`.
- Package: executable `identity-service-0.0.1-SNAPSHOT.jar`, `BUILD SUCCESS`.
- HTTP: register 201; canonical duplicate 409; privileged field 400; bad login 401; login/me/refresh 200; old token 401; logout 204; revoked session/token 401; repeat logout 204.
- Persistence: PostgreSQL 18.6 disposable containers; Flyway V1/V2; canonical-email and exact-email races each produce exactly one winner; same-token concurrent refresh exactly one winner; refresh/logout serialized outcomes.
- Security: limiter/filter tests cover capacity, expiry, concurrency, `429`, and `Retry-After`; debug request/response records show `[REDACTED]`.

From repository root:

```powershell
docker compose -f compose.yml -f compose.dev.yml config --quiet
git diff --check
```

Compose and whitespace checks exited 0. GitNexus impact checks returned no HIGH/CRITICAL result; UNKNOWN Spring/JPA runtime edges were confirmed with targeted text inspection. Final change detection is recorded at handoff.

## 8. Risks and next steps

| Level | Risk/limit | Next action |
| --- | --- | --- |
| Medium | V2 can fail if live data contains canonical duplicates | Run read-only duplicate preflight before development migration |
| Medium | HS256 verifier secret can also sign | Restrict distribution; plan asymmetric/JWKS later |
| Medium | Throttle is process-local | Integrate Gateway/Valkey before public multi-replica use |
| Medium | Browser token transport is not designed | Choose BFF/secure cookie plus CSRF/CORS; do not assume localStorage |
| Low | Local `Asia/Saigon` JVM timezone is rejected by PostgreSQL | Use `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` for tests |
| Low | Test compilation reports deprecated/unchecked warnings | Address in a separate cleanup; runtime is unaffected |

Later V1 phases: email OTP/password recovery, Google OAuth/linking, profile/avatar, session-management endpoints, and admin account controls.

## 9. Handoff

- Worktree contains reviewed, uncommitted changes on `feat/identity-service`.
- Read the design, plan, auth contract, and this log before continuing.
- Before applying V2 to development, run a canonical-email duplicate preflight against the Identity schema.
- No commit or PR was created.

## 10. References

- `docs/superpowers/specs/2026-09-05-identity-core-auth-design.md`
- `docs/superpowers/plans/2026-09-05-identity-core-auth.md`
- `packages/contracts/http/auth/README.md`
- `packages/contracts/http/auth/openapi.yaml`
- `docs/work_logs/2026-09-05-identity-readiness.md`
