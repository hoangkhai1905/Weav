# Workflow Service V1 detailed record — foundation

> Historical task notes recovered from commit 18b6dfa. The source records below retain their original decisions, file inventories, test commands, and handoff details. Their test counts are milestone snapshots; the final integrated release evidence is in workflow-service-v1.md.

Source notes are grouped here to keep the K folder navigable while retaining implementation detail.

---

### Source record: 2026-09-21-workflow-service-planning.md


#### 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-21 / Asia/Saigon |
| Repository | Weav, `T:\Weav` |
| Starting branch / commit | `dev` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Author / handoff | Codex coordinator; user and future implementation workers |
| Final status | Planning complete; implementation not started |
| Scope | Read the supplied Workflow spec and use Superpowers to write an implementation plan |

#### 2. Executive summary

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

#### 3. Goals and scope

##### Goals

1. Ground the plan in the supplied specification and current checked-in source.
2. Make execution tasks independently reviewable and identify integration prerequisites accurately.
3. Preserve the user's planning-only scope.

##### In scope

- New implementation plan and this member work log.
- Read-only source/contract investigation, GitNexus graph calls, and a local index refresh attempt.

##### Out of scope

- Implementing the service, starting runtime services, changing OAuth permissions, selecting AI/Bot protocols, repairing OCR, merging/committing/pushing.

##### Completion criteria

- [x] All spec sections have task ownership and verification requirements.
- [x] Both user clarifications are explicitly recorded in the plan.
- [x] Missing contracts remain explicit gates; no invented success paths.
- [x] New documents reviewed and whitespace checked.

#### 4. Context and source of truth

- Input: `docs/superpowers/specs/workflow-service-spec.md`, which existed untracked before this task.
- Current branch is ahead of spec baseline `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`; the intervening diff contains documentation/guidance changes only.
- Root AGENTS guidance and current source take precedence over historical logs. Read `docs/work_logs/T/2026-09-02.md`, `docs/work_logs/K/workspace-core-v1.md`, and the consolidated Workspace connection context for orientation.
- Used Superpowers `using-superpowers` and `writing-plans`; GitNexus exploration/CLI guidance; repository-requested `dispatching-parallel-agents` and `parallel-execution-optimizer` for one bounded read-only integration investigation.
- Used prior memory only to locate foundation/work-log conventions, then verified the relevant current files. No memory was modified.

#### 5. Session record

| Stage | Action | Evidence / result |
| --- | --- | --- |
| Baseline | Read spec, guidance, status, manifests, migration, existing tests | Workflow business use cases/adapters/architecture test include empty scaffolds |
| Graph | Query/context/impact against repo Weav | Workflow/createNew and WorkflowExecution/queue each LOW, one direct caller, zero resolved processes; index three commits behind |
| Refresh | Ran `node .gitnexus/run.cjs analyze --index-only` | Sandbox runner EPERM; elevated analyzer emitted banner then stalled; stopped its session |
| Integration lane | Read-only independent Workspace/OCR/Gateway/catalog audit | Findings returned, source corroborated by coordinator; no worker edits/tests |
| Clarifications | Asked two usage-contract questions | Both answered and incorporated in Task 7/global constraints |
| Plan | Wrote 21 tasks, four milestones, dependency/ownership map | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` |
| Review | Coverage/type/placeholder scan and document whitespace checks | Documentation reviewed; no runtime success claims |

#### 6. Technical decisions

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

#### 7. Changes made

##### 7.1. Code and behavior

None. The plan describes future work, including the missing access-token verifier, lifecycle APIs, engine, adapters, triggers, and route/catalog alignment.

##### 7.2. Data and migration

None applied. V1 migration and all persisted data remain untouched.

##### 7.3. Configuration and dependencies

None changed. Verified existing Java 25, Spring Boot 4.1.0, Jackson 3, AMQP/Testcontainers dependencies, and pnpm 11.22.0. The local GitNexus refresh was attempted but not completed.

##### 7.4. API/security/observability

Documented actual Workspace access/resolve payloads, usage fail-closed client behavior, OCR JWT mismatch, absent Workflow Gateway routes, and web catalog inconsistencies. All fixes remain plan tasks.

#### 8. Changed files

| Type | Path | Purpose |
| --- | --- | --- |
| Add | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` | Implementation plan, 21 tasks/four milestones |
| Add | `docs/work_logs/T/2026-09-21-workflow-service-planning.md` | This handoff and evidence |
| Preserve | `docs/superpowers/specs/workflow-service-spec.md` | Pre-existing untracked user input; not edited |

#### 9. Verification and evidence

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

#### 10. Risks and blockers

| Risk | Evidence | Owner / next step |
| --- | --- | --- |
| OCR auth mismatch | Bearer presence only; X-Workspace-ID tenant context; request ID generated when missing | OCR owner: real signature/claim enforcement and contract tests |
| OCR sources not wired | Artifact resolver absent; URL fetcher default-deny allowlist not configured | OCR/Workflow owners: approve artifact contract; wire allowlist for URL |
| Email/AI/Bot contracts missing | Spec explicitly gates them | Respective service/provider owners; Workflow must fail visibly |
| Static graph incomplete/stale | Three commits behind and refresh stall | Future implementer refreshes graph in actual worktree; source/test corroboration mandatory |
| Provider side-effect duplicates | Crash after provider effect before state commit | Document at-least-once limit; use provider idempotency only where supported |

None of these prevented writing the requested plan. They constrain future implementation/deployment claims.

#### 11. Handoff

##### Ready now

1. Review the plan's proposed decisions and four milestone boundaries.
2. Choose the execution approach; subagent-driven task implementation with reviewer gates is recommended for this service's security/concurrency boundaries.
3. At implementation start, refresh source/status/graph in an isolated worktree, then start Task 1. Do not execute tasks automatically based only on this planning request.

##### Required later

- OCR hardening/contract agreement and approved test credentials/resources for real provider acceptance.
- Explicit implementation scope and execution method from the user; no implementation was requested in this session.

##### Instructions for the next agent

- Read the spec and plan together; the two user clarifications in Global Constraints override the conflicting old usage wording.
- Keep the pre-existing spec intact unless its update is separately requested/needed within an authorized contract-edit task.
- Preserve domain purity, service ownership, secrets, compatibility, and the runtime evidence gates.
- Update work logs as milestones progress; record actual commands/results rather than copying the plan's expected outcomes as facts.

