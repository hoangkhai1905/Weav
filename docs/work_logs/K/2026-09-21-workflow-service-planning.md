# Work log — 2026-09-21 Workflow Service V1 planning

## 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-21 / Asia/Saigon |
| Repository | Weav, `T:\Weav` |
| Starting branch / commit | `dev` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Author / handoff | Codex coordinator; user and future implementation workers |
| Final status | Planning complete; implementation not started |
| Scope | Read the supplied Workflow spec and use Superpowers to write an implementation plan |

## 2. Executive summary

- Added a 21-task, four-milestone implementation plan with file ownership, shared interfaces, test examples/commands, migration/recovery decisions, integration gates, and spec traceability.
- Read the actual Workflow scaffold, Workspace contracts/runtime, Gateway routing, OCR contract/runtime, and web catalog; separated implemented foundations from missing behavior.
- Recorded both user clarifications: every stored version counts for connection usage, including versions of deleted workflows; no references returns `200 {"inUse":false}` without a Workspace lookup. The planned contract update supersedes the old unknown-connection 404 wording.
- Preserved the pre-existing untracked input spec. No application source, runtime configuration, migration, or test implementation was changed.

| Check | Status | Scope |
| --- | --- | --- |
| Build / compile | Not run | Documentation task |
| Unit / integration / browser | Not run | Commands and acceptance evidence are planned, not claimed |
| Migration / live services | Not applied / not started | No database or provider mutation |
| Plan review | Complete | Spec coverage, shared-interface consistency, dependency/placeholder review |
| Diff / whitespace | Passed | Tracked diff plus explicit checks of the new documents |
| Commit / PR / push | None | Documentation remains reviewable in the working tree |

## 3. Goals and scope

### Goals

1. Ground the plan in the supplied specification and current checked-in source.
2. Make execution tasks independently reviewable and identify integration prerequisites accurately.
3. Preserve the user's planning-only scope.

### In scope

- New implementation plan and this member work log.
- Read-only source/contract investigation, GitNexus graph calls, and a local index refresh attempt.

### Out of scope

- Implementing the service, starting runtime services, changing OAuth permissions, selecting AI/Bot protocols, repairing OCR, merging/committing/pushing.

### Completion criteria

- [x] All spec sections have task ownership and verification requirements.
- [x] Both user clarifications are explicitly recorded in the plan.
- [x] Missing contracts remain explicit gates; no invented success paths.
- [x] New documents reviewed and whitespace checked.

## 4. Context and source of truth

- Input: `docs/superpowers/specs/workflow-service-spec.md`, which existed untracked before this task.
- Current branch is ahead of spec baseline `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`; the intervening diff contains documentation/guidance changes only.
- Root AGENTS guidance and current source take precedence over historical logs. Read `docs/work_logs/T/2026-09-02.md`, `docs/work_logs/K/workspace-core-v1.md`, and the consolidated Workspace connection context for orientation.
- Used Superpowers `using-superpowers` and `writing-plans`; GitNexus exploration/CLI guidance; repository-requested `dispatching-parallel-agents` and `parallel-execution-optimizer` for one bounded read-only integration investigation.
- Used prior memory only to locate foundation/work-log conventions, then verified the relevant current files. No memory was modified.

## 5. Session record

