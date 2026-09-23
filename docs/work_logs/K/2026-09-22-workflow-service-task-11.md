# Nhật ký Task 11 — Workflow Service runtime

## Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-09-22` |
| Múi giờ | `Asia/Saigon` |
| Repository / nhánh | `T:\Weav` / `feature/workflow-service` |
| Người thực hiện | Worker Task 11 |
| Người nhận bàn giao | `/root`, monitor worker Task 12 |
| Trạng thái | Đang tiếp tục; source handoff chờ serialized monitor verification |
| Phạm vi | Durable concurrent workflow-node execution, attempts/retries, registry and bounded runtime resources |

## Kết quả

- Added the `NodeExecutor` boundary, safe failure/result records, fail-closed registry, built-in `logic.condition` evaluator, attempt invoker, and `RetryWaitPort`.
- Added the fenced `application.port.in.ExecutionRunner` implementation. It initializes and persists graph state, writes RUNNING attempts before provider calls, resolves/revalidates active-path mappings, commits safe terminal output/error, runs READY nodes concurrently within a bound, preserves retry budget, and waits without a database transaction.
- Added bounded executor/timer configuration and scheduled retry waiting. Added aggregate terminal failure transitions for node attempts/nodes.
- Added unit coverage for concurrent admission/attempt persistence, retries, active branch mapping, missing adapters, bounded pools, and timer waiting.
- Fixed Spring wiring discovered during Task 12 context review: `NodeExecutorRegistry` list constructor is explicitly `@Autowired`; runtime clock injections use the qualified `workflowExecutionClock` bean.

## Owned files

- `services/workflow-service/src/main/java/com/weav/workflow/application/node/NodeExecutor.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/node/NodeExecutorRegistry.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/execution/NodeAttemptRunner.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/execution/ExecutionRunner.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/RetryWaitPort.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/execution/BoundedExecutionConfiguration.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/execution/ScheduledRetryWait.java`
- `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/execution/NodeExecution.java`
- `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/execution/NodeExecutionAttempt.java`
- `services/workflow-service/src/test/java/com/weav/workflow/application/execution/ExecutionRunnerTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/execution/ExecutionRuntimeTest.java`

## Decisions and safeguards

- The existing `application.port.in.ExecutionRunner.run(Lease)` boundary is implemented directly; no second runner port or duplicate bean name was introduced.
- Provider calls occur in bounded executor threads outside `ExecutionStateAdapter` transactions. Heartbeats use separate short renewals. A failed fence prevents stale completion commits and stops further admission.
- Retry policy uses three total attempts and persisted eligibility after one and two consumed attempts. The runtime does not invent external adapters or no-op providers; missing registry entries become sanitized `DEPENDENCY_NOT_CONFIGURED` failures.
- Mapping context is derived from active graph edges and successful ancestors for the specific target node. Inactive branch outputs are not exposed.
- GitNexus impact for new/uncommitted runtime symbols was `UNKNOWN`/target-not-found because the repository index predates Tasks 10–11. CLI fallback was blocked by `EPERM realpath`; source search and call-site inspection corroborated the boundary and no HIGH/CRITICAL result was available. Refresh graph metadata before commit review.

## Verification evidence

All Maven commands were run from `services/workflow-service` with UTC timezone, the configured temporary Maven-home junction, explicit local repository, and `-Dmaven.compiler.fork=true` to avoid the Java 25 in-process archive-close issue.

| Check | Result |
| --- | --- |
| Main compile after runtime changes | `BUILD SUCCESS`; Java 25 emitted a known `AccessDeniedException` compiler diagnostic while closing a dependency archive, but forked Maven completed successfully |
| `ExecutionRunnerTest#failsClosedForMissingAdaptersAndStoresOnlySanitizedTerminalErrors` | `1` test passed |
| `ExecutionRunnerTest#exposesOnlySuccessfulActivePathOutputsToMappedNodesAndSkipsInactiveBranches` | `1` test passed |
| `ExecutionRunnerTest#persistsRunningAttemptsBeforeCallingReadyNodesAndRunsThemConcurrently` | `1` test passed |
| Earlier retry test run | Implementation reached completion; assertion expected absolute `base+2` but persisted cumulative delays correctly produced `base+1`, `base+3`. Test expectation was corrected to the required one-second then two-second delays; rerun is delegated to the released monitor slot. |
| `ExecutionRuntimeTest` | Added; not yet run because root requested serialized Maven ownership after the focused run. |
| Existing root combined suite before Task 11 source changes | `214/214` passed; this is not evidence for the post-Task 11 source. |
| `git diff --check` | Not yet run after the final source/test edits; coordinator should run it with the serialized suite. |

## Handoff / next steps

1. No Maven process is owned by this worker after focused session `46181` completed `BUILD SUCCESS` at `2026-09-22 21:35 Asia/Saigon`; the serialized slot is released to the monitor worker.
2. Monitor should rerun `ExecutionRunnerTest,ExecutionRuntimeTest` after the registry/clock wiring fixes, then run its Spring context check. Do not overlap another Maven invocation.
3. Coordinator should run the real PostgreSQL/Rabbit path with deterministic fake executors, restart/lease-loss cases, and the post-Task 11 combined suite. This worker did not claim those checks.
4. No commit, stage, push, plan-ledger, progress-ledger, or Task 12 files were changed.

## Session close

| Trường | Giá trị |
| --- | --- |
| Worktree | Shared dirty worktree; only Task 11 owned files above were edited in this session |
| Commit / PR | Chưa tạo |
| Cần đọc tiếp | This log, `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-11-report.md`, Task 10 report, then serialized test output |