#### 12. References

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`
- `docs/work_logs/log_template.md`
- `packages/contracts/http/workflow/openapi.yaml`
- `packages/contracts/http/workspace/openapi.yaml`
- `packages/contracts/http/ocr/README.md` and `openapi.yaml`
- `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/workflow/WorkflowConnectionUsageClient.java`
- `services/ocr-service/src/api/routes.py` and `src/api/dependencies.py`
- `apps/web/src/lib/constants/nodeCatalog.ts` and `src/pages/WorkflowBuilderPage.tsx`

#### 13. Session end

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

#### Implementation dispatch follow-up

- User authorized implementation with one or two Luna MAX workers; coordinator leads and reviews, then stops after dispatch until the user reports completion.
- User explicitly selected direct work in `T:\Weav` on `feature/workflow-service`, without a worktree. Verified that branch is already checked out at `c836de2`; updated the plan constraint accordingly.
- First worker scope: Task 1 only — deep immutable JSON values, affected aggregate copies, architecture rules, and regression/JSONB tests. Tasks 2–21 remain gated on coordinator review.
- Worker must run baseline/focused/full relevant tests with Docker, preserve pre-existing files, record real evidence, and leave changes uncommitted for review.
- Prepared the ignored plan-scoped brief and progress ledger under `.superpowers/sdd/2026-09-21-workflow-service-v1/`. Skill Bash utilities were unavailable; used an equivalent PowerShell setup without modifying Git configuration or existing source.
- No implementation result is accepted at dispatch time. No merge, push, or application-source edit by the coordinator.

#### Coordinator acceptance and next dispatch
- Reviewed Task 1 fix round 1: exact numeric-class allowlist rejects mutable subclasses; all three aggregate updates freeze before changing state.
- Independently ran full Workflow Maven test suite with UTC, verified Maven-home junction and explicit local repository: 27 tests passed, zero failures/errors/skips, PostgreSQL 18.6 Testcontainers; BUILD SUCCESS. git diff --check passed.
- Task 1 accepted for progression, uncommitted. GitNexus stale/UNKNOWN caveats remain; graph change detection is required before commit.
- Task 2 only is next: immutable graph model, draft/publish validator, catalog, Jackson codec and definition schema/tests. Clarified draft-versus-publish and Task 5 persistence test ownership in plan.
- Host Windows PowerShell escalation successfully discovered both OpenCode and Copilot; bridge Check reported OpenCode 1.18.21 ready. Earlier missing-profile/CLI results described the restricted environment only.
- CLI assistant independently retries read-only Task 2/3 audits through host PowerShell; implementation worker alone owns Task 2 source. No commit/stage/push. Coordinator stops after dispatch per user instruction.

#### Native-worker dispatch after CLI trial
- OpenCode host execution was blocked by provider free-tier policy. Copilot launched but its audit was incomplete/cancelled. Neither supplies complete audit evidence. User authorized stopping CLI attempts; no further external CLI runs.
- Task 2 worker reports 35 focused /62 full tests passing, but root acceptance remains pending; do not equate the report with independent verification.
- Two fresh Luna MAX implementation workers: graph lane owns Task 2 review/fixes plus Task 3 mapping; security lane owns Task 4 authentication/Workspace client. Root retains final review/integration gate.
- Graph lane owns domain/definition, domain/mapping, infrastructure/definition, definition schema and corresponding tests. Security lane owns only Task 4 listed security/Workspace/application/error/config files and corresponding tests. Separate worklogs/reports; neither edits plan/ledger or commits.
- Maven builds must be serialized between workers because target output is shared. Work directly on feature/workflow-service; no worktrees, staging, commits, pushes or external CLI use.
- Mapping decision: resolver must receive destination node/field context for sanitized MAPPING_ERROR diagnostics. Runtime outputs are supplied only for successful active-path ancestors by the future engine; resolver alone cannot prove runtime ancestry. Static graph ancestry remains validator responsibility. Preserve draft incompleteness; mapping grammar is publish-only.
- User-requested stop after dispatch overrides continuous-execution skill defaults. Root resumes when user reports workers done.

#### Coordinator review and next implementation batch
- User owns docs/work_logs/K; all prior Workflow logs were moved there by the user. Do not move them again or write any new logs under T.
- Reviewed Task3 mapping parsing and Task4 JWT/service-key/Workspace boundaries. Found trailing-node-output delimiter bug: nodeReferenceAt treats nodes.a.output. as empty path, accepting malformed grammar. Graph worker must add a failing regression and fix before acceptance.
- Next graph scope: that bounded Task3 fix plus independent Task9 pure GraphState/readiness/condition/retry implementation. Task9 can precede persistence Tasks6-8; no runtime/engine completeness claim.
- Next authoring scope: Task5 draft create/save/get/list with real HTTP/PostgreSQL regressions; leave Task6/7 implementation for the next batch.
- Existing Tasks2-4 are provisionally usable, final acceptance remains gated on the mapping correction and integrated checks. Live Workspace integration and Compose wiring remain outstanding.
- Root retains review. Workers have disjoint files and must coordinate shared Maven target; no CLI agents, worktree, staging, commit or push. Root stops after dispatch as requested.
- Independent coordinator verification before next dispatch: full Workflow Maven suite passed 118/118, zero failures/errors/skips, PostgreSQL18.6 Testcontainers, BUILD SUCCESS; git diff --check passed (line-ending notices only).

#### Tasks5/9 review and Tasks6/7 ownership
- Reviewed draft authorization/validation, scoped repository reads and pessimistic refresh; reviewed graph readiness, joins, retry policy and mapping correction. Task5 deliberately fails closed for connection-bearing saves until real Task7 projection is wired.
- GraphState encapsulated mutation for ready() is accepted: callers must persist the returned/updated state atomically in future Task11; afterSuccess returns a replacement state. This is pure-domain progress, not a working execution engine.
- Next batch: authoring worker owns Task6 publication, workflow/version/trigger aggregates/entities/mappers/controller/response and tests. Graph worker owns Task7 reference port/adapter/migration/usage controller/limiter/contracts and tests. Task7 worker alone edits existing draft projection integration/tests if needed; Task6 worker calls appendVersion in its publication transaction. Neither edits the other's owned paths.
- ConnectionReferencePort will expose replaceDraft(UUID,Set<UUID>), appendVersion(UUID,UUID,Set<UUID>), inUse(UUID,UUID). Graph worker owns this shared interface and informs publication worker when available; update test doubles for new methods without no-op production protection.
- Required user contracts: all stored versions count including deleted workflows; exclude only deleted drafts; no references returns200 false without Workspace calls. Keep draft/version projection updates atomic and preserve immutable historical references.
- Serialize Maven runs with source-ready handshake. Logs K only; root owns ledger/plan. No CLI agents, worktree, staging, commits or push. Root reviews before milestone acceptance.
- Coordinator independently verified combined Tasks5/9 tree: full Workflow suite153/153, no failures/errors/skips, real PostgreSQL/RabbitMQ Testcontainers, BUILD SUCCESS. git diff --check passed. Accepted for next batch; runtime engine and reference tracking remain outstanding.

#### Fresh-worker rotation after Tasks6/7
- User requests periodic worker replacement to avoid context overload. Prior workers are retired; use fresh Luna MAX workers with bounded briefs and no inherited history for the next batch.
- Reviewed publication snapshot/row-lock sequence, reference projection and migration backfill, trigger replacement and usage query. Reports show184 Workflow/20 Workspace tests; coordinator verification is tracked separately below.
- Next implementation lane owns Task8 execution admission/outbox/V3 schema and associated tests only. Fresh review lane audits completed Tasks1-7 (M1) and Task9 interfaces, read-only source, concrete repro evidence and review report; root retains defect triage and acceptance.
- Review lane must not change application files; no competing Maven runs. Execution worker gets Maven slot after coordinator run; reviewer uses separate scratch javac probes or coordinates any Maven with implementer. Logs K only, root owns plan/ledger. No external CLIs/worktrees/staging/commits/push.
- Coordinator independent full Workflow rerun passed184/184 with no failures/errors/skips (90seconds, PostgreSQL/RabbitMQ Testcontainers). Source review completed for publication/reference core; fresh M1 audit remains pending. Maven slot released to workflow_execution_fresh; workflow_m1_review_fresh source-read-only. No commit.

#### Task8 and fresh M1 review triage
- Task8 worker reports196/196 full Workflow tests after scheduling activation,6 outbox tests. Coordinator inspected publisher fencing/retry flow and is independently running admission/outbox/V3 migration coverage.
- M1 audit HEAD/key gate and editor-state secret scanning findings are accepted for regression-driven fixes. Matrix-parameter body-limit finding is provisional: verify actual full Spring Security firewall behavior, not only servlet/path matchers; never relax firewall to manufacture a bypass. Add bounded regression/normalization fix if warranted and correct report severity when blocked upstream.
- Cross-service attach/delete ordering window is an existing documented limitation; no new coordination contract is authorized by this review. Track for integration acceptance, no invented cross-service transactions.
- Next scopes: M1 reviewer becomes bounded fix worker for reviewed security/body/editor paths and tests; execution worker owns Task10 leases/fencing/recovery/listener and tests. They remain fresh enough for one follow-up, then rotate as useful. K logs only, no CLI/worktree/commit/stage/push.
- Task10 must not silently acknowledge claimed work into a no-op runner while Task11 is absent: keep runtime consumer gated until a real handoff exists and test recovery/ack behavior through a real test runner boundary. Preserve intended Task11 interface.
- Coordinator Task8 verification: ExecutionAdmissionTest, ExecutionOutboxTest, ExecutionDeliveryMigrationTest passed12/12, zero failures/errors/skips, BUILD SUCCESS (118seconds). Task8 worker full196/196 remains worker evidence, not coordinator full rerun. Released shared target/source-edit slot to fix and Task10 workers; coordinate serialized tests. M1 acceptance remains open pending audit fixes.

#### 2026-09-22 review and worker rotation
- M1 fixes reviewed: explicit internal HEAD denial before usage lookup; editorState scanned recursively before persistence. Full-chain matrix-parameter probe rejects the request, so the earlier bypass claim is withdrawn, not a confirmed exploit. Existing cross-service attach/delete advisory race remains documented without invented protocol.
- Task10 worker reports15/15 focused tests, fullcombined pending. Root inspected listener gate/runnerboundary and lease/recovery source; runtime remains disabled until realTask11runner.
- Rotate to fresh Luna MAX workers: Task11 runtime lane owns runner/nodeexecution/stateadapter/listener/config and tests; Task12 API lane owns executioncontroller/query/readprojections/contracts and HTTPtests. No overlapping source writes; API lane consumes existing admissionport and schema, asks runtimeworker before any entity/DTO changes.
- Logs K only with2026-09-22 date. Root owns plan/ledger, retains review. No CLIagents/worktrees/staging/commits/push. Wait root fulltest release before sourceedits/Maven, then coordinate serialized testslots.
- Coordinator full combined verification2026-09-22:214/214 tests, zero failures/errors/skips, BUILD SUCCESS (136seconds), embedded HTTP and PostgreSQL/RabbitMQ Testcontainers included. Audit fix dispositions accepted; Task10 usable for runtime integration, no completeengine claim. Fresh workflow_runtime_v2 and workflow_monitor_v2 now released to Task11/12; root stops after dispatch per user.

#### Task11/12 handoff review
- Task12 reports19/19 HTTP/API tests. Task11 reports only selected tests; its ExecutionRuntimeTest checks executor/timer resources, not the required realDB/Rabbit node-execution path. Task11 acceptance stays OPEN; complete missing runtime integration and retry verification before claiming M2.
- Coordinator inspected ExecutionRunner and runtime test: real Spring runner wiring, lease-loss/retry/recovery/fenced commits need integration evidence. Starting focused tests independently, not equating source-ready with complete.
- Rotate to fresh workers: runtime completion/review/fixes lane owns Task11 and execution tests; independent Task13 lane owns HTTP adapter/SSRF transport/sanitizer tests. Runtime lane owns registry/config; HTTP lane contributes NodeExecutor bean and coordinates registration. K logs only; quiet workers (no routine root messages or send_message_to_thread; only final/critical blockers), direct peer Maven coordination.
- Coordinator focused Task11 checks passed7/7 (4runner,3resource/timer), BUILD SUCCESS. No realruntime test existed in that selector; acceptance remains open. Fresh workflow_runtime_completion assigned missingintegration/fixes; workflow_http_action assignedTask13 HTTP/SSRF. Root has no activeMaven; workers coordinate quiet peer handoffs. Finalcombinedsuite required after their changes.

#### 2026-09-23 incomplete worker recovery
- User signaled workers done, but live agent inventory contains only root. Required scratchtask-11-completion-report.md and scratchtask-13-report.md absent; no new K handoff logs.
- Current artifacts show ExecutionRuntimeIntegrationTest added, without a corresponding Surefire report. Task13 currently has only OutboundTargetPolicy.java plus policy/sanitizer tests; HTTP executor, pinned transport and sanitizer implementation absent. Treat as partial work, not completion.
- Preserve all partial source/tests and restart two fresh Luna MAX workers on the SAME scopes, no advancement. Runtime lane owns integration/fixes/registry/config; HTTP lane owns HTTP policy/transport/executor/sanitizer/POM. Quiet peer coordination, explicit serialized Maven owner, no routine root messages. Logs K only date2026-09-23.

#### GPT-6 Luna worker preference and next review batch
- User explicitly requests GPT-6 Luna max for subsequent workers; use model gpt-6-luna with reasoning max and fresh bounded context.
- Recovered reports present: runtime8 realDB/Rabbit tests, combined277/277 workerreported; HTTP38/38. Root independently checks runtime+HTTP before nextrelease.
- Next scopes: Task13 transport assurance lane closes TLS hostname/SNI and timeout evidence gaps, inspects HTTP API-key header contract without silently inventing metadata. Task14 Sheets lane owns only sheetsadapter/client/tests, uses sharedtransport/sanitizer through coordinated interface. Transportlane owns any shared HTTPtransport changes; Sheetsworker requests them through peer.
- Keep workers quiet (no routine rootmessages/send_message_to_thread), serialize Maven with explicit source-ready handoff, K logs only, no externalCLIs/worktrees/staging/commit/push. Root ownsplanledger and acceptance.
- Root independent runtime+HTTP suite passed46/46 (runtime8,HTTP38), zero failures/errors/skips BUILD SUCCESS. Released source/Maven slot to fresh gpt-6-luna max workers workflow_http_assurance_6 and workflow_sheets_6. TLS/customAPIkeyheader limits remain reviewitems; providerliveSheets smoke needs configuredtestresource. Root stops afterdispatch.

#### API_KEY contract decision and next task ownership
- User explicitly chose: reject Workflow outbound HTTP API_KEY connections until Workspace resolve contract includes the configured non-secret apiKeyHeaderName. Current fixed X-Api-Key assumption is unsupported for custom Workspace connections. Add bounded fail-closed regression; no guessed default, no silent auth misrouting.
- Coordinator full Workflow suite is running after HTTP assurance/Sheets. Next workers GPT-6 Luna max fresh: Task15 unsupported integrations plus API_KEY fail-closed fix owns HttpRequestNodeExecutor/its tests, UnavailableNodeExecutor, IntegrationReadiness, TelegramTriggerIngress and tests. Task16 schedule owns publication/trigger adapter/scheduler/config/tests. Avoid overlapping publication/registry/config edits: Task15 requests readiness projection/pub integration via Task16 peer; Task16 owns those existing files. Serialized Maven after root release; K logs only, quiet workers.
- Coordinator independently ran full Workflow suite after Task13 assurance andTask14 Sheets:301/301 tests, zero failures/errors/skips, BUILD SUCCESS (3m34s), real Postgres/Rabbit integration. Released shared source/Maven slot to gpt-6-luna max Task15/APIKEYfailclosed and Task16 schedule workers. User chose API_KEY reject until additive resolved headernamecontract. No commit/staging.

#### 2026-09-23 Task15-18 review
- Task15/16 focused peer selectors passed 50; schedule architecture repair selectors passed 27 Workflow plus 2 contract tests, and the final publication fixture rerun passed 13. Application schedule processing now uses ScheduleValidationPort; Workflow GET OpenAPI documents safe trigger state.
- Task18 focused OCR client/JWT selectors passed 11. OCR source, artifact, and security-prerequisite gates default disabled. Production OCR remains blocked by OCR service verifier/allowlist and artifact resolver prerequisites; no live OCR acceptance claimed.
- Coordinator combined Workflow suite: 342 tests, 0 assertion failures, 106 Spring context errors, BUILD FAILURE. All inspected errors originate in OcrClient bean creation: two constructors without an autowiring choice, reported as no default constructor. Full suite captured in temporary weav-workflow-full-20260923.log; no secret material retained. Assign bounded OCR startup fix and Spring context regression, then rerun full suite. git diff --check clean apart from line-ending notices. No commit/stage/push.
- Next independent lane: Task17 durable webhook ingress. Workers coordinate Maven target use and keep reports quiet until final handoff. K logs only.

#### 2026-09-23 Task17/18 combined review
- OCR Spring wiring/config repair and Task17 webhook handoffs reviewed. Focused worker evidence: OCR 25/25, webhook 25/25, Workflow contract 2/2. Root inspected credential hashing, generic rejection, same-transaction admission, V4 unique index, and default-closed OCR gates.
- Root combined Workflow suite: 351 tests, 0 assertion failures, 17 context errors, BUILD FAILURE. Only failing class is WorkflowSecurityTest; its test-only POST /webhooks/{endpointKey} stub now duplicates the real WebhookController mapping. Assign bounded test repair, rerun the failing selector and then full suite. `git diff --check` has no whitespace errors (only existing line-ending notices).
- Next independent lane: Task19 Gateway exact-route proxy, with real Gateway/Workflow interoperability evidence. No commit, staging, or push.

#### 2026-09-23 Task19 review and verification
- Worker repaired the test-only webhook route collision; focused WorkflowSecurityTest plus WebhookIngressTest passed 22/22.
- Coordinator reran full Workflow Service suite with PostgreSQL/RabbitMQ Testcontainers: 351/351 tests, zero failures/errors/skips, BUILD SUCCESS (4m03s). This supersedes the prior failed combined runs.
- Gateway Task19 worker reported 90/90 unit, 74/74 e2e, typecheck/build and OpenAPI references green. Coordinator independently reran local Jest binaries after pnpm wrapper attempted a noninteractive modules purge: 90/90 unit and 74/74 fixture-backed e2e passed; local TypeScript noEmit and Nest build passed. `git diff --check` has no whitespace errors (only properties line-ending notices).
- Actual Gateway-to-Workflow authenticated runtime remains unverified: no Docker CLI on PATH/standard Docker Desktop paths and no local stack listeners. Testcontainers worked through Java but are not equivalent to the full stack. Leave this acceptance for Task21; no production credentials requested or exposed.
- Next independent scopes: Task20 web catalog/builder and Task21 configuration/acceptance, with disjoint file ownership. No stage/commit/push.

#### 2026-09-23 Task20/21 review
- Task21 acceptance handoff adds three real HTTP/PostgreSQL/RabbitMQ cases, disposable smoke script, documented closed OCR gates, and nonsecret Compose/env placeholders. Coordinator reran the complete Workflow suite after its health/config edits: 354/354 tests, zero failures/errors/skips, BUILD SUCCESS (4m12s).
- Task20 worker reports catalog/browser subsets 7/7, 11/11, 7/7, web build and scoped lint. Coordinator inspected the real browser screenshot and source: the builder still presents preset webhook success and simulated AI/email success through Run Test despite publication being blocked. This conflicts with visible dependency readiness. Assign a bounded UI truthfulness fix with browser regression.
- Compose CLI and controlled live Gateway token/workspace/URL remain absent; Java Testcontainers reaches Docker Desktop but does not prove the full Gateway stack. Full web lint has existing SettingsPage hook errors outside Task20. No staging/commit/push.

#### 2026-09-23 Task20/21 closeout review
- Task20 follow-up removed invented execution telemetry and node success states; unavailable/unconfigured nodes now show readiness badges and the button previews connections only. Coordinator independently ran Chromium workflow catalog/UI 33/33 and OCR builder 7/7 against local Vite with `VITE_API_MODE=mock`; browser assertions passed. First local run used HTTP mode and redirected to login, so its failures were test setup, then corrected and rerun green.
- Coordinator web TypeScript build and scoped ESLint passed. Full ESLint remains red only in unedited `apps/web/src/pages/SettingsPage.tsx` at lines 76/82 (plus one warning at 106); this is outside Workflow scope.
- Task21 worker independently ran Workflow `verify` with 354/354 tests and executable JAR packaging, plus Workspace contract/security selectors 63/63; parser/schema/fixture checks passed. Coordinator earlier full Workflow `test` passed 354/354. `git diff --check` remains clean apart from line-ending notices.
- GitNexus MCP detect_changes(scope=all) remains unresolved: index storage version 43 differs from installed engine version 42 and asks for a force rebuild. No commit attempted. Compose validation and live Gateway-to-Workflow smoke still require Docker CLI and a controlled disposable Gateway URL/workspace/token environment; user was asked for nonsecret setup details only. All work remains unstaged/uncommitted.
---

### Source record: 2026-09-21-workflow-cli-assistant.md


#### 1. Metadata

| Field | Value |
|---|---|
| Date / timezone | 2026-09-21 / Asia/Saigon |
| Repository | Weav, T:\Weav |
| Starting branch / commit | feature/workflow-service / current checkout |
| Author / handoff | Read-only CLI audit assistant / coordinator |
| Final status | DONE_WITH_CONCERNS |
| Scope | Audit Workflow plan Tasks 2–3 against spec sections 4–6 and 12; verify safe OpenCode/Copilot CLI availability |

#### 2. Executive summary

##### Results

- Manually reviewed the requested spec/plan scope and wrote a bounded handoff with validation-phase ambiguity, schema parity limits, interface gaps, and concrete graph/mapping cases.
- OpenCode host preflight succeeded at 1.18.21, but its single Plan request was blocked by the free-tier provider policy. Copilot launched with tool access disabled, streamed a partial audit, and was exited before its answer completed.
- No application source, runtime configuration, tests, or builds were changed or inspected. No `.env`, credentials, or global account configuration were read; no workspace/background Copilot process remained after exit.

| Check | Status | Scope |
|---|---|---|
| Build / compile | Not run | Read-only audit; no implementation |
| Unit / integration tests | Not run | Explicitly out of scope |
| CLI audit | Partial / infrastructure blocked | OpenCode free-tier provider restriction; Copilot answer interrupted before completion |
| Review | Complete with concerns | Spec sections 4–6, 12; plan constraints, decisions, Tasks 2–3 |
| Commit / PR / push | None | No commit or Git operation |

#### 3. Goals and scope

##### Goals

1. Use supported installed CLI entrypoints for a read-only pre-implementation audit.
2. Identify exact plan ambiguities and missing acceptance cases for Tasks 2–3.
3. Return a concrete handoff without changing the implementation worker’s files.

##### In scope

- Read AGENTS.md, scripts/agent-cli.ps1, the prepared Tasks 2–3 brief, Workflow spec sections 4–6 and 12, plan constraints/decisions and Tasks 2–3.
- Read the work log template and planning log for handoff conventions.
- Write only the assigned CLI scratch report and member work log.

##### Out of scope

- Reviewing or editing Task 1 changes, production source, tests, schemas, or shared planning files.
- Running tests/builds, installing CLIs, changing authentication/provider settings, or using a fallback agent.

#### 4. Context and constraints

- The branch already had uncommitted Task 1 work. Those paths were left untouched.
- The bridge defaults OpenCode to Plan mode and restricts tools to reads/search while denying .env files. Its preflight requires a Windows user profile.
- No secrets, .env files, tokens, cookies, or account configuration were read.

#### 5. Session record

| Stage | Action | Result |
|---|---|---|
| 1 | Read repository instructions, bridge, spec, plan, prepared brief, and work-log template | Scope confirmed; Task 1 work remains owned by another worker |
| 2 | Discover CLIs from host Windows PowerShell | OpenCode 1.18.21 and Copilot 1.0.86 found. Copilot help and permission/sandbox help exited 0; its TUI banner showed 1.0.81, an unresolved version discrepancy |
| 3 | Run required bridge preflight and one OpenCode Plan request | `Check -Tool Auto` exited 0 and reported OpenCode ready (also Antigravity ready, not used). OpenCode Run exited 1 / bridge code 40 with free-tier policy denial; no retry or provider change |
| 4 | Run one Copilot prompt-only Plan session | Noninteractive `-p` requires `--allow-all-tools`, so used interactive `-i` with empty tool allowlist, deny write/shell/url, MCP/remote/update/custom instructions disabled. Empty allowlist denied internal plan-edit and shell attempts. Model answered only partially; the response was cancelled before explanation completed |
| 5 | Stop and verify CLI process; reconcile findings | `/exit` returned exit code 0; a read-only process query found no remaining `copilot/npm-loader.js` Node process. Manual audit and report completed; no tests/builds run |

#### 6. Decisions

| Decision | Evidence | Consequence |
|---|---|---|
| Stop OpenCode after provider denial | Required preflight completed; the Plan run failed with bridge code 40 and the free-tier-only-within-OpenCode message | No retry, provider/model change, or fallback tool |
| Keep Copilot prompt-only and tool-denied | Help says noninteractive mode requires `--allow-all-tools`; interactive Plan accepted the empty allowlist and explicit deny flags | No filesystem/repository tool use was allowed; the partial response is not complete CLI validation |
| Treat mapping wording as ambiguous | Plan lines 67/175 defer mapping semantics to publish; line 207 says grammar must match “now” without naming a phase; Copilot's incomplete response also said no contradiction was provable | Recommend an explicit phase sentence; do not present this as a confirmed spec contradiction |
| Complete manual spec audit | The parent requested useful findings even if either CLI is blocked/incomplete | Findings are design review only, not source/test validation |

#### 7. Changes made

- Created .superpowers/sdd/2026-09-21-workflow-service-v1/cli-assistant/report.md.
- Created .superpowers/sdd/2026-09-21-workflow-service-v1/cli-assistant/copilot-task-prompt.md for the bounded prompt; the first oversized inline attempt did not start Node because the Windows command line was too long.
- Created docs/work_logs/T/2026-09-21-workflow-cli-assistant.md.
- No code, schema, configuration, or tests were changed. Copilot displayed `Changes +0 -0`; its attempted internal session/plan tool operations were denied.

#### 8. Files

| Type | Path | Purpose |
|---|---|---|
| Added | .superpowers/sdd/2026-09-21-workflow-service-v1/cli-assistant/report.md | CLI evidence, adjudicated findings, and proposed Task 2–3 acceptance cases |
| Added | .superpowers/sdd/2026-09-21-workflow-service-v1/cli-assistant/copilot-task-prompt.md | Bounded facts-only prompt used by the restricted Copilot session |
| Added | docs/work_logs/T/2026-09-21-workflow-cli-assistant.md | Template-based handoff and CLI evidence |

#### 9. Checks and evidence

| Check | Command / action | Actual result | Limit |
|---|---|---|---|
| CLI discovery | Host `Get-Command opencode/copilot`; `copilot --version`; Copilot help/permissions/sandbox help | Bridge reported OpenCode 1.18.21 (`opencode/big-pickle`); Copilot wrapper path was `C:\Users\nhoan\AppData\Roaming\npm\copilot.ps1`, version 1.0.86. Help calls exited 0; TUI banner showed 1.0.81 | Copilot version discrepancy remains unexplained; no direct CLI `--version/--help` for OpenCode was needed after bridge discovery |
| Required bridge preflight | `powershell.exe -NoProfile -File .\scripts\agent-cli.ps1 -Action Check -Tool Auto` from host Windows PowerShell | Exit 0; Antigravity 1.1.27 and OpenCode 1.18.21 both ready; OpenCode default model `opencode/big-pickle` | Antigravity was not selected for work |
| OpenCode task request | Bridge `-Action Run -Tool OpenCode -Mode Plan -TimeoutSec 300 -AllowRepoContext` with bounded prompt | Exit 1, bridge code 40: `OpenCode's free tier can only be used from within OpenCode` | Provider/policy block; no source conclusions and no retry/model switch |
| Copilot restricted audit | Interactive Plan `-i`, empty `--available-tools`, deny `write`, `shell`, `url`, disable builtin MCP/remote/auto-update/custom instructions; bounded prompt from owned scratch | CLI launched and selected default Auto → gpt-5.6-luna. TUI showed `Changes +0 -0`; internal plan-edit/shell attempts were denied. It returned “No fully provable contradiction is established by the bounded facts,” then began explaining the mapping wording but was cancelled before completion | Partial output only; no full CLI audit. Initial oversized prompt failed before Node/model startup due Windows command-line length |
| Process cleanup | `/exit`; read-only `Get-CimInstance Win32_Process` filtered to Node `copilot/npm-loader.js` | CLI exited 0; process query exited 0 with no matches | No Copilot worker process remained |
| Tests / builds | Not run | Not applicable to this read-only audit | Implementation worker owns validation |
| Git writes / commits | None | No stage, commit, push, or merge | Existing branch/worker changes were not touched |