| Stage | Action | Evidence / result |
| --- | --- | --- |
| Baseline | Read spec, guidance, status, manifests, migration, existing tests | Workflow business use cases/adapters/architecture test include empty scaffolds |
| Graph | Query/context/impact against repo Weav | Workflow/createNew and WorkflowExecution/queue each LOW, one direct caller, zero resolved processes; index three commits behind |
| Refresh | Ran `node .gitnexus/run.cjs analyze --index-only` | Sandbox runner EPERM; elevated analyzer emitted banner then stalled; stopped its session |
| Integration lane | Read-only independent Workspace/OCR/Gateway/catalog audit | Findings returned, source corroborated by coordinator; no worker edits/tests |
| Clarifications | Asked two usage-contract questions | Both answered and incorporated in Task 7/global constraints |
| Plan | Wrote 21 tasks, four milestones, dependency/ownership map | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` |
| Review | Coverage/type/placeholder scan and document whitespace checks | Documentation reviewed; no runtime success claims |

## 6. Technical decisions

| Decision | Reason | Consequence |
| --- | --- | --- |
| Count every stored version | Explicit user answer | Usage SQL excludes deleted drafts but retains stored-version references |
| No references returns 200 false | Explicit user answer resolves contract contradiction | Clarify shared OpenAPI; Workspace owns connection existence checks |
| One coordinated service plan | Shared authoring/admission/execution transaction invariants | Four milestones; parallel writes only after interfaces and ownership are stable |
| PostgreSQL leases, fencing, persisted retry times | Duplicate delivery and crash recovery requirements | No promise of exactly-once external effects |
| Additive migrations | Preserve deployed V1 schema/data | V2 references, V3 delivery/recovery, V4 webhook uniqueness are planned only |
| OCR production gates | Current runtime does not enforce the formal auth contract; URL/artifact wiring incomplete | Real integration stays disabled until separately owned prerequisites have evidence |
| Bounded web/Gateway scope | Spec explicitly requires routes and catalog alignment | Full replacement of the local-storage Workflow UI is not silently added |

Additional proposed details—limits, pagination, schedule downtime/coalescing, and per-publication webhook keys—are labeled planning choices rather than previously approved spec facts.

## 7. Changes made

### 7.1. Code and behavior

None. The plan describes future work, including the missing access-token verifier, lifecycle APIs, engine, adapters, triggers, and route/catalog alignment.

### 7.2. Data and migration

None applied. V1 migration and all persisted data remain untouched.

### 7.3. Configuration and dependencies

None changed. Verified existing Java 25, Spring Boot 4.1.0, Jackson 3, AMQP/Testcontainers dependencies, and pnpm 11.22.0. The local GitNexus refresh was attempted but not completed.

### 7.4. API/security/observability

Documented actual Workspace access/resolve payloads, usage fail-closed client behavior, OCR JWT mismatch, absent Workflow Gateway routes, and web catalog inconsistencies. All fixes remain plan tasks.

## 8. Changed files

| Type | Path | Purpose |
| --- | --- | --- |
| Add | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` | Implementation plan, 21 tasks/four milestones |
| Add | `docs/work_logs/T/2026-09-21-workflow-service-planning.md` | This handoff and evidence |
| Preserve | `docs/superpowers/specs/workflow-service-spec.md` | Pre-existing untracked user input; not edited |

## 9. Verification and evidence

| Command / action | Actual result | Limit |
| --- | --- | --- |
| `git status --short`, `git log -1` | Starting state established | No remote fetch required for local planning |
| `git diff --stat 7e14de05ec9886db8d9beacf3dc6c69f12a6fd02 HEAD` | Documentation-only drift | Baseline comparison, not test evidence |
| GitNexus query/context/impact for Workflow aggregates | Source locations/callers found; LOW narrow impact | Stale index; no whole-service all-clear |
| `node .gitnexus/run.cjs analyze --index-only` | Incomplete: EPERM then elevated stall | Stopped; refresh required at implementation time |
| Source/manifest/contract reads | Confirmed exact payloads, empty scaffolds, scripts, boundaries | No service execution |
| Official Google Sheets values get/append/update documentation | Verified HTTP operations used in Task 14 | No provider calls/credentials |
| Plan task/coverage/interface/placeholder scan; PowerShell Parser.ParseInput on fenced examples | Complete, 21 ordered tasks, balanced fences, examples parse | Syntax/design review, not implementation validation |
| `git diff --check` and `git diff --no-index --check` against empty file for each new document | Passed | Whitespace only |

Not run: Java suites/builds, Gateway tests, browser, Compose startup, OCR/Sheets live calls, database migrations. GitNexus `detect_changes` is reserved for the future implementation milestone before commit; this task created no commit.

## 10. Risks and blockers

