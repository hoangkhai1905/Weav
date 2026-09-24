# Identity Core Authentication - Readiness and Implementation Worklogs

<!-- Source worklog bodies are retained below in chronological order. -->

---

<a id="source-2026-09-05-identity-readiness"></a>

## Source worklog: 2026-09-05-identity-readiness.md

# Work log - 2026-09-05 Identity readiness and planning

## 1. Metadata

| Field | Value |
| --- | --- |
| Date/timezone | 2026-09-05 / Asia/Saigon |
| Repository | T:\Weav |
| Initial branch/commit | dev / 5b02417 |
| Initial worktree | Clean |
| Author/reviewer | Codex; independent read-only consumer review by Hooke; user reviews proposed design |
| Scope | Consume existing Notion context, inspect readiness, write core-auth plan |
| Final status | Assessment and planning complete; implementation pending |

## 2. Executive summary

Identity is ready for core-auth development from its current foundation. User confirmed register/login/refresh/logout/current-user first, with remaining V1 features in later phases. Java compilation and six non-Docker tests passed. Docker Linux engine was unavailable, preventing current database/runtime verification.

| Check | Result | Limit |
| --- | --- | --- |
| Main/test compilation | PASS | Existing sources; no new business implementation |
| Focused tests | PASS: 6, no failures/errors/skips | Architecture, validation, error advice |
| PostgreSQL/full integration | BLOCKED | Docker engine unavailable |
| Compose configuration | PASS | No connectivity proof |
| Runtime health/login | Not verified | No business auth routes implemented |
| Commit/PR | None | Documentation handoff only |

## 3. Objectives and scope

- Confirm what exists versus empty scaffolds and reconcile stale Notion details.
- Identify foundational changes needed by core auth and define phased implementation/acceptance criteria.
- Write reviewable design, plan and handoff log. No production code, schema, secret-file, Gateway or frontend edits.

## 4. Context and assumptions

Relevant Notion pages were fetched earlier in this conversation: Identity V1 schema, Identity stack, service-boundary baseline, Full Tree Diagram and class ownership. Source/configuration override stale deployment details. Repository confirms Neon and schema `identity`; Notion's Supabase, `identity_schema` and Argon2 entries do not describe the current implementation. Prior memory guided lookup of foundation logs; current source and fresh tests support the assessment.

## 5. Session record

| Action | Evidence | Status |
| --- | --- | --- |
| Read workspace instructions/skills and history | AGENTS, work-log template, foundation logs, brainstorming/writing-plans and parallel/GitNexus guidance | Complete |
| Inspect Identity | Domain/ports, JPA/V1, request/error/security setup, empty files and tests | Complete |
| Independent consumer review | Gateway starter only, web/mobile starter screens, empty auth contract | Complete |
| Ask milestone scope | User chose core auth first | Confirmed |
| Run focused test baseline | 38 main and 8 test source files compiled; 6 tests passed | Complete |
| Check Docker and Compose | Engine pipe missing; Compose config quiet passes | Integration blocked |
| Refresh graph and query impact | Local refresh succeeds; FTS unavailable; MCP stale/partial; fresh CLI UserSession impact LOW | Tool limitation recorded |
| Write design and plan | Linked documents below | Complete |
| Review plan | Main self-review and independent review clarified canonical email, expired-session logout, required JWT time claims and lost refresh responses | Complete |

## 6. Technical decisions

| Decision | Reason | Alternative/tradeoff |
| --- | --- | --- |
| Core backend slice first | User confirmed; avoids mail/OAuth/storage dependencies | Full V1 deferred to explicit milestones |
| Preserve current layers and schema | Existing foundation and compatibility | No folder refactor or V1 rewrite |
| Proposed BCrypt retention | Current code and security test | Argon2 change requires an explicit compatibility decision |
| Proposed opaque refresh + HS256 access | Fits session-hash model and access-secret configuration | Key sharing and limited historical replay detection documented |
| Proposed state-preserving mappers/session restoration | Current constructors cannot safely round-trip all state | Fix through additive APIs and tests |
| Proposed additive canonical-email index | Enforces duplicate race at DB boundary | Existing duplicate groups require a separate data decision |
| API-first acceptance | Clients currently have no auth implementation | Browser cookie/CSRF and Gateway integration require later verification |

The user approved scope, not every technical default. Proposed choices are captured for review in the design.

## 7. Changes made

### 7.1 Code and behavior

No business code changed. Existing repository interfaces, empty adapter/controller-related scaffolds and tests were inspected.

### 7.2 Data, schema and migrations

No database connection or migration execution performed. V2 is proposed only in the plan; V1 untouched.

### 7.3 Configuration, infrastructure and dependencies