#### 10. Risks and blockers

| Severity | Issue | Evidence | Next step |
|---|---|---|---|
| Medium | OpenCode task audit unavailable | Bridge code 40; free-tier CLI-use restriction | No retry or provider switch in this assignment; treat as infrastructure only |
| Medium | Copilot task audit incomplete | One restricted session streamed only an incomplete explanation before cancellation | Treat the one observed statement as partial output, not audit consensus |
| Review | Task 2/3 design clarifications | Detailed in report; especially plan lines 67/175 versus line 207's “now” | Coordinator may clarify the validation phase before implementation |

#### 11. Handoff

##### Ready now

1. Review report.md for specific task clarifications and tests.
2. Keep Task 2 pure validators/schema tests separate from persistence/log assertions already owned by Task 5’s WorkflowDraftPersistenceTest.
3. Treat the Copilot output only as partial corroboration that no contradiction is yet proven; its explanation was cut off. Do not treat either CLI attempt as implementation/test evidence.

##### Blocked access

- OpenCode task audit was blocked after successful preflight by its free-tier policy.
- Copilot launched safely but did not complete its answer; no remaining process was found.

#### 12. References

- docs/superpowers/specs/workflow-service-spec.md, sections 4–6 and 12.
- docs/superpowers/plans/2026-09-21-workflow-service-v1.md, Global Constraints, Planning Decisions, Tasks 2–5.
- .superpowers/sdd/2026-09-21-workflow-service-v1/tasks-2-3-cli-brief.md.
- scripts/agent-cli.ps1 and AGENTS.md.
- docs/work_logs/log_template.md.

#### 13. Session end

| Field | Value |
|---|---|
| Stop time | 2026-09-21 11:37:05 Asia/Saigon |
| Worktree | Existing worker changes remain; only assigned report, prompt, and work-log paths were written by this assistant |
| Commit / PR / push | None |
| Updated by | CLI audit assistant |
| Read before continuing | Report.md; plan Tasks 2–3 and draft/publish clarification |
---

### Source record: 2026-09-21-workflow-service-task-1.md


#### Coordinator review — fix round 1

- Reviewed the worker's Task 1 source/diff/tests and reported 22/22 full suite. Acceptance is pending two reproduced edge cases.
- `JsonValues` currently accepts mutable/custom subclasses of `BigInteger`/`BigDecimal`; a compiled Java probe against current source showed the frozen numeric value changing after source mutation. Reject subclasses or otherwise guarantee the exact supported immutable JSON number contract; add regression coverage for both types.
- `WorkflowExecution.fail`, `NodeExecution.complete`, and `NodeExecutionAttempt.succeed` assign state before JSON validation can throw. A compiled probe showed a rejected update leaving the execution FAILED. Freeze into a local first; verify rejection preserves status, timestamps, and prior output/error for all three methods.
- Probe is in ignored `.superpowers/sdd/2026-09-21-workflow-service-v1/review-probe/Task1ReviewProbe.java`. No production code was changed by the coordinator.
- Probe evidence: `Frozen numeric subclass changed: 2` and `Rejected update left status: FAILED`.
- Worker receives this bounded fix round. A separate Luna MAX assistant will conduct read-only OpenCode/Copilot review of plan Tasks 2–3. No commit or next-task implementation is authorized before coordinator acceptance.
- Fix round 1 resolution: require exact standard `BigInteger`/`BigDecimal` classes, and validate all three mutator JSON arguments into locals before changing aggregate state. RED: 12 `JsonValuesTest` tests, 5 failures (both mutable number subclasses and each partial-state mutation). GREEN: focused suite 17/17 and final full suite 27/27; PostgreSQL JSONB test passed.

#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối ngày | Task 1 và coordinator fix round 1 hoàn thành; chưa commit |
| Phạm vi session | JSON snapshot utility, aggregate isolation, architecture rules, JSONB round-trip test |
| Liên kết liên quan | Task brief, V1 plan, authoritative Workflow spec, planning log |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thêm `JsonValues.freeze(Object)` và `freezeMap(Map<String,Object>)` để sao chép JSON đệ quy, giữ explicit `null`, từ chối dữ liệu không phải JSON và trả về cấu trúc sâu bất biến.
- Áp dụng sao chép sâu cho tám aggregate Workflow/Execution được giao, gồm các cập nhật output/error hiện có; giữ nguyên trạng thái và lifecycle behavior.
- Chặn custom subclass của `BigInteger`/`BigDecimal`; ba mutator chỉ cập nhật aggregate sau khi JSON hợp lệ đã được freeze.
- Bổ sung kiểm tra kiến trúc, kiểm thử unit cho giá trị và aggregate, và một JSONB round trip qua PostgreSQL thật bằng Testcontainers.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Compile thành công trong full module test |
| Unit / integration test | `PASS` | Final fix-round suite: 27 tests, 0 failures/errors/skips |
| Migration / database | `PASS` | Existing V1 migration và JSONB round trip chạy trên PostgreSQL 18.6 Testcontainers; không sửa migration |
| Health check | `Chưa kiểm tra` | Không khởi chạy application stack |
| Review thay đổi | `Đã kiểm tra` | `git diff --check` sạch; source/diff tự rà soát |
| Commit / PR | Chưa tạo | Giữ thay đổi để coordinator review |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Bảo đảm JSON được lưu trong aggregate là snapshot sâu, không bị thay đổi qua map/list nguồn hoặc getter.
2. Giữ `null` hợp lệ trong JSON, từ chối kiểu/key không hợp lệ và không biến đổi trạng thái aggregate.
3. Chứng minh ranh giới kiến trúc và lưu trữ JSONB bằng kiểm thử.