| Risk | Evidence | Owner / next step |
| --- | --- | --- |
| OCR auth mismatch | Bearer presence only; X-Workspace-ID tenant context; request ID generated when missing | OCR owner: real signature/claim enforcement and contract tests |
| OCR sources not wired | Artifact resolver absent; URL fetcher default-deny allowlist not configured | OCR/Workflow owners: approve artifact contract; wire allowlist for URL |
| Email/AI/Bot contracts missing | Spec explicitly gates them | Respective service/provider owners; Workflow must fail visibly |
| Static graph incomplete/stale | Three commits behind and refresh stall | Future implementer refreshes graph in actual worktree; source/test corroboration mandatory |
| Provider side-effect duplicates | Crash after provider effect before state commit | Document at-least-once limit; use provider idempotency only where supported |

None of these prevented writing the requested plan. They constrain future implementation/deployment claims.

## 11. Handoff

### Ready now

1. Review the plan's proposed decisions and four milestone boundaries.
2. Choose the execution approach; subagent-driven task implementation with reviewer gates is recommended for this service's security/concurrency boundaries.
3. At implementation start, refresh source/status/graph in an isolated worktree, then start Task 1. Do not execute tasks automatically based only on this planning request.

### Required later

- OCR hardening/contract agreement and approved test credentials/resources for real provider acceptance.
- Explicit implementation scope and execution method from the user; no implementation was requested in this session.

### Instructions for the next agent

- Read the spec and plan together; the two user clarifications in Global Constraints override the conflicting old usage wording.
- Keep the pre-existing spec intact unless its update is separately requested/needed within an authorized contract-edit task.
- Preserve domain purity, service ownership, secrets, compatibility, and the runtime evidence gates.
- Update work logs as milestones progress; record actual commands/results rather than copying the plan's expected outcomes as facts.