No dependency/runtime configuration edits. Set UTC only in the test child shell. Refreshed ignored local GitNexus index using `--index-only`. Managed shell startup failed with `helper_unknown_error`; approved escalated commands worked from the same repository path.

### 7.4 API, security and observability

No route/security implementation changed. Proposed explicit route allowlist, JWT validation, safe error envelope, bounded auth throttling and log redaction are in the plan.

## 8. Files affected

| Type | Path | Purpose |
| --- | --- | --- |
| Add | docs/superpowers/specs/2026-09-05-identity-core-auth-design.md | Current evidence, design defaults and deferred decisions |
| Add | docs/superpowers/plans/2026-09-05-identity-core-auth.md | Ordered tasks, files, behavior and validation |
| Add | docs/work_logs/K/identity-core-auth-readiness.md#source-2026-09-05-identity-readiness | Handoff record |

## 9. Checks and evidence

From `services/identity-service`:

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=IdentityCleanArchitectureTest,RegisterUserRequestValidationTest,GlobalExceptionHandlerTest' test
```

Fresh Surefire summaries: IdentityCleanArchitectureTest 2/0/0/0; RegisterUserRequestValidationTest 2/0/0/0; GlobalExceptionHandlerTest 2/0/0/0 (tests/failures/errors/skipped).

`docker compose -f compose.yml -f compose.dev.yml config --quiet` exited 0. `docker version --format '{{.Server.Version}}'` could not reach `dockerDesktopLinuxEngine`. This session does not claim fresh Neon, Valkey or HTTP health connectivity.

`node .gitnexus/run.cjs analyze --index-only` succeeded: 2,503 nodes, 3,812 edges, 63 clusters, 62 flows. FTS could not load its Windows DLL dependency. MCP impact for UserSession/UserJpaEntity/SecurityConfig returned zero resolved callers, UNKNOWN and partial with stale metadata. Fresh CLI UserSession impact returned LOW, one direct caller `createNew`, no execution processes. Text search identified the session port and JPA/security test consumers. No UNKNOWN result was treated as safe-to-edit evidence.

## 10. Risks and blockers

| Level | Issue | Next action |
| --- | --- | --- |
| Medium | Docker engine unavailable | Restore engine before full baseline and adapter/HTTP integration tests |
| Medium | ID and revoked-session round trips incomplete | Implement Task 2 with regression tests before adapter wiring |
| Medium | Security skeleton does not validate JWT | Implement explicit bearer/route/error policy before auth acceptance |
| Medium | Test PostgreSQL image uses latest | Verify target major and pin image in Task 0 |
| Low | GitNexus MCP cache/FTS degraded | Use fresh CLI impact plus text inspection; repeat at edit time |
| Planning | Browser transport and full V1 are separate milestones | Do not infer browser/persistence/security completion from core HTTP tests |

## 11. Handoff

Read the design and plan, review technical defaults, then begin Task 0 when implementation is authorized. Domain/use-case tests can progress while Docker availability is being resolved. Preserve all existing files and secret configuration. Record actual tests and runtime limitations at each milestone. The proposed V2 requires duplicate-count preflight before touching an existing database.

## 12. References

- [Design](../../superpowers/specs/2026-09-05-identity-core-auth-design.md)
- [Plan](../../superpowers/plans/2026-09-05-identity-core-auth.md)
- [Foundation log](../T/2026-09-02-clean-architecture-refactor.md)
- [Work-log template](../log_template.md)
- Notion and framework sources are linked in the design.

## 13. Session close

Documentation only; no commits or PRs. Final status shows exactly the three new documentation files listed above. `git diff --check` passed. New-file `git diff --no-index --check -- NUL <file>` emitted no whitespace diagnostics (exit 1 denotes new-file differences); an explicit trailing-whitespace scan and relative-link validation were also clean.

Checklist: source facts distinguished from proposals; scope choice recorded; affected files and commands included; Docker/graph limitations explicit; no secrets or personal data copied.

## 14. Document restoration on feat/identity-service

The user reported these three Markdown files missing and requested them again. Read-only checks confirmed the current branch is `feat/identity-service`, the worktree was clean, and all three target files were absent. Restored the reviewed documents from the saved conversation patch, including the review corrections recorded above. Updated the plan to use the user's existing feature branch.

The test and runtime results in sections 1-13 describe the earlier readiness session; restoration does not constitute a new test run or a fresh Docker/database check. This restoration changes documentation only. No commit or branch switch was performed.

---

<a id="source-2026-09-05-identity-core-auth"></a>

## Source worklog: 2026-09-05-identity-core-auth.md

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
- `docs/work_logs/K/identity-core-auth-readiness.md#source-2026-09-05-identity-readiness`