##### Trong phạm vi

- `JsonValues` mới; tám aggregate được nêu trong Task 1.
- Scaffold `WorkflowCleanArchitectureTest`, unit test JSON, PostgreSQL JSONB round trip.
- Work log Task 1 và báo cáo bàn giao.

##### Ngoài phạm vi / chủ động chưa làm

- Tasks 2–21, use case/engine/lifecycle mới, API hoặc schema/migration mới.
- `AgentRun` và `AgentStep` JSON placeholder; không sửa các aggregate ngoài danh sách được giao.
- Docker/Compose/configuration, UI, contract liên service, startup application stack.
- Commit, stage, push, merge hoặc dọn file không thuộc Task 1.

##### Tiêu chí hoàn thành

- [x] Deep copy, explicit JSON null, kiểm tra key/value/container, và immutable getters.
- [x] Aggregate constructors cùng các phương thức cập nhật JSON hiện có dùng utility.
- [x] ArchUnit rules và unit/integration evidence chạy được.
- [x] Work log và report được ghi; các file untracked có trước được giữ nguyên.

#### 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Workflow Service V1 đang ở trạng thái scaffold. Spec `docs/superpowers/specs/workflow-service-spec.md` là nguồn sự thật; Task 1 không thêm lifecycle behavior.
- **Giả định đã dùng:** `freezeMap(null)` giữ hành vi tùy chọn hiện có bằng empty map; `freeze(null)` trả JSON null. Số được nhận là các kiểu Java chuẩn bất biến (`Byte`, `Short`, `Integer`, `Long`, `BigInteger`, `BigDecimal`) và `Float`/`Double` hữu hạn.
- **Ràng buộc:** Không sửa database schema, service/API contract, dependency hoặc framework configuration. Giữ nguyên ba tài liệu untracked đã có trước khi làm việc.
- **Nguồn sự thật:** Task brief, Task 1 trong `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, `docs/superpowers/specs/workflow-service-spec.md`, và POM/source hiện hành.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — Task 1

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước sửa code | Đọc hướng dẫn/spec/plan/work log; kiểm tra branch và status | HEAD `c836de2`; ba file plan/spec/planning log untracked đã có được giữ nguyên | Xong |
| Trước sửa code | GitNexus query/context/upstream impact và baseline Workflow suite | Baseline 12 tests pass; impact không báo HIGH/CRITICAL | Xong |
| Trong phiên | Viết test trước, sau đó triển khai utility và aggregate integration | RED: compile thiếu `JsonValues`; 7 unit tests có 5 failures + 2 errors với stub identity; JSONB test 1 failure trước deep copy | Xong |
| 10:12 | Chạy nhóm test mục tiêu sau triển khai | 12 tests pass, gồm ArchUnit, JSON freeze, JSONB round trip và persistence test hiện có | Xong |
| 10:17 | Chạy full suite, phát hiện deprecation trong assertion test mới | 22 tests pass; thay assertion deprecated bằng structural `JsonNode` equality và kiểm tra lại riêng JSONB test | Xong |
| 10:18 | Chạy cuối full suite sạch sau lần sửa assertion | 22 tests pass, không có compiler deprecation; `git diff --check` sạch trước khi ghi log | Xong |

##### Session 2 — Coordinator review fix round 1

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước sửa | Chạy GitNexus `impact` cho `fail`, `complete`, `succeed` và helper mới; tìm call sites | `fail`/`succeed`: UNKNOWN, 0 caller; `complete`: UNKNOWN/lower-bound, 1 receiver-typing gap; helper chưa có trong index. Source search không tìm production call sites | Xong |
| 10:48 | Bổ sung regression test trước implementation | RED: 12 unit tests, 5 failures gồm BigInteger/BigDecimal subclasses và state bị đổi bởi `fail`/`complete`/`succeed` khi input không hợp lệ | Xong |
| 10:49 | Sửa nhận diện immutable number và thứ tự cập nhật | Chỉ exact standard numeric classes được nhận; freeze vào biến local trước khi gán error/output/status/timestamp | Xong |
| 10:50 | Chạy focused suite | 17 tests pass, gồm 12 unit tests, 2 ArchUnit rules, 2 persistence tests và PostgreSQL JSONB round trip | Xong |
| 10:51 | Chạy full Workflow suite cuối fix round | 27 tests pass, 0 failures/errors/skips; compiler warning/deprecation output sạch; PostgreSQL 18.6/Testcontainers | Xong |

##### Diễn giải quan trọng

- TDD RED đầu tiên là compile failure vì class chưa có; sau đó dùng stub identity tạm để quan sát lỗi hành vi, rồi thay stub bằng utility thực. Không giữ stub trong diff cuối.
- JSONB test dùng `Workflow` snapshot, Jackson tree và `WorkflowJpaEntity` hiện có; test flushes, clears persistence context, reloads row rồi xác minh `null` và list value còn nguyên.
- Review probe do coordinator cung cấp tái hiện BigInteger subclass đổi giá trị hiển thị sau khi freeze và `WorkflowExecution.fail` đổi trạng thái thành `FAILED` trước khi JSON rejection xảy ra. Regression RED lần này xác nhận cả BigDecimal subclass và ba mutator; source search sau đó chỉ thấy mutator call sites trong `JsonValuesTest`, không có production callers.
- GitNexus method impact: `fail` và `succeed` có `risk=UNKNOWN`, 0 caller được resolve; `complete` có `risk=UNKNOWN`, 0 caller và `epistemic=lower-bound` do 1 call site bị rơi vì receiver typing. `isImmutableNumber` không có trong index vì là symbol mới; source search cho thấy chỉ có khai báo private và call từ `JsonValues.freeze`.
- Maven wrapper trong sandbox gặp lỗi path `$MAVEN_M2_PATH.Target[0]` và quyền đọc cache/JAR; quyền Docker CLI cũng bị sandbox từ chối. Chạy kiểm thử được ủy quyền qua tool escalation, với `MAVEN_USER_HOME` trỏ tới junction tạm của `.m2` hiện có, `-Dmaven.repo.local` trỏ repository cache hiện có và `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`. Không thay đổi wrapper, POM hay repo config.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng `LinkedHashMap`/`ArrayList` để copy rồi bọc unmodifiable | Giữ thứ tự duyệt và tạo snapshot sâu; không dùng `Map.copyOf` vì nó từ chối explicit null và chỉ copy nông | Shallow copy hoặc stringify | Map/list lồng nhau được bảo vệ; dữ liệu không JSON báo lỗi rõ ràng |
| Chỉ nhận map string-keyed, list và scalar JSON chuẩn | Không âm thầm serialize arbitrary objects; từ chối container chu kỳ và số không hữu hạn | Chấp nhận mọi `Number`/`Collection` | Kiểu số custom/mutable và collection không phải list bị từ chối |
| Chỉ nhận exact standard `BigInteger`/`BigDecimal` class | Các class có thể subclass; probe chứng minh custom subclass có thể thay đổi `toString()` sau khi `freeze` | `instanceof` | Subclass tùy chỉnh bị từ chối; BigInteger/BigDecimal chuẩn vẫn giữ nguyên độ chính xác và scale |
| Freeze JSON update vào biến local trước khi đổi aggregate | Kiểm tra invalid/cyclic input có thể ném; mọi status/timestamp/output/error phải giữ nguyên khi validation thất bại | Gán status/timestamp trước khi freeze | `fail`, `complete`, `succeed` chỉ mutate sau khi freeze thành công |
| Dùng `.allowEmptyShould(true)` cho rule application | Các lớp application hiện là file scaffold rỗng | Bỏ rule đến khi có code | Rule có hiệu lực khi application source được thêm; kiểm thử hiện chạy qua scaffold |
| Thêm test JSONB độc lập | Giữ nguyên `WorkflowPersistenceTest` đang có tác động GitNexus `UNKNOWN` | Mở rộng test hiện hữu | Dùng PostgreSQL/Testcontainers thật; test context còn khởi động RabbitMQ theo cấu hình dùng chung |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `JsonValues.freeze` bảo toàn null, scalar JSON và số bất biến/hữu hạn; deep-copy map/list; từ chối object, key không phải chuỗi, số mutable/custom, số không hữu hạn và chu kỳ.
- Số `BigInteger`/`BigDecimal` chỉ được nhận khi runtime class chính xác là class chuẩn; subclass mutable bị từ chối, trong khi test giữ nguyên số nguyên lớn và scale của decimal chuẩn.
- `freezeMap` giữ optional null map thành immutable empty map.
- `Workflow`, `WorkflowVersion`, `WorkflowTrigger`, `WorkflowExecution`, `NodeExecution`, `NodeExecutionAttempt`, `ExecutionLog`, `OutboxEvent` dùng deep copy ở điểm nhận/cập nhật JSON; `fail`, `complete`, `succeed` validate JSON trước khi đổi status/timestamp/output/error.
- `WorkflowCleanArchitectureTest` cấm domain phụ thuộc Spring/framework, JPA, Hibernate, Jackson, RabbitMQ và các package HTTP phổ biến; cấm application phụ thuộc infrastructure/presentation.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Workflow schema hiện có.
- **Migration:** Không thêm/sửa migration; Testcontainers tự áp dụng migration V1 hiện có.
- **Dữ liệu test:** Một JSON definition có nested null và array chứa null/value; không dùng dữ liệu cá nhân.
- **Tính tương thích:** Không đổi schema/API; JSONB giữ explicit null sau persist/reload.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi cấu hình hay dependency. Test sử dụng Docker Desktop/Testcontainers có sẵn; test container ghi nhận PostgreSQL `18.6`.

##### 7.4. API, bảo mật và quan sát hệ thống

- Không đổi route, contract, security, logging hoặc health endpoint.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/JsonValues.java` | JSON deep freeze utility | Utility framework-free |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/{workflow,execution}/...` (8 aggregate) | Thay shallow copy bằng `freezeMap` | Không bao gồm AgentRun/AgentStep |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/architecture/WorkflowCleanArchitectureTest.java` | Bổ sung 2 ArchUnit rules | Rule app cho phép scaffold rỗng |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/definition/JsonValuesTest.java` | Scalar/null/list/map/invalid/cycle/aggregate/update-state assertions | 12 unit tests |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/WorkflowJsonbRoundTripTest.java` | PostgreSQL JSONB integration round trip | Testcontainers chạy Postgres và RabbitMQ dùng chung |
| `Thêm` | `docs/work_logs/T/2026-09-21-workflow-service-task-1.md` | Log Task 1 | Theo template work log |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-1-report.md` | Báo cáo cho coordinator | Không sửa plan/ledger dùng chung |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Baseline | Module `services/workflow-service`: `mvnw.cmd -B '-Dstyle.color=never' test` với UTC timezone | PASS; 12 tests, 0 failures/errors/skips | Trước sửa code; Testcontainers đã dùng Docker |
| TDD RED ban đầu | `-Dtest=JsonValuesTest` khi `JsonValues` chưa tồn tại; sau đó stub identity; `-Dtest=WorkflowJsonbRoundTripTest` | Compile failure thiếu class; unit RED 7 tests (5 failures, 2 errors); JSONB RED 1 failure | Lỗi trước implement ở Task 1 |
| Fix round 1 RED | `-Dtest=JsonValuesTest test` | RED; 12 tests, 5 failures, 0 errors: BigInteger subclass, BigDecimal subclass, và ba aggregate mutators đổi state trước khi JSON rejection | Regression mới tái hiện cả hai finding |
| Task 1 focused GREEN | `-Dtest=JsonValuesTest,WorkflowCleanArchitectureTest,WorkflowPersistenceTest,WorkflowJsonbRoundTripTest test` | PASS; 12 tests, 0 failures/errors/skips | Trước coordinator fix round 1 |
| Fix round 1 focused GREEN | Cùng focused selector trên | PASS; 17 tests, 0 failures/errors/skips | 12 JSON tests, 2 ArchUnit, 2 persistence, 1 PostgreSQL JSONB |
| Sau assertion cuối | `-Dtest=WorkflowJsonbRoundTripTest test` | PASS; 1 test | Không còn compiler deprecation ở test mới |
| Task 1 full module | `clean test`, compiler warnings/deprecations enabled, UTC timezone | PASS; 22 tests, 0 failures/errors/skips | Trước fix round 1 |
| Fix round 1 full module | `clean test`, compiler warnings/deprecations enabled, UTC timezone | PASS; 27 tests, 0 failures/errors/skips | Full Workflow Service suite; real PostgreSQL 18.6/Testcontainers JSONB test |
| Static/diff | `git diff --check` và kiểm tra whitespace file mới | PASS, không có whitespace error | Re-run after final log/report edits |

Lệnh full module cuối cùng (PowerShell):

```powershell
$junction = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repo = 'C:\Users\nhoan\.m2\repository'
if (-not (Test-Path -LiteralPath $junction)) {
  New-Item -ItemType Junction -Path $junction -Target 'C:\Users\nhoan\.m2' | Out-Null
}
$junctionTarget = (Get-Item -LiteralPath $junction).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junction
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
Set-Location 'T:\Weav\services\workflow-service'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repo" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' clean test
```

Junction tại `C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home` trỏ tới `C:\Users\nhoan\.m2`; `-Dmaven.repo.local` trỏ chính xác tới `C:\Users\nhoan\.m2\repository`. Do wrapper/cache/Docker access bị sandbox chặn, lệnh đã chạy qua authorized escalation. Không có thay đổi cấu hình trong repo.

##### Điều chưa được kiểm tra

- Không khởi chạy service thật/health check; Task 1 là domain snapshot và test persistence.
- Không chạy GitNexus `detect_changes`, vì không có commit trong phần việc này; chạy trước khi commit theo hướng dẫn repo.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Thấp | GitNexus index cũ | Index `4aad0cec6b572c085f3d51cee311db2a0d82753e` đứng sau HEAD 3 commit docs-only; lần refresh trước ghi nhận EPERM/stall | Dùng MCP graph với cảnh báo độ cũ, rồi tìm source/manual; không coi UNKNOWN là an toàn | Coordinator cân nhắc refresh index khi có môi trường ổn định |
| Thấp | `WorkflowExecution.fail`, `NodeExecution.complete`, `NodeExecutionAttempt.succeed` có impact `UNKNOWN` | Index không giải quyết receiver call; không có caller trong graph | Trước khi thêm regression test, `rg` trên Workflow main/test chỉ thấy declarations trong các class mục tiêu; test mới hiện gọi các method update để xác minh deep copy | Review coordinator; không mở rộng sang agent aggregates |
| Thấp | `NodeExecution.complete` caller walk là lower-bound | GitNexus ghi nhận một callsite không được resolve do receiver typing; `fail`/`succeed` đều 0 caller được resolve | Source search hiện chỉ thấy test calls; production callsite không tìm thấy. Giữ `UNKNOWN`, không coi 0 là all-clear | Index refresh/review trước commit nếu cần |
| Thấp | Helper `JsonValues.isImmutableNumber` không có trong index | Helper được tạo trong Task 1 sau snapshot index | Source review xác nhận helper private và chỉ được gọi từ `JsonValues.freeze`; graph không đưa ra risk verdict | Re-index trước commit nếu cần |
| Thấp | Wrapper/Docker bị sandbox chặn lúc đầu | Wrapper null array path và access denied trên cache/JAR/Docker CLI | Dùng escalation cho lệnh test được yêu cầu và junction Maven tạm | Không còn blocker; không đổi repo tooling |

Không có HIGH/CRITICAL GitNexus risk được ghi nhận. Với các aggregate, upstream class impact được báo `LOW`, thường có một factory/caller trong cùng class và không có process/module impact. `WorkflowPersistenceTest` được GitNexus báo `UNKNOWN`, nên không sửa; test JSONB mới được thêm riêng. Không đọc hay ghi secret.

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Review Task 1 diff và report: `.superpowers/sdd/2026-09-21-workflow-service-v1/task-1-report.md`.
2. Nếu chấp nhận, coordinator tiếp tục Task 2 theo shared plan; giữ Task 1 riêng để dễ review.
3. Chạy `detect_changes` trước commit; không có commit nào được tạo trong session.

##### Cần quyết định / quyền truy cập từ người khác

- Không cần quyết định để review Task 1. Coordinator quyết định thời điểm index GitNexus được làm mới trước commit nếu cần.

##### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, Task 1 report, spec và `git status` trước khi sửa.
- Không sửa các Task 2–21 khi review Task 1; không xóa/sửa ba file untracked ban đầu.
- Chạy `detect_changes` trước commit theo `AGENTS.md`.

#### 12. Tham chiếu

- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-1-brief.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Global Constraints và Task 1
- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/work_logs/T/2026-09-21-workflow-service-planning.md`
- `docs/work_logs/log_template.md`

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 10:57 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi Task 1 chưa commit; ba file untracked đã có trước được giữ nguyên |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker |
| Cần đọc trước khi tiếp tục | Phần 11, Task 1 report, `git status` |