## 12. References

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`
- `docs/work_logs/log_template.md`
- `packages/contracts/http/workflow/openapi.yaml`
- `packages/contracts/http/workspace/openapi.yaml`
- `packages/contracts/http/ocr/README.md` and `openapi.yaml`
- `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/workflow/WorkflowConnectionUsageClient.java`
- `services/ocr-service/src/api/routes.py` and `src/api/dependencies.py`
- `apps/web/src/lib/constants/nodeCatalog.ts` and `src/pages/WorkflowBuilderPage.tsx`

## 13. Session end

| Field | Value |
| --- | --- |
| Final state | Planning complete, implementation not started |
| Working tree | New plan/log and preserved pre-existing untracked spec |
| Commit / PR / push | None |
| Read before continuing | Plan Global Constraints, planning decisions, dependency map, production gates |

- [x] Completed work and unimplemented behavior clearly distinguished.
- [x] Decisions, source evidence, commands, risks, and next steps recorded.
- [x] No secret values or unnecessary personal data included.
- [x] Commit and working-tree state stated accurately.

## Implementation dispatch follow-up

- User authorized implementation with one or two Luna MAX workers; coordinator leads and reviews, then stops after dispatch until the user reports completion.
- User explicitly selected direct work in `T:\Weav` on `feature/workflow-service`, without a worktree. Verified that branch is already checked out at `c836de2`; updated the plan constraint accordingly.
- First worker scope: Task 1 only — deep immutable JSON values, affected aggregate copies, architecture rules, and regression/JSONB tests. Tasks 2–21 remain gated on coordinator review.
- Worker must run baseline/focused/full relevant tests with Docker, preserve pre-existing files, record real evidence, and leave changes uncommitted for review.
- Prepared the ignored plan-scoped brief and progress ledger under `.superpowers/sdd/2026-09-21-workflow-service-v1/`. Skill Bash utilities were unavailable; used an equivalent PowerShell setup without modifying Git configuration or existing source.
- No implementation result is accepted at dispatch time. No merge, push, or application-source edit by the coordinator.

## Coordinator acceptance and next dispatch
- Reviewed Task 1 fix round 1: exact numeric-class allowlist rejects mutable subclasses; all three aggregate updates freeze before changing state.
- Independently ran full Workflow Maven test suite with UTC, verified Maven-home junction and explicit local repository: 27 tests passed, zero failures/errors/skips, PostgreSQL 18.6 Testcontainers; BUILD SUCCESS. git diff --check passed.
- Task 1 accepted for progression, uncommitted. GitNexus stale/UNKNOWN caveats remain; graph change detection is required before commit.
- Task 2 only is next: immutable graph model, draft/publish validator, catalog, Jackson codec and definition schema/tests. Clarified draft-versus-publish and Task 5 persistence test ownership in plan.
- Host Windows PowerShell escalation successfully discovered both OpenCode and Copilot; bridge Check reported OpenCode 1.18.21 ready. Earlier missing-profile/CLI results described the restricted environment only.
- CLI assistant independently retries read-only Task 2/3 audits through host PowerShell; implementation worker alone owns Task 2 source. No commit/stage/push. Coordinator stops after dispatch per user instruction.

## Native-worker dispatch after CLI trial
- OpenCode host execution was blocked by provider free-tier policy. Copilot launched but its audit was incomplete/cancelled. Neither supplies complete audit evidence. User authorized stopping CLI attempts; no further external CLI runs.
- Task 2 worker reports 35 focused /62 full tests passing, but root acceptance remains pending; do not equate the report with independent verification.
- Two fresh Luna MAX implementation workers: graph lane owns Task 2 review/fixes plus Task 3 mapping; security lane owns Task 4 authentication/Workspace client. Root retains final review/integration gate.
- Graph lane owns domain/definition, domain/mapping, infrastructure/definition, definition schema and corresponding tests. Security lane owns only Task 4 listed security/Workspace/application/error/config files and corresponding tests. Separate worklogs/reports; neither edits plan/ledger or commits.
- Maven builds must be serialized between workers because target output is shared. Work directly on feature/workflow-service; no worktrees, staging, commits, pushes or external CLI use.
- Mapping decision: resolver must receive destination node/field context for sanitized MAPPING_ERROR diagnostics. Runtime outputs are supplied only for successful active-path ancestors by the future engine; resolver alone cannot prove runtime ancestry. Static graph ancestry remains validator responsibility. Preserve draft incompleteness; mapping grammar is publish-only.
- User-requested stop after dispatch overrides continuous-execution skill defaults. Root resumes when user reports workers done.

## Coordinator review and next implementation batch
- User owns docs/work_logs/K; all prior Workflow logs were moved there by the user. Do not move them again or write any new logs under T.
- Reviewed Task3 mapping parsing and Task4 JWT/service-key/Workspace boundaries. Found trailing-node-output delimiter bug: nodeReferenceAt treats nodes.a.output. as empty path, accepting malformed grammar. Graph worker must add a failing regression and fix before acceptance.
- Next graph scope: that bounded Task3 fix plus independent Task9 pure GraphState/readiness/condition/retry implementation. Task9 can precede persistence Tasks6-8; no runtime/engine completeness claim.
- Next authoring scope: Task5 draft create/save/get/list with real HTTP/PostgreSQL regressions; leave Task6/7 implementation for the next batch.
- Existing Tasks2-4 are provisionally usable, final acceptance remains gated on the mapping correction and integrated checks. Live Workspace integration and Compose wiring remain outstanding.
- Root retains review. Workers have disjoint files and must coordinate shared Maven target; no CLI agents, worktree, staging, commit or push. Root stops after dispatch as requested.
- Independent coordinator verification before next dispatch: full Workflow Maven suite passed 118/118, zero failures/errors/skips, PostgreSQL18.6 Testcontainers, BUILD SUCCESS; git diff --check passed (line-ending notices only).

## Tasks5/9 review and Tasks6/7 ownership
- Reviewed draft authorization/validation, scoped repository reads and pessimistic refresh; reviewed graph readiness, joins, retry policy and mapping correction. Task5 deliberately fails closed for connection-bearing saves until real Task7 projection is wired.
- GraphState encapsulated mutation for ready() is accepted: callers must persist the returned/updated state atomically in future Task11; afterSuccess returns a replacement state. This is pure-domain progress, not a working execution engine.
- Next batch: authoring worker owns Task6 publication, workflow/version/trigger aggregates/entities/mappers/controller/response and tests. Graph worker owns Task7 reference port/adapter/migration/usage controller/limiter/contracts and tests. Task7 worker alone edits existing draft projection integration/tests if needed; Task6 worker calls appendVersion in its publication transaction. Neither edits the other's owned paths.
- ConnectionReferencePort will expose replaceDraft(UUID,Set<UUID>), appendVersion(UUID,UUID,Set<UUID>), inUse(UUID,UUID). Graph worker owns this shared interface and informs publication worker when available; update test doubles for new methods without no-op production protection.
- Required user contracts: all stored versions count including deleted workflows; exclude only deleted drafts; no references returns200 false without Workspace calls. Keep draft/version projection updates atomic and preserve immutable historical references.
- Serialize Maven runs with source-ready handshake. Logs K only; root owns ledger/plan. No CLI agents, worktree, staging, commits or push. Root reviews before milestone acceptance.
- Coordinator independently verified combined Tasks5/9 tree: full Workflow suite153/153, no failures/errors/skips, real PostgreSQL/RabbitMQ Testcontainers, BUILD SUCCESS. git diff --check passed. Accepted for next batch; runtime engine and reference tracking remain outstanding.

## Fresh-worker rotation after Tasks6/7
- User requests periodic worker replacement to avoid context overload. Prior workers are retired; use fresh Luna MAX workers with bounded briefs and no inherited history for the next batch.
- Reviewed publication snapshot/row-lock sequence, reference projection and migration backfill, trigger replacement and usage query. Reports show184 Workflow/20 Workspace tests; coordinator verification is tracked separately below.
- Next implementation lane owns Task8 execution admission/outbox/V3 schema and associated tests only. Fresh review lane audits completed Tasks1-7 (M1) and Task9 interfaces, read-only source, concrete repro evidence and review report; root retains defect triage and acceptance.
- Review lane must not change application files; no competing Maven runs. Execution worker gets Maven slot after coordinator run; reviewer uses separate scratch javac probes or coordinates any Maven with implementer. Logs K only, root owns plan/ledger. No external CLIs/worktrees/staging/commits/push.
- Coordinator independent full Workflow rerun passed184/184 with no failures/errors/skips (90seconds, PostgreSQL/RabbitMQ Testcontainers). Source review completed for publication/reference core; fresh M1 audit remains pending. Maven slot released to workflow_execution_fresh; workflow_m1_review_fresh source-read-only. No commit.

## Task8 and fresh M1 review triage
- Task8 worker reports196/196 full Workflow tests after scheduling activation,6 outbox tests. Coordinator inspected publisher fencing/retry flow and is independently running admission/outbox/V3 migration coverage.
- M1 audit HEAD/key gate and editor-state secret scanning findings are accepted for regression-driven fixes. Matrix-parameter body-limit finding is provisional: verify actual full Spring Security firewall behavior, not only servlet/path matchers; never relax firewall to manufacture a bypass. Add bounded regression/normalization fix if warranted and correct report severity when blocked upstream.
- Cross-service attach/delete ordering window is an existing documented limitation; no new coordination contract is authorized by this review. Track for integration acceptance, no invented cross-service transactions.
- Next scopes: M1 reviewer becomes bounded fix worker for reviewed security/body/editor paths and tests; execution worker owns Task10 leases/fencing/recovery/listener and tests. They remain fresh enough for one follow-up, then rotate as useful. K logs only, no CLI/worktree/commit/stage/push.
- Task10 must not silently acknowledge claimed work into a no-op runner while Task11 is absent: keep runtime consumer gated until a real handoff exists and test recovery/ack behavior through a real test runner boundary. Preserve intended Task11 interface.
- Coordinator Task8 verification: ExecutionAdmissionTest, ExecutionOutboxTest, ExecutionDeliveryMigrationTest passed12/12, zero failures/errors/skips, BUILD SUCCESS (118seconds). Task8 worker full196/196 remains worker evidence, not coordinator full rerun. Released shared target/source-edit slot to fix and Task10 workers; coordinate serialized tests. M1 acceptance remains open pending audit fixes.

## 2026-09-22 review and worker rotation
- M1 fixes reviewed: explicit internal HEAD denial before usage lookup; editorState scanned recursively before persistence. Full-chain matrix-parameter probe rejects the request, so the earlier bypass claim is withdrawn, not a confirmed exploit. Existing cross-service attach/delete advisory race remains documented without invented protocol.
- Task10 worker reports15/15 focused tests, fullcombined pending. Root inspected listener gate/runnerboundary and lease/recovery source; runtime remains disabled until realTask11runner.
- Rotate to fresh Luna MAX workers: Task11 runtime lane owns runner/nodeexecution/stateadapter/listener/config and tests; Task12 API lane owns executioncontroller/query/readprojections/contracts and HTTPtests. No overlapping source writes; API lane consumes existing admissionport and schema, asks runtimeworker before any entity/DTO changes.
- Logs K only with2026-09-22 date. Root owns plan/ledger, retains review. No CLIagents/worktrees/staging/commits/push. Wait root fulltest release before sourceedits/Maven, then coordinate serialized testslots.
- Coordinator full combined verification2026-09-22:214/214 tests, zero failures/errors/skips, BUILD SUCCESS (136seconds), embedded HTTP and PostgreSQL/RabbitMQ Testcontainers included. Audit fix dispositions accepted; Task10 usable for runtime integration, no completeengine claim. Fresh workflow_runtime_v2 and workflow_monitor_v2 now released to Task11/12; root stops after dispatch per user.

## Task11/12 handoff review
- Task12 reports19/19 HTTP/API tests. Task11 reports only selected tests; its ExecutionRuntimeTest checks executor/timer resources, not the required realDB/Rabbit node-execution path. Task11 acceptance stays OPEN; complete missing runtime integration and retry verification before claiming M2.
- Coordinator inspected ExecutionRunner and runtime test: real Spring runner wiring, lease-loss/retry/recovery/fenced commits need integration evidence. Starting focused tests independently, not equating source-ready with complete.
- Rotate to fresh workers: runtime completion/review/fixes lane owns Task11 and execution tests; independent Task13 lane owns HTTP adapter/SSRF transport/sanitizer tests. Runtime lane owns registry/config; HTTP lane contributes NodeExecutor bean and coordinates registration. K logs only; quiet workers (no routine root messages or send_message_to_thread; only final/critical blockers), direct peer Maven coordination.
- Coordinator focused Task11 checks passed7/7 (4runner,3resource/timer), BUILD SUCCESS. No realruntime test existed in that selector; acceptance remains open. Fresh workflow_runtime_completion assigned missingintegration/fixes; workflow_http_action assignedTask13 HTTP/SSRF. Root has no activeMaven; workers coordinate quiet peer handoffs. Finalcombinedsuite required after their changes.

## 2026-09-23 incomplete worker recovery
- User signaled workers done, but live agent inventory contains only root. Required scratchtask-11-completion-report.md and scratchtask-13-report.md absent; no new K handoff logs.
- Current artifacts show ExecutionRuntimeIntegrationTest added, without a corresponding Surefire report. Task13 currently has only OutboundTargetPolicy.java plus policy/sanitizer tests; HTTP executor, pinned transport and sanitizer implementation absent. Treat as partial work, not completion.
- Preserve all partial source/tests and restart two fresh Luna MAX workers on the SAME scopes, no advancement. Runtime lane owns integration/fixes/registry/config; HTTP lane owns HTTP policy/transport/executor/sanitizer/POM. Quiet peer coordination, explicit serialized Maven owner, no routine root messages. Logs K only date2026-09-23.

## GPT-6 Luna worker preference and next review batch
- User explicitly requests GPT-6 Luna max for subsequent workers; use model gpt-6-luna with reasoning max and fresh bounded context.
- Recovered reports present: runtime8 realDB/Rabbit tests, combined277/277 workerreported; HTTP38/38. Root independently checks runtime+HTTP before nextrelease.
- Next scopes: Task13 transport assurance lane closes TLS hostname/SNI and timeout evidence gaps, inspects HTTP API-key header contract without silently inventing metadata. Task14 Sheets lane owns only sheetsadapter/client/tests, uses sharedtransport/sanitizer through coordinated interface. Transportlane owns any shared HTTPtransport changes; Sheetsworker requests them through peer.
- Keep workers quiet (no routine rootmessages/send_message_to_thread), serialize Maven with explicit source-ready handoff, K logs only, no externalCLIs/worktrees/staging/commit/push. Root ownsplanledger and acceptance.
- Root independent runtime+HTTP suite passed46/46 (runtime8,HTTP38), zero failures/errors/skips BUILD SUCCESS. Released source/Maven slot to fresh gpt-6-luna max workers workflow_http_assurance_6 and workflow_sheets_6. TLS/customAPIkeyheader limits remain reviewitems; providerliveSheets smoke needs configuredtestresource. Root stops afterdispatch.

## API_KEY contract decision and next task ownership
- User explicitly chose: reject Workflow outbound HTTP API_KEY connections until Workspace resolve contract includes the configured non-secret apiKeyHeaderName. Current fixed X-Api-Key assumption is unsupported for custom Workspace connections. Add bounded fail-closed regression; no guessed default, no silent auth misrouting.
- Coordinator full Workflow suite is running after HTTP assurance/Sheets. Next workers GPT-6 Luna max fresh: Task15 unsupported integrations plus API_KEY fail-closed fix owns HttpRequestNodeExecutor/its tests, UnavailableNodeExecutor, IntegrationReadiness, TelegramTriggerIngress and tests. Task16 schedule owns publication/trigger adapter/scheduler/config/tests. Avoid overlapping publication/registry/config edits: Task15 requests readiness projection/pub integration via Task16 peer; Task16 owns those existing files. Serialized Maven after root release; K logs only, quiet workers.
- Coordinator independently ran full Workflow suite after Task13 assurance andTask14 Sheets:301/301 tests, zero failures/errors/skips, BUILD SUCCESS (3m34s), real Postgres/Rabbit integration. Released shared source/Maven slot to gpt-6-luna max Task15/APIKEYfailclosed and Task16 schedule workers. User chose API_KEY reject until additive resolved headernamecontract. No commit/staging.

## 2026-09-23 Task15-18 review
- Task15/16 focused peer selectors passed 50; schedule architecture repair selectors passed 27 Workflow plus 2 contract tests, and the final publication fixture rerun passed 13. Application schedule processing now uses ScheduleValidationPort; Workflow GET OpenAPI documents safe trigger state.
- Task18 focused OCR client/JWT selectors passed 11. OCR source, artifact, and security-prerequisite gates default disabled. Production OCR remains blocked by OCR service verifier/allowlist and artifact resolver prerequisites; no live OCR acceptance claimed.
- Coordinator combined Workflow suite: 342 tests, 0 assertion failures, 106 Spring context errors, BUILD FAILURE. All inspected errors originate in OcrClient bean creation: two constructors without an autowiring choice, reported as no default constructor. Full suite captured in temporary weav-workflow-full-20260923.log; no secret material retained. Assign bounded OCR startup fix and Spring context regression, then rerun full suite. git diff --check clean apart from line-ending notices. No commit/stage/push.
- Next independent lane: Task17 durable webhook ingress. Workers coordinate Maven target use and keep reports quiet until final handoff. K logs only.

## 2026-09-23 Task17/18 combined review
- OCR Spring wiring/config repair and Task17 webhook handoffs reviewed. Focused worker evidence: OCR 25/25, webhook 25/25, Workflow contract 2/2. Root inspected credential hashing, generic rejection, same-transaction admission, V4 unique index, and default-closed OCR gates.
- Root combined Workflow suite: 351 tests, 0 assertion failures, 17 context errors, BUILD FAILURE. Only failing class is WorkflowSecurityTest; its test-only POST /webhooks/{endpointKey} stub now duplicates the real WebhookController mapping. Assign bounded test repair, rerun the failing selector and then full suite. `git diff --check` has no whitespace errors (only existing line-ending notices).
- Next independent lane: Task19 Gateway exact-route proxy, with real Gateway/Workflow interoperability evidence. No commit, staging, or push.

## 2026-09-23 Task19 review and verification
- Worker repaired the test-only webhook route collision; focused WorkflowSecurityTest plus WebhookIngressTest passed 22/22.
- Coordinator reran full Workflow Service suite with PostgreSQL/RabbitMQ Testcontainers: 351/351 tests, zero failures/errors/skips, BUILD SUCCESS (4m03s). This supersedes the prior failed combined runs.
- Gateway Task19 worker reported 90/90 unit, 74/74 e2e, typecheck/build and OpenAPI references green. Coordinator independently reran local Jest binaries after pnpm wrapper attempted a noninteractive modules purge: 90/90 unit and 74/74 fixture-backed e2e passed; local TypeScript noEmit and Nest build passed. `git diff --check` has no whitespace errors (only properties line-ending notices).
- Actual Gateway-to-Workflow authenticated runtime remains unverified: no Docker CLI on PATH/standard Docker Desktop paths and no local stack listeners. Testcontainers worked through Java but are not equivalent to the full stack. Leave this acceptance for Task21; no production credentials requested or exposed.
- Next independent scopes: Task20 web catalog/builder and Task21 configuration/acceptance, with disjoint file ownership. No stage/commit/push.

## 2026-09-23 Task20/21 review
- Task21 acceptance handoff adds three real HTTP/PostgreSQL/RabbitMQ cases, disposable smoke script, documented closed OCR gates, and nonsecret Compose/env placeholders. Coordinator reran the complete Workflow suite after its health/config edits: 354/354 tests, zero failures/errors/skips, BUILD SUCCESS (4m12s).
- Task20 worker reports catalog/browser subsets 7/7, 11/11, 7/7, web build and scoped lint. Coordinator inspected the real browser screenshot and source: the builder still presents preset webhook success and simulated AI/email success through Run Test despite publication being blocked. This conflicts with visible dependency readiness. Assign a bounded UI truthfulness fix with browser regression.
- Compose CLI and controlled live Gateway token/workspace/URL remain absent; Java Testcontainers reaches Docker Desktop but does not prove the full Gateway stack. Full web lint has existing SettingsPage hook errors outside Task20. No staging/commit/push.

## 2026-09-23 Task20/21 closeout review
- Task20 follow-up removed invented execution telemetry and node success states; unavailable/unconfigured nodes now show readiness badges and the button previews connections only. Coordinator independently ran Chromium workflow catalog/UI 33/33 and OCR builder 7/7 against local Vite with `VITE_API_MODE=mock`; browser assertions passed. First local run used HTTP mode and redirected to login, so its failures were test setup, then corrected and rerun green.
- Coordinator web TypeScript build and scoped ESLint passed. Full ESLint remains red only in unedited `apps/web/src/pages/SettingsPage.tsx` at lines 76/82 (plus one warning at 106); this is outside Workflow scope.
- Task21 worker independently ran Workflow `verify` with 354/354 tests and executable JAR packaging, plus Workspace contract/security selectors 63/63; parser/schema/fixture checks passed. Coordinator earlier full Workflow `test` passed 354/354. `git diff --check` remains clean apart from line-ending notices.
- GitNexus MCP detect_changes(scope=all) remains unresolved: index storage version 43 differs from installed engine version 42 and asks for a force rebuild. No commit attempted. Compose validation and live Gateway-to-Workflow smoke still require Docker CLI and a controlled disposable Gateway URL/workspace/token environment; user was asked for nonsecret setup details only. All work remains unstaged/uncommitted.
