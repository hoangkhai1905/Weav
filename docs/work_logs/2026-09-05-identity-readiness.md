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
| Add | docs/work_logs/2026-09-05-identity-readiness.md | Handoff record |

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

- [Design](../superpowers/specs/2026-09-05-identity-core-auth-design.md)
- [Plan](../superpowers/plans/2026-09-05-identity-core-auth.md)
- [Foundation log](2026-09-02-clean-architecture-refactor.md)
- [Work-log template](log_template.md)
- Notion and framework sources are linked in the design.

## 13. Session close

Documentation only; no commits or PRs. Final status shows exactly the three new documentation files listed above. `git diff --check` passed. New-file `git diff --no-index --check -- NUL <file>` emitted no whitespace diagnostics (exit 1 denotes new-file differences); an explicit trailing-whitespace scan and relative-link validation were also clean.

Checklist: source facts distinguished from proposals; scope choice recorded; affected files and commands included; Docker/graph limitations explicit; no secrets or personal data copied.

## 14. Document restoration on feat/identity-service

The user reported these three Markdown files missing and requested them again. Read-only checks confirmed the current branch is `feat/identity-service`, the worktree was clean, and all three target files were absent. Restored the reviewed documents from the saved conversation patch, including the review corrections recorded above. Updated the plan to use the user's existing feature branch.

The test and runtime results in sections 1-13 describe the earlier readiness session; restoration does not constitute a new test run or a fresh Docker/database check. This restoration changes documentation only. No commit or branch switch was performed.