---

#### Checklist trước khi đóng log

- [x] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [x] Quyết định kỹ thuật có lý do và hệ quả.
- [x] File thay đổi, migration và dependency được nêu.
- [x] Có lệnh tái lập cho kiểm tra đã tuyên bố.
- [x] Rủi ro và bước tiếp theo có chủ sở hữu.
- [x] Không có secret hoặc dữ liệu nhạy cảm.
- [x] Trạng thái commit/PR và worktree được ghi chính xác.
---

### Source record: 2026-09-21-workflow-service-task-2.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối ngày | Task 2 hoàn thành; chưa commit |
| Phạm vi session | Workflow definition records/catalog, draft/publish validation, Jackson codec, JSON Schema và test |
| Liên kết liên quan | Workflow Service V1 plan, authoritative spec, Task 2 report |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thêm immutable domain records `WorkflowDefinition`, `Node`, `Edge`, catalog 13 node V1, `ValidationIssue` và validator thuần Java.
- Phân biệt draft structural/security validation với publish required-config, graph/DAG, reachability, trigger-root, port và schedule validation.
- Thêm Jackson 3 codec cùng JSON Schema 2020-12 cho draft envelope và catalog/config shapes; schema và catalog được kiểm tra field-by-field trong test.
- Kiểm thử codec giữ nested JSON `null`, snapshot mutation, malformed fields, UUID, credential safety, limits và graph rules.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Full Workflow module Maven test compile thành công; không có compiler deprecation/warning |
| Unit / integration test | `PASS` | Focused 35/35; full suite 62/62, không failure/error/skip |
| Migration / database | `PASS` | Không thêm migration; full suite chạy JSONB round trip trên PostgreSQL 18.6/Testcontainers |
| Health check | `Chưa kiểm tra` | Không khởi chạy service stack; Task 2 là domain/codec/schema |
| Review thay đổi | `Đã kiểm tra` | Scope rà soát, `git diff --check` và kiểm tra whitespace file mới sạch |
| Commit / PR | Chưa tạo | Thay đổi được giữ cho coordinator review |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Tạo model executable graph bất biến và catalog node V1 rõ ràng.
2. Kiểm tra drafts cho cấu trúc/giới hạn/ID/credential safety; chỉ yêu cầu đầy đủ config và graph semantics khi publish.
3. Decode/encode JSON bằng hạ tầng Jackson mà không kéo framework vào domain; công bố schema draft.

##### Trong phạm vi

- `WorkflowDefinition`, `DefinitionValidator`, `NodeCatalog`, `ValidationIssue`.
- `DefinitionJsonCodec`, `packages/contracts/http/workflow/definition.schema.json`.
- Hai test suite tập trung và log/report Task 2.

##### Ngoài phạm vi / chủ động chưa làm

- Tasks 3–21; mapping parser/static upstream reference checks thuộc Task 3.
- Wiring application/use case, Spring schedule adapter, HTTP endpoint, persistence behavior hoặc rejected-draft database proof (Task 5).
- Migration, UI, agent/task execution, provider integrations, commit/stage/push/merge.
- Chỉnh sửa `JsonValues` hoặc các Task 1 aggregate; không sửa plan/ledger dùng chung.

##### Tiêu chí hoàn thành

- [x] Deep immutable snapshots cho graph lists, node config và variables; giới hạn JSON depth/definition size.
- [x] 13 types được hỗ trợ; `agent.task` và `google.docs` bị từ chối.
- [x] Draft và publish checks tách riêng; schedule callback không phụ thuộc Spring.
- [x] Codec và schema draft/config shape có test; config field parity với `NodeCatalog` được kiểm tra.
- [x] Focused và full Workflow tests, diff check, work log/report.

#### 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Task 1 đã được coordinator chấp nhận. `JsonValues.freezeMap` là helper deep-freeze cho JSON. Spec tại `docs/superpowers/specs/workflow-service-spec.md` là nguồn sự thật.
- **Giả định đã dùng:** Email dùng `to`, `subject`, `body`, theo default hiện tại của UI catalog đã được coordinator làm rõ. `to` nhận string hoặc danh sách string.
- **Ràng buộc:** Draft cho phép thiếu required config/nguồn OCR nhưng vẫn từ chối shape sai, catalog field sai, ID sai, credential fields và URL userinfo. Mapping grammar không được nhân đôi trong Task 2.
- **Nguồn sự thật:** Task 2 và clarification trong `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, authoritative spec, `JsonValues` và POM hiện tại.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — Task 2

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước sửa | Đọc spec, plan Task 2/clarification, hướng dẫn, work log/template và Task 1 JSON helper; kiểm tra branch/status | HEAD `c836de2`; file plan/spec/planning log và Task 1 files có sẵn được giữ nguyên | Xong |
| Trước sửa | GitNexus upstream impact cho tên symbol mới | `DefinitionValidator`/`DefinitionJsonCodec`: target không có trong index, `risk=UNKNOWN`; `WorkflowDefinition` bị resolve nhầm sang web TypeScript interface, HIGH/32 callers; source search xác nhận Java record là file backend mới và UI không sửa | Xong |
| 11:39 | Viết test Task 2 trước implementation và sửa cú pháp test | Sau khi sửa text block/generic-map assertion, RED compile báo 12 lỗi thiếu đúng các production types Task 2 | Xong |
| 11:45–12:11 | Thêm domain records/catalog/validator, codec, schema; lặp focused tests | Sau khi thêm schema, suite tập trung lần lượt đạt 30/30, 31/31 rồi 35/35 qua các thay đổi cuối | Xong |
| 12:14 | Chạy full Workflow module suite với Docker/Testcontainers | 62 tests, 0 failures/errors/skips; PostgreSQL 18.6 JSONB round trip pass | Xong |
| 12:15 | Rà scope và whitespace | `git diff --check` cùng trailing-whitespace check cho file mới đều pass | Xong |

##### Diễn giải quan trọng

- RED đầu tiên sau khi test syntax hợp lệ là test-compile failure với 12 missing-symbol errors cho `DefinitionValidator`, `WorkflowDefinition`, `NodeCatalog` và `DefinitionJsonCodec`; đó là feature RED dự kiến trước production implementation. Trước bước này có một text-block syntax typo và hai generic `Map<?,?>.put` assertion không compile; đã sửa cả hai trước khi nhận feature RED.
- Một focused run trung gian sau production code có 30 test, 1 failure duy nhất vì schema file chưa được tạo. Sau khi schema và các parity assertions được thêm, focused run cuối pass 35/35.
- `WorkflowDefinition` copy lists và freeze nested config/variables. Depth 32 tính trên cả envelope; codec kiểm tra depth trước khi chuyển tree sang Java objects. JSONB round trip test là test Task 1 có sẵn và được chạy lại trong full suite.
- Draft không parse mapping. Kiểm tra ordering operand chỉ hoãn type khi thấy delimiter; parser/grammar và static upstream checks vẫn thuộc Task 3. `DefinitionValidator()` từ chối schedule publish với `SCHEDULE_VALIDATION_UNAVAILABLE`; application wiring sẽ cấp callback khi Task 16 cung cấp cron/timezone adapter.
- Schema cố ý để `config` fields không bắt buộc trong draft. Schema thể hiện node/config type/enum/UUID/count; Java làm thêm unique IDs, depth/bytes, credential checks và graph semantics. Test kiểm tra schema config property names khớp `NodeCatalog` cho toàn bộ 13 types.
- GitNexus index báo stale ba commits. Hai symbol backend mới không được indexed (`UNKNOWN` không được coi là low/safe); tên `WorkflowDefinition` bị trùng với TypeScript UI interface có HIGH impact, nhưng `rg` xác nhận đây là path khác và không có UI edit. Không thử reindex do giới hạn/tooling caveat được ghi ở Task 1.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Ghi nhận definition bằng Java records và immutable list/map snapshots | Definition là giá trị JSON thuần; `JsonValues.freezeMap` giữ explicit null và deep copy | Mutable DTO/JPA entity | Domain tách khỏi storage/framework; cấu hình sau khi nhận không đổi theo nguồn/getter |
| Tách draft structural/security checks khỏi publish completeness/graph checks | Task 2 clarification cho phép node chưa hoàn thiện khi lưu draft | Bắt buộc mọi field ở draft | UI có thể lưu cấu hình chưa xong; publish vẫn fail theo field/graph |
| Dùng nested `ScheduleValidation` callback | Domain không được import Spring `CronExpression`; no-arg phải fail closed khi schedule cần xác minh | Parse cron hoặc timezone trong domain | Task 16 cung cấp adapter qua application wiring |
| Không tạo mapping parser trong Task 2 | Task 3 sở hữu grammar và static upstream references | Regex/second parser trong validator | Mapping expression được giữ ở config; Task 3 phải hoàn thiện publish integration |
| Dùng JSON Schema 2020-12 làm draft/config envelope | Tài liệu contract có thể biểu diễn shape/enum/UUID/count nhưng không graph/depth-byte rules | Yêu cầu publish-complete required fields ở schema | Java là enforcement bổ sung; `$comment` mô tả parity boundary |
| Không chọn provider-specific email fields | Spec chỉ định typed recipient/subject/body; coordinator xác nhận `to`/`subject`/`body` từ current UI default | Thêm cc/bcc/provider options | Các field ngoài hợp đồng bị từ chối; không thay đổi UI |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `WorkflowDefinition`, `Node`, `Edge` deep-freeze JSON config/variables, copy graph lists, giữ null value và enforce depth tổng thể 32.
- `NodeCatalog` cho đúng 13 types và allowed config field whitelist.
- `DefinitionValidator` kiểm tra schema version, field/type shape, required publish fields, connection UUID, credential/header names không phân biệt hoa thường, URL userinfo, giới hạn, graph IDs/edges/DAG/reachability, trigger roots, branch ports và schedule callback.
- `DefinitionJsonCodec` decode/encode JSON qua Jackson 3; reject malformed/unknown envelope/node/edge fields, non-object config, JSON depth vượt 32 và serialized input vượt 1 MiB; chuyển nested JSON null qua lại.
- `definition.schema.json` mô tả 13 types, config field type/enum shapes, connection UUID và draft node/edge bounds; không bắt buộc publish-complete fields.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không đổi Workflow database schema.
- **Migration:** Không thêm/sửa migration.
- **Dữ liệu test:** Nested null/map/list, test credentials tổng hợp, UUID giả ngẫu nhiên và graph hư cấu; không dùng secret/PII.
- **Tính tương thích:** Không thay endpoint/database contract; Task 2 chỉ thêm domain/codec/schema types.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi dependency/configuration. Test dùng Maven cache hiện có qua junction tạm; Testcontainers kết nối Docker Desktop hiện có.

##### 7.4. API, bảo mật và quan sát hệ thống

- Chưa thêm route. Validator không echo rejected values; diagnostics giữ node/field/code/message tổng quát. HTTP SSRF destination controls vẫn thuộc execution/integration work, không được xem là hoàn tất ở Task 2.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/WorkflowDefinition.java` | Immutable definition/node/edge records | Pure Java, dùng `JsonValues` |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java` | Draft/publish/security/graph validation | Mapping parser được để Task 3; schedule callback cần adapter sau |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/NodeCatalog.java` | Whitelist 13 types và config fields | Loại bỏ UI legacy/provider-only fields |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/ValidationIssue.java` | Safe validation diagnostic record | Không giữ rejected config values |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodec.java` | Jackson JSON/record conversion | Infrastructure-only Jackson dependency |
| `Thêm` | `packages/contracts/http/workflow/definition.schema.json` | JSON Schema draft/config contract | Graph/credential/depth/size validation ở Java |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/definition/DefinitionValidatorTest.java` | Catalog/draft/publish/graph/security/limit tests | 31 test cases |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodecTest.java` | JSON codec/schema/immutability/limits | 4 test cases |
| `Thêm` | `docs/work_logs/T/2026-09-21-workflow-service-task-2.md` | Work log theo template | No plan/ledger edits |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-2-report.md` | Coordinator report | Ignored local artifact, no commit |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| TDD RED | Focused Maven selector trước khi có Task 2 production types | Test compile thất bại với 12 missing-symbol errors | Sau khi sửa test syntax/generic assertions; đúng trạng thái trước implementation |
| Focused Task 2 | `-Dtest=DefinitionValidatorTest,DefinitionJsonCodecTest test` | PASS; 35 tests, 0 failures/errors/skips | 31 validator + 4 codec/schema tests |
| Full Workflow module | Maven module `test`, UTC timezone, compiler warnings/deprecations enabled | PASS; 62 tests, 0 failures/errors/skips | Bao gồm ArchUnit, SecurityConfig, persistence và actual PostgreSQL JSONB round trip |
| PostgreSQL JSONB | `WorkflowJsonbRoundTripTest` trong full suite | PASS; 1 test, PostgreSQL 18.6 Testcontainers, V1 migration applied | Database test dùng container; không thêm migration |
| Docker | Testcontainers probe qua Maven suite | Docker Desktop 29.8.0, local Npipe socket, kết nối thành công | RabbitMQ/PostgreSQL là test fixtures; không khởi chạy compose application stack |
| Static/diff | `git diff --check` và PowerShell trailing whitespace scan cho các file mới | PASS | Lặp lại sau work log/report |

Focused lệnh PowerShell đã chạy (Maven cache junction đã được xác minh):

```powershell
$junction = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repo = 'C:\Users\nhoan\.m2\repository'
$junctionTarget = (Get-Item -LiteralPath $junction).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junction
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
Set-Location 'T:\Weav\services\workflow-service'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repo" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' '-Dtest=DefinitionValidatorTest,DefinitionJsonCodecTest' '-DfailIfNoTests=false' test
```

Final full suite command:

```powershell
$junction = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repo = 'C:\Users\nhoan\.m2\repository'
$junctionTarget = (Get-Item -LiteralPath $junction).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junction
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
Set-Location 'T:\Weav\services\workflow-service'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repo" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' test
```

##### Điều chưa được kiểm tra

- Không chạy JSON Schema compliance engine riêng; test đọc schema bằng Jackson, so catalog type/field parity và các giới hạn chính. Không thêm dependency schema-validator.
- Không chạy route/service end-to-end; endpoint, persistence wiring và Task 5 rejected-draft proof vẫn chưa được implement.
- Không chạy GitNexus `detect_changes` vì không commit; trước commit cần chạy theo `AGENTS.md`.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus chưa bao phủ symbol backend mới | Index 3 commits behind; impacts trả `UNKNOWN`; trùng tên `WorkflowDefinition` resolve web TS interface HIGH | Source `rg` xác nhận khác file/layer; không đổi UI; ghi caveat, không reindex loop | Coordinator đánh giá; refresh index khi công cụ ổn định |
| Trung bình | Mapping grammar/static upstream reference chưa validate | Task 3 owns parser và validation | Không tạo parser thứ hai; giữ rõ trong code/worklog/schema comment | Task 3 cập nhật validator |
| Thấp | Schedule publish chưa thể được xác thực bởi no-arg validator | Spring cron/timezone adapter thuộc Task 16 | No-arg publish fail closed bằng `SCHEDULE_VALIDATION_UNAVAILABLE` | Task 16 wiring |
| Thấp | Mockito dynamic-agent JVM warning trong full suite | Existing security tests dùng inline Mockito trên Java 25 | Test pass; không chỉnh POM/dependencies trong Task 2 | Theo dõi nếu JDK tương lai cấm dynamic attach |

##### Lỗi có thể tái lập

```text
Initial valid test-only RED: test compilation failed on 12 missing Task 2 production symbols.
Final focused: 35 tests passed. Final full Workflow module: 62 tests passed.
```

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator review Task 2 diff/schema/test and decide whether to accept progression.
2. Task 3 can add mapping parser/static upstream validation to `DefinitionValidator` without reimplementing Task 2 shape/security rules.
3. Task 16 can supply `ScheduleValidation` adapter; no-arg validator intentionally stays fail-closed.

##### Cần quyết định / quyền truy cập từ người khác

- Không có quyền truy cập còn thiếu. Mapping validation behavior is explicitly Task 3; schedule cron/timezone validation implementation is Task 16.

##### Hướng dẫn cho AI agent tiếp theo

- Đọc file log này, authoritative spec, Task 2/3 clarification và `git status` trước khi sửa.
- Không thay Task 1 changes hoặc các plan/spec/planning/CLI logs có trước Task 2.
- Không sửa parser/credential rules trước impact và source review; giữ diagnostics sanitized.
- Không commit/push cho tới khi coordinator review/ủy quyền.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`
- `docs/work_logs/T/2026-09-21-workflow-service-planning.md`
- `docs/work_logs/log_template.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-2-report.md`
- GitNexus findings: `DefinitionValidator` and `DefinitionJsonCodec` target not found/UNKNOWN; `WorkflowDefinition` name resolves to the unrelated web interface, HIGH; index three commits stale.

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 12:15 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit: Task 1 + Task 2, cùng các pre-existing untracked planning/spec/CLI files |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker |
| Cần đọc trước khi tiếp tục | Mục 10 (GitNexus/mapping/schedule caveats), Task 2 report, current plan Task 3 |
---

### Source record: 2026-09-21-workflow-service-task-3.md


#### Bổ sung sau coordinator review

- Coordinator phát hiện `{{ nodes.a.output. }}` bị chấp nhận như tham chiếu tới toàn bộ output vì parser nhầm dấu chấm cuối thành path rỗng. Đã thêm regression cho ID đơn và ID dotted ở cả `references(value)`, `references(value, knownIds)` và `resolve`; parser nay từ chối empty trailing segment nhưng vẫn chấp nhận `{{ nodes.a.output }}`.
- GitNexus impact cho `nodeReferenceAt`/`MappingResolverTest` trả `UNKNOWN` hoặc target-not-found do index stale; source search xác nhận production caller ở `DefinitionValidator` gọi `references(value, nodeIds)` và tests gọi parser/resolver. Không thu hẹp quy tắc ID dotted.
- TDD RED: `MappingResolverTest` chạy 17 tests và đúng 1 failure vì `references()` không ném `MappingException` cho trailing dot. Sau sửa, cùng selector PASS 17/17.
- Sau khi thêm Task 9 domain/tests, focused selector chung PASS 102/102; full Workflow suite PASS 132/132, gồm Testcontainers PostgreSQL/RabbitMQ. Maven slot đã trả cho security worker; Task 5 và coordinator acceptance vẫn pending.
- Follow-up `git diff --check` exit 0; PowerShell trailing-whitespace scan trên mapping/execution source, tests, logs và reports cũng PASS. Git chỉ in line-ending notices cho application.properties thuộc security lane.
- Log được lưu theo yêu cầu của user tại `docs/work_logs/K/`; mục file cũ dưới `T/` bên dưới đã được sửa.

#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker — graph/mapping lane |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | Task 3 implementation và kiểm tra hoàn tất; chưa commit; chờ coordinator review |
| Phạm vi session | Rà Task 2, hoàn thiện safe mapping và publish-time static upstream validation |
| Liên kết liên quan | `docs/superpowers/specs/workflow-service-spec.md`, Task 2/3 trong plan V1 |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Rà lại Task 2 theo spec và tìm hai lỗi cụ thể: mapping ở các field có kiểu/enumeration bị kiểm tra như literal trước khi resolve; JSON Schema cho ID chấp nhận chuỗi chỉ có whitespace trong khi Java từ chối.
- Thêm `MappingContext`, `MappingResolver`, `MappingException` với snapshot JSON sâu, giữ explicit `null`, bảo toàn kiểu cho expression nguyên chuỗi, chỉ nội suy scalar và không đưa expression/input vào diagnostics.
- Thêm grammar publish-only, static node-reference ancestry qua graph, phân giải ID có dấu chấm bằng node IDs đã biết và lỗi khi có nhiều parse hợp lệ. Runtime resolver chỉ dùng output map do engine cấp; nó không tự suy diễn ancestry/active path.
- Thêm regression về mapping, đồ thị, ID/schema parity và các giới hạn đúng tại/qua ngưỡng.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Build / compile | `PASS` | Full Workflow Maven test lifecycle compile thành công |
| Unit / integration test | `PASS` | Focused 88/88; full module 118/118; 0 failure/error/skip |
| Migration / database | `PASS` trong test | Không đổi migration; Testcontainers/PostgreSQL 18.6 round-trip vẫn pass |
| Health check | Chưa kiểm tra | Không chạy service stack |
| Review thay đổi | Đã kiểm tra | `git diff --check` sau khi hoàn tất tài liệu |
| Commit / PR | Chưa tạo | Giữ thay đổi chưa stage để coordinator review |

#### 3. Mục tiêu và phạm vi

##### Trong phạm vi

- Review/fix Task 2 `DefinitionValidator` và JSON Schema trong các path graph lane sở hữu.
- Implement mapping context/resolver/error, nested resolution, parser grammar và publish-time static upstream validation.
- Regression tests, báo cáo Task 3 và work log riêng.

##### Ngoài phạm vi

- Task 4 authentication/Workspace client thuộc security worker; không sửa file của lane đó.
- Runtime engine, typed-config validation sau mapping, persistence/API/UI, Task 5 trở đi, plan/progress ledger.
- Stage, commit, push, merge hoặc chạy external agent CLI.

##### Tiêu chí hoàn thành

- [x] Draft giữ được mapping chưa hoàn chỉnh; publish kiểm tra grammar và graph ancestry.
- [x] Resolver phân biệt missing với explicit null, giữ nguyên kiểu expression nguyên chuỗi, xử lý map/list lồng nhau và không sửa input.
- [x] Mapping error ổn định `MAPPING_ERROR`, không retry, không echo biểu thức, có node/field khi caller cung cấp destination.
- [x] Regression tại/qua các giới hạn definition/codec và test mapping/graph chạy xanh.
- [x] Work log/report cập nhật; Maven slot trả lại security worker.

#### 4. Bối cảnh và giả định

- **Nguồn sự thật:** Spec phần Data mapping; plan Task 2/3 và clarification trong `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md`.
- **Graph semantics:** Static validator kiểm tra node tham chiếu là strict upstream ancestor qua các edge đã biết. Runtime engine về sau chỉ truyền outputs từ successful nodes trên active path; resolver không thể tự xác minh điều này.
- **Dotted IDs:** Không giới hạn thêm cú pháp node ID. Parser so khớp `nodes.<id>.output` với ID trong definition/runtime context; nhiều match hợp lệ là ambiguous và bị từ chối. Overload `references(value)` không có graph dùng marker `.output` đầu tiên; validator phải dùng overload có node IDs.
- **Mapping completeness:** Draft cho phép mapping thiếu/chưa hoàn thiện. Parser và static reference checks chỉ chạy tại publish.
- **Resolved types:** Mapping values cho typed/enum fields được grammar-validate khi publish; kiểm tra giá trị cụ thể sau resolve thuộc runtime Task 11. `connectionId` tiếp tục là UUID literal.

#### 5. Nhật ký theo session / thời gian

| Mốc | Việc đã làm | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Đầu session | Đọc AGENTS, spec, plan, progress, Task 2 report, work log template, status; kiểm tra Task 2 source/schema/tests | Giữ nguyên thay đổi có trước; ghi nhận GitNexus stale 3 commits và `UNKNOWN` cho symbols chưa index | Xong |
| Trước sửa | GitNexus upstream impact theo yêu cầu trước khi sửa symbol | `DefinitionValidator` chưa có trong index (`UNKNOWN`); `WorkflowDefinition` bị resolve nhầm sang TS UI symbol (`HIGH`, 32 callers). Search source xác nhận file Java là domain mới; không sửa UI | Xong |
| Trước implementation | Viết Task 3 tests trước production và chạy focused suite | RED test-compile vì thiếu `MappingResolver`, đúng trạng thái trước implementation | Xong |
| Implementation | Thêm resolver/context/error và nối validator với publish-time refs | Tests cover type/null/nesting/syntax/unavailable output/dotted IDs/ancestor path | Xong |
| Review Task 2 | Thêm tests/fix mapping typed fields và whitespace-only IDs | `maxLength`, HTTP method, headers có mapping được defer tới resolve; ID pattern schema đồng bộ với Java blank check | Xong |
| Verification | Focused suite với Task 4 source đã sẵn sàng | 88 tests, 0 failure/error/skip | Xong |
| Verification | Full Workflow module suite với UTC và Testcontainers | 118 tests, 0 failure/error/skip; BUILD SUCCESS; PostgreSQL 18.6 | Xong |
| Handoff | Trả Maven slot security worker, cập nhật báo cáo/log | Worker xác nhận sẽ chờ post-test edits; không còn source/test edits từ graph lane | Xong |

##### Diễn giải quan trọng

- Task 2 source review thấy draft/publish separation, graph checks, JSON/depth/count bounds, credential-field/header screening, URL userinfo screening và null-preserving snapshots phù hợp hướng plan. Hai issue cụ thể đã sửa được ghi ở mục 6.
- Lần Maven sớm trước production mapping cho feature RED đúng dự kiến. Sau đó Task 4 test sources ban đầu chưa compile vì production types của worker kia đang được thêm; không sửa file Task 4. Khi security worker báo compile-ready, focused selector và full module suite đều chạy thành công.
- Schema được parse bằng PowerShell `ConvertFrom-Json`; pattern `\S` được kiểm tra thủ công cho chuỗi rỗng/whitespace-only và ID hợp lệ. Không có JSON Schema compliance engine riêng trong dependency hiện tại.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả / theo dõi |
| --- | --- | --- | --- |
| Freeze context/input bằng `JsonValues` và giữ null | Context là JSON snapshot; nested `null` phải khác missing | Mutable source maps hoặc quy null thành rỗng | Resolver không sửa input; giá trị lồng nhau trả về bất biến |
| Dùng graph IDs / available output keys để tách node ID dotted | IDs hiện không bị giới hạn ký tự ngoài blank check; parser cần biết boundary `output` | Cấm dấu chấm trong IDs | Không tạo API restriction; ambiguous graph parse trả MAPPING_ERROR |
| Không xác định runtime ancestry trong resolver | Runtime caller sẽ đưa đúng successful active-path outputs; resolver chỉ xử lý map được cấp | Resolver tự đọc toàn graph/branch | Engine chịu trách nhiệm cung cấp context đúng; absent output luôn lỗi |
| Defer field type/enum checks cho mapped values | Plan yêu cầu grammar publish và kiểm tra kiểu sau khi resolve | Từ chối mapping trên method/maxLength/header-object | Typed runtime revalidation thuộc Task 11; connectionId vẫn literal UUID |
| Schema IDs dùng `pattern: \\S` | `minLength: 1` cho phép ID toàn whitespace trong khi Java `isBlank()` từ chối | Restrict toàn bộ ký tự/cú pháp ID | Chỉ đồng bộ nonblank; giữ nguyên các ID hợp lệ hiện có |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `MappingContext` deep-freeze trigger input, outputs và variables; giữ explicit JSON null.
- `MappingResolver` xử lý recursive map/list, `trigger.input`, `nodes.<nodeId>.output`, `variables`, dot property paths; expression nguyên chuỗi giữ nguyên JSON type; embedded expression chỉ scalar/null text. Brackets, calls, operators, malformed delimiters, missing properties, traversal qua non-object, unavailable output và ambiguous node candidates trả non-retryable `MAPPING_ERROR`.
- `MappingException` cung cấp code ổn định, `retryable=false`, destination node/field khi `resolve(..., destinationNodeId, destinationField)` được gọi; không đưa expression vào message.
- `DefinitionValidator` chỉ parse mapping khi publish và dùng transitive edge closure để yêu cầu node reference là upstream ancestor. Draft chưa hoàn chỉnh vẫn editable.
- Mapped string values qua shape/enum checks ban đầu; connectionId không được map. Literal fields tiếp tục được kiểm tra sớm. Runtime sau resolve cần validate typed config theo plan.
- JSON Schema từ chối whitespace-only node ID, edge ID/source/target; không áp thêm format hạn chế khác cho ID.

##### 7.2. Dữ liệu, schema và migration

- Không thay đổi database schema hay migration.
- Schema JSON draft/config được cập nhật duy nhất cho tính nhất quán nonblank identifier.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm dependency hoặc đổi cấu hình.
- Maven dùng cache junction đã xác minh và UTC timezone; Testcontainers Docker được sử dụng bởi test hiện có.

##### 7.4. API, bảo mật và quan sát hệ thống

- Không thêm route.
- Diagnostics không echo mapping text, credential values hoặc output data.
- Resolver chỉ nhận outputs do caller cung cấp; “successful active-path only” là contract tương lai của engine, chưa được chứng minh bởi implementation engine trong session này.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingContext.java` | Immutable runtime mapping values | Giữ nested null |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingException.java` | Safe stable mapping error | Caller thêm destination context |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingResolver.java` | Parser, recursive resolver, reference collection | Không tự tính ancestry |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java` | Publish mapping/ancestor checks; defer typed mapping values | Task 2 file mới/untracked trước lane này |
| `Sửa` | `packages/contracts/http/workflow/definition.schema.json` | Nonblank identifier pattern | Giữ ID rules rộng |
| `Thêm/Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/domain/mapping/MappingResolverTest.java` | Mapping grammar/type/null/nesting/error/graph refs | Không thực thi code người dùng |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/domain/definition/DefinitionValidatorTest.java` | Mapping publish/draft, ancestry, dotted IDs, field deferral, count/byte/depth boundaries | Credential and graph tests retained |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodecTest.java` | Schema/Java ID parity, exact codec byte limit | Không có compliance engine dependency |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-3-report.md` | Coordinator handoff report | Local scratch artifact |
| `Thêm` | `docs/work_logs/K/2026-09-21-workflow-service-task-3.md` | Session work log | Không sửa plan/ledger |

#### 9. Kiểm tra và bằng chứng

Maven commands chạy trong `services/workflow-service` sau khi xác minh junction trỏ `C:\Users\nhoan\.m2`:

```powershell
$junctionPath = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repoPath = 'C:\Users\nhoan\.m2\repository'
$junctionTarget = (Get-Item -LiteralPath $junctionPath).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junctionPath
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repoPath" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' '-Dtest=MappingResolverTest,DefinitionValidatorTest,DefinitionJsonCodecTest,WorkspaceClientTest,WorkflowSecurityTest' '-DfailIfNoTests=false' test
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repoPath" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' test
```

| Hạng mục | Kết quả | Phạm vi / giới hạn |
| --- | --- | --- |
| RED | test compile thất bại do thiếu `MappingResolver` trước implementation | Feature RED dự kiến |
| Focused | PASS, 88 tests, 0 failure/error/skip | Mapping/definition/codec và Task 4 Workspace/security regressions |
| Full Workflow | PASS, 118 tests, 0 failure/error/skip | Bao gồm architecture, existing Task 1 tests, Task 4, PostgreSQL JSONB/Testcontainers |
| Byte/depth/count | PASS | Definition exact 1 MiB và over; codec exact 1 MiB và over; depth max/over; nodes/edges max/over |
| Schema syntax | PASS | PowerShell `ConvertFrom-Json`; không chạy full JSON Schema validator |
| Static/diff | PASS | `git diff --check` sau khi viết docs |

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Dấu hiệu | Xử lý / việc tiếp theo |
| --- | --- | --- | --- |
| Trung bình | GitNexus index stale và symbols backend mới chưa indexed | `DefinitionValidator` impact trả `UNKNOWN`; `WorkflowDefinition` đụng tên với UI TS symbol và báo HIGH | Source search xác nhận file/layer backend mới; không sửa UI; trước commit coordinator cần xem lại impact/change detection |
| Thấp | Chưa có runtime engine/type check sau resolve | Lane này chỉ thêm context/resolver/static validation | Task 11 phải validate resolved config; engine phải cấp outputs của successful active path |
| Thấp | JSON Schema chưa được validate bằng standalone schema engine | POM không có compliance dependency; test so field/catalog/bounds và pattern | Có thể thêm schema-validator khi contract tooling được phê duyệt; không block Java tests |
| Thấp | Mockito dynamic-agent warning trong suite | Runtime warning từ test framework trên JDK 25 | Tests pass; không thay đổi build configuration |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator review hai Task 2 findings, Task 3 code và combined Task 4 diff.
2. Task 11 cần gọi `MappingResolver.resolve` với node/field và chỉ successful active-path outputs, sau đó revalidate typed config.
3. Chạy GitNexus `detect_changes` theo AGENTS trước commit; chưa stage/commit/push.

##### Cần quyết định / quyền truy cập từ người khác

- Không có blocker cần user input. Coordinator acceptance cho Task 2/3 vẫn pending.

##### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, spec, plan/progress và `git status` trước khi tiếp tục.
- Chỉ sửa graph lane paths nếu đang sửa Task 3; security lane có ownership riêng và Maven runs cần được serialize.
- Giữ các mapping/ancestry decisions ở mục 4/6 trừ khi coordinator chỉ đạo khác.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`, section 6.
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Tasks 2–3 và clarified interfaces.
- `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md`, mapping decisions and ownership.
- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-2-report.md`.

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 17:08 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; có Task 1/2 và security-worker files cùng branch |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker — graph/mapping lane |
| Cần đọc trước khi tiếp tục | Mục 4/6/11 và `task-3-report.md` |
---

### Source record: 2026-09-21-workflow-service-task-4.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex Task 4 worker |
| Người nhận bàn giao | Coordinator `/root` |
| Trạng thái Task 4 | Hoàn thành implementation và kiểm tra; coordinator review pending |
| Phạm vi | JWT/security boundary, Workspace client/authorization ports, correlation ID và error handling |
| Commit/PR | Chưa tạo |

#### 2. Kết quả

- Workflow xác thực access JWT theo claim contract của Identity; public routes không còn dùng HTTP Basic hoặc miễn xác thực `/auth/**`.
- Internal connection-usage route yêu cầu `X-Internal-Service-Key` riêng; key không thay thế JWT cho public routes. Webhook exemption chỉ áp dụng đúng `POST /webhooks/*` để Task 17 xác thực secret.
- Workspace access/connection operations dùng đúng contract hiện có, giới hạn timeout, kiểm tra response IDs và credential shape, không cache quyền/credential, và trả lỗi đã khử dữ liệu nhạy cảm.
- Correlation ID được chuẩn hóa hoặc sinh UUID, truyền xuống Workspace và trả lại cùng structured error response.

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Focused security/client/error tests | PASS | 38 tests, 0 failures/errors/skips |
| Toàn bộ Workflow module | PASS | 118 tests, 0 failures/errors/skips; PostgreSQL Testcontainers round-trip pass |
| Diff/trailing whitespace | PASS | `git diff --check`; PowerShell scan không tìm thấy trailing whitespace trong file Task 4 |
| Runtime với Workspace service đang chạy | Chưa chạy | Workspace client được kiểm tra bằng HTTP contract stub; không khởi động toàn bộ Compose stack |
| Commit/PR | Chưa tạo | Đang chờ coordinator review; không stage/commit/push |

#### 3. Phạm vi và tiêu chí

##### Trong phạm vi

- Sửa `SecurityConfig`, `JwtProperties`, `GlobalExceptionHandler`, `application.properties` và test config.
- Thêm Workspace access/connection ports, authorization service, HTTP client/configuration, closeable resolved credential holder, internal-key filter và correlation filter.
- Thêm/update security, client và exception-handler regressions; cập nhật work log và Task 4 report.

##### Ngoài phạm vi

- Không sửa Compose, `.env.example`, Task 1–3 domain/mapping/schema, kế hoạch/ledger hoặc API của Workspace/Identity.
- Không triển khai webhook secret verification (Task 17), public authoring routes hoặc connection usage controller.
- Không staging, commit hay push.

##### Tiêu chí hoàn thành

- [x] JWT actor lấy từ token đã verify, với Identity issuer/audience/claims contract và không tin actor do client gửi.
- [x] Internal key và public bearer JWT được tách biệt theo route/method chính xác.
- [x] Workspace quyền/capabilities là authoritative; kiểm tra workspace/user IDs; failure/timeout/malformed response fail closed.
- [x] Credential holder không serializable, `toString` được redaction, đóng holder sẽ bỏ references; không hứa zeroize Java `String`.
- [x] Error/log/correlation không làm lộ token, key, body hoặc response gốc.
- [x] Focused tests, module suite, diff check và tài liệu bàn giao hoàn tất.

#### 4. Bối cảnh và quyết định

- Nguồn contract là Workflow spec/plan, Workspace usage API và Workspace source, cùng Identity JWT issuer/validator conventions. Không tạo role-to-capability policy cục bộ: `WorkspaceAuthorization` kiểm tra đúng capability được truyền vào.
- JWT chỉ cấu hình access secret/issuer/audience/clock skew. Decoder chấp nhận HS256, yêu cầu Identity access-token claims và từ chối refresh tokens, malformed UUIDs, sai signature hoặc token hết hạn.
- Internal-key filter chỉ bảo vệ `GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage`. Thiếu key cấu hình hoặc key sai đều từ chối; một key hợp lệ không cấp quyền vào route public.
- Correlation ID chấp nhận tối đa 128 ký tự theo `[A-Za-z0-9._:-]`; giá trị sai/mất được thay bằng UUID và MDC luôn được dọn sau request.
- Workspace client giữ exact Workspace paths/payloads; resolve không có request body và yêu cầu `Cache-Control: no-store`. Redirect bị cấm; connect/read timeouts được giới hạn tối đa 60 giây; JSON được parse strict. Quyền sai/không tìm thấy được map sang lỗi generic; transport/malformed responses fail closed thành dependency-unavailable, không giữ downstream cause.
- Secret/config được đọc qua environment placeholders; không ghi giá trị secret vào log/tài liệu. Không sửa `.env.example` hoặc Compose ngoài phạm vi.

#### 5. Thay đổi đã thực hiện

##### Code và hành vi

- `SecurityConfig` thiết lập stateless JWT resource server, structured 401/403, tắt Basic, giữ public health probes, internal-key boundary và exact webhook method/path exemption.
- `WorkspaceAccessPort`/`WorkspaceConnectionPort` xác định các application boundary; `WorkspaceAuthorization` kiểm tra capability từ Workspace và khớp workspace/user IDs.
- `WorkspaceClient` gọi bốn Workspace operations có trong contract: đọc access, authorize attachment, resolve connection và report authentication rejection. Request mang service key và correlation ID nếu hợp lệ; response kiểm tra status, shape, ID, cache policy và các trường credential.
- `ResolvedConnection` là holder không phải record/không serializable, redacted `toString`, closeable và không giữ references sau khi đóng. Không cache access hoặc credentials.
- `GlobalExceptionHandler` thêm lỗi Workspace dependency 503, giữ nguyên `ApiErrorResponse`, trả `X-Correlation-ID` trên structured errors, và chỉ log event/request ID/error type thay vì stack trace, URI hay downstream response.
- `application.properties` khai báo JWT, inbound key, Workspace URL/timeouts và outbound key qua placeholders. Test properties dùng giá trị tổng hợp.

##### Cấu hình và tích hợp theo dõi

- Giá trị dự kiến: `JWT_ACCESS_SECRET`, `WORKFLOW_INTERNAL_SERVICE_KEY`, `WORKSPACE_SERVICE_URL`, `WEAV_INTERNAL_SERVICE_KEY`; secret chỉ cần được cung cấp ở runtime.
- Compose chưa truyền đủ Workspace URL và hai service-key variables vào container Workflow. Với cấu hình thiếu, outbound/internal authorization fail closed; Task 21 cần nối environment/config hiện có trước khi bật cross-service path trong Compose. Không sửa Compose trong lane này.
- Webhook path hiện chỉ bypass JWT tại boundary theo Task 4; xác thực webhook secret vẫn là Task 17.

#### 6. Danh sách file Task 4

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/JwtProperties.java` | Access-only JWT configuration |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/SecurityConfig.java` | JWT resource server và route/filter boundary |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/InternalServiceKeyFilter.java` | Exact internal route key validation |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/CorrelationIdFilter.java` | Safe request correlation ID lifecycle |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/GlobalExceptionHandler.java` | Structured safe error responses và Workspace 503 mapping |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkspaceAccessPort.java` | Authoritative access DTO/port |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkspaceConnectionPort.java` | Connection authorization/resolution port |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ResolvedConnection.java` | Closeable redacted credential holder |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkspaceDependencyUnavailableException.java` | Sanitized upstream dependency failure |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkspaceAuthorization.java` | Capability and response-ID checks |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java` | Contract-aligned HTTP adapter |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClientProperties.java` | Base URL, bounded timeouts, redacted key config |
| Sửa | `services/workflow-service/src/main/resources/application.properties` | Runtime property placeholders/defaults |
| Thêm/sửa | `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowSecurityTest.java` | JWT, internal-key, actor, capability and correlation regressions |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/workspace/WorkspaceClientTest.java` | Contract, malformed/timeout, ID and credential handling |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/SecurityConfigTest.java` | `/auth/**` no longer treated as public; Basic rejected |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/web/GlobalExceptionHandlerTest.java` | Correlated/sanitized structured error regressions |
| Sửa | `services/workflow-service/src/test/resources/application.properties` | Synthetic test-only security/client configuration |

#### 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| TDD RED | Test compile trước khi Task 4 production symbols có mặt | Test compile dừng vì các Workspace client/security symbols chưa được định nghĩa | Lỗi compile mong đợi; không phải production failure |
| Focused Task 4 | `-Dtest=WorkflowSecurityTest,WorkspaceClientTest,SecurityConfigTest,GlobalExceptionHandlerTest test` | PASS: 38 tests; 0 failures/errors/skips | Client dùng local HTTP contract stub, chưa chạy Workspace thật |
| Full Workflow module | `mvnw.cmd ... test` | PASS: 118 tests; 0 failures/errors/skips | Gồm ArchUnit, persistence và Docker-backed PostgreSQL JSONB round-trip |
| Containers | Testcontainers trong full suite | Docker Desktop 29.8.0; PostgreSQL 18.6 fixture khởi chạy thành công | Không khởi chạy application Compose stack |
| Static/diff | `git diff --check` và PowerShell trailing-whitespace scan trên file Task 4 | PASS | Graph worker thay đổi file thuộc Tasks 2–3 độc lập trên cùng checkout |

Các lệnh Maven được chạy trong `services/workflow-service` với Maven-home junction đã xác minh trỏ tới `C:\Users\nhoan\.m2`, `-Dmaven.repo.local=C:\Users\nhoan\.m2\repository`, và `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` để Testcontainers dùng timezone ổn định. Focused command:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=WorkflowSecurityTest,WorkspaceClientTest,SecurityConfigTest,GlobalExceptionHandlerTest' test
```

Full-suite command:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' test
```

Full suite emitted existing Mockito inline/dynamic-agent warnings under JDK 25; compilation had no source warnings. No standalone live-service/Compose test was run.

#### 8. GitNexus, risks and blockers

- GitNexus index was stale. `SecurityConfig`/`JwtProperties` impact returned `UNKNOWN`; targeted source search and inspection were used to corroborate affected references. `UNKNOWN` remains unresolved graph coverage, not an all-clear.
- `GlobalExceptionHandler.respond` reported HIGH risk with 9 direct callers and 3 indexed flows. The change preserves the standard error envelope/status and has dedicated regression tests; coordinator review remains important.
- Cross-service deployment wiring for the three environment values above remains outside Task 4 (Task 21). Workspace routes have a local HTTP contract test, but no live Workspace service integration test was run.
- No blocker remained for code completion. `git diff --check` was run, but GitNexus `detect_changes` was not run because no commit is being created; it remains required before a future commit.

#### 9. Trạng thái bàn giao

1. Coordinator review Task 4 diff and combine with Tasks 1–3 after their independent review.
2. Ensure Task 21 wires Workspace service URL and internal keys into runtime configuration without exposing secret values.
3. Keep webhook verification owned by Task 17; current exact POST exemption does not mean webhook auth is implemented.
4. Before any commit, review the complete shared worktree and run GitNexus change detection per `AGENTS.md`.

Không stage, commit hoặc push. Shared worktree also contains Task 1–3 files owned by other workers; this report covers Task 4 only.

#### 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 16:21 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit ở Tasks 1–4 và planning artifacts |
| Người cập nhật log | Codex Task 4 worker |
| Cần đọc tiếp | Spec, Workflow plan Task 5+; Task 4 report; Compose config wiring tracked for Task 21 |
---

### Source record: 2026-09-21-workflow-service-m1-review.md


#### 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-21 (follow-up 2026-09-22) / Asia/Saigon |
| Repository / branch | `T:\Weav` / `feature/workflow-service` |
| Baseline | `c836de2` per coordinator plan |
| Owner / recipient | Fresh M1 review worker / root coordinator |
| Status | Scoped fixes verified; current dispositions await root triage |
| Scope | Initial read-only review of Workflow Tasks 1–7 and Task 9; bounded follow-up fixes in Section 7 |

#### 2. Result

The initial 2026-09-21 review recorded three findings: the HEAD key-gate gap, the matrix-parameter body-limit claim, and provider-secret-shaped values accepted in editor state. Section 7 records the two scoped fixes and the matrix claim's later withdrawal after full-chain reproduction. Current dispositions are in `.superpowers/sdd/2026-09-21-workflow-service-v1/m1-review-fresh/REPORT.md`. The cross-service attach/delete race remains an unverified integration concern because Workspace documents the check/commit window as advisory.

#### 3. Review scope and decisions

- Used the Workflow V1 specification, implementation plan, progress record, Tasks 6–7 reports, and current service contracts.
- Applied the user decisions: all stored immutable versions count even for soft-deleted workflows; only deleted drafts are excluded; unknown scoped usage pairs return `200 false` without a Workspace lookup.
- Did not flag behavior explicitly deferred to Tasks 8–21. Did not touch `docs/work_logs/T` or any Task 8-owned source files.
- GitNexus `Weav` index was three commits behind and produced stale/unrelated results for the requested flows; source inspection corroborated the review. Index was not refreshed.

#### 4. Initial evidence and verification (2026-09-21)

| Check | Result | Limit |
| --- | --- | --- |
| GitNexus query/context | Stale/unrelated; source corroboration used | Index remains behind HEAD |
| Spring HEAD/path probes | Confirmed GET matcher rejects HEAD while MVC `@GetMapping` accepts it; matrix paths match route patterns | Framework-path probe, no live service |
| Embedded Tomcat URI/path probe | `requestURI` retains matrix suffix; `servletPath` strips it | Isolated container probe |
| Workflow test suite | Coordinator reported 184/184 pass | Not run by this reviewer; Task 8 owned Maven slot |
| Workspace contract fixtures | Coordinator reported 20/20 pass | No live Compose/API run |
| DB/migration/runtime | Not run | Review-only assignment |

#### 5. Initial findings and handoff (historical; see Section 7 for current disposition)

The initial review's exact paths/lines, triggers, impact, evidence, and recommendations are in the report. Its current dispositions are recorded in Section 7: two findings are fixed in the working tree and the matrix-path claim is withdrawn as confirmed. Root owns final severity triage and acceptance. Do not treat this report as M1 acceptance; the attach/delete race needs a product-level concurrency decision only if strict serialization is required.

#### 6. Files and repository state

| Path | Change |
| --- | --- |
| `.superpowers/sdd/2026-09-21-workflow-service-v1/m1-review-fresh/` | Added review report and isolated probe source/output artifacts |
| `docs/work_logs/K/2026-09-21-workflow-service-m1-review.md` | Added this review handoff log |

At the initial review, no product source, migration, configuration, or repository tests were edited. Only isolated probe sources/classes, the report, and this handoff log were added. No commits or staged changes were created.

#### 7. Follow-up — 2026-09-22

##### Result and disposition

Root accepted two findings for a bounded regression/fix round. The internal usage route now explicitly denies HEAD before permitting its GET contract. Draft save now applies the existing recursive, normalized credential-key scanner to frozen `editorState` before repository lookup or persistence. Secret values remain absent from validation issues and HTTP responses.

The matrix-parameter body-limit claim is withdrawn as a confirmed finding. The production embedded HTTP test, using a valid bearer on the canonical route first, observed the semicolon-suffixed oversized draft request rejected with 401 at `/error`, and the persisted draft remained unchanged. This proves current-chain rejection for the tested request, without identifying which upstream component rejected it. No firewall/body-limit configuration was changed.

##### Changed files owned by this follow-up

| Path | Change |
| --- | --- |
| `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/SecurityConfig.java` | Deny HEAD on the internal usage route before the GET permit matcher. |
| `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowDraftService.java` | Reject credential-shaped editor-state keys before persistence. |
| `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java` | Reuse the recursive normalized credential scanner for editor state. |
| `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowDraftHttpTest.java` | Add nested mixed-case editor-state secret regression; retain valid UI-state round-trip coverage. |
| `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowInternalUsageEmbeddedHttpTest.java` | Add full-chain HEAD/key/quota test and matrix-path non-mutation test. |
| `.superpowers/sdd/2026-09-21-workflow-service-v1/m1-review-fresh/REPORT.md` | Record confirmed fixes and corrected matrix-path disposition. |
| `docs/work_logs/K/2026-09-21-workflow-service-m1-review.md` | Record this follow-up. |

##### Verification and limits

The pre-fix regressions reproduced HEAD returning 200 and editor state accepting the secret marker. Post-fix, the focused test invocation passed **4/4** with zero failures/errors/skips; main and test compilation covered 119 and 39 source files. Testcontainers started PostgreSQL and RabbitMQ and the HTTP test used the production Spring Security chain with embedded Tomcat. The exact command is recorded in the review report. The run required elevated execution because direct access to the local Maven cache had previously failed with `AccessDeniedException`.

`git diff --check` passed after the code and documentation edits; Git emitted only pre-existing line-ending warnings for the two `application.properties` files. Root reported the earlier full Workflow suite at 184/184 and Workspace contract fixtures at 20/20, but those full suites were not rerun after the scoped fixes. No live Compose/API run was performed. GitNexus remained three commits behind HEAD with stale or `UNKNOWN` path results; manual source inspection corroborated the changes. Execution/outbox/Task10 source and tests, migrations, `application.properties`, the root plan/ledger, and `docs/work_logs/T` were not edited by this follow-up.

Root retains final severity triage and M1 acceptance. No commit or staging was performed.
