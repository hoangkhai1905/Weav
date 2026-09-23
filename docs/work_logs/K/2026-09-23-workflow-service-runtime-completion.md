# Nhật ký ngày `2026-09-23` — Workflow Service Task 11 runtime recovery

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / working tree dirty |
| Người thực hiện | Codex Task 11 runtime recovery |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | Đã hoàn tất runtime recovery và serialized Maven verification; chờ coordinator review/detect-changes trước commit |
| Phạm vi session | Recover real Task 11 runtime integration, worker wiring, bounded retry/shutdown behavior, and handoff evidence |

## 2. Tóm tắt điều hành

### Kết quả chính

- Preserved and reviewed the partial PostgreSQL/RabbitMQ `ExecutionRuntimeIntegrationTest`, which covers the concrete runner through admission, outbox publish, listener claim, node execution, retries, recovery, fencing, and shutdown.
- Added explicit worker/runtime configuration defaults with the worker disabled unless deliberately enabled; bounded shutdown waiting to the lease-safe window.
- Added focused regressions for mapping, configuration, and authentication failures consuming one attempt without retry.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | PASS | Workflow module compile and the combined Maven suite completed; Java 25 emitted non-failing forked-compiler `AccessDeniedException` diagnostics for cached JARs. |
| Unit / integration test | PASS | Focused runner/state tests `8/8`, real PostgreSQL/RabbitMQ runtime `8/8`, Task 10 recovery `7/7`, combined Workflow suite `277/277`. |
| Migration / database | PASS | Testcontainers PostgreSQL/RabbitMQ started successfully; the real runtime fixture exercised the existing Task 8 V3 schema and Task 10 adapter. |
| Review thay đổi | Đã kiểm tra một phần | GitNexus impacts are `UNKNOWN` for new symbols because index predates Tasks 10/11; source callers and wiring were manually corroborated. |
| Commit / PR | Chưa tạo | Per task scope; no stage/commit/push. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Recover the partial Task 11 completion artifact without replacing the runner with a no-op or claiming pool-only coverage.
2. Preserve real DB/broker runtime acceptance for admission -> outbox -> listener -> runner -> terminal state, concurrent active paths, retries, recovery, fencing, and shutdown.
3. Hand off exact serialized verification requirements and the HTTP registry configuration handshake.

### Trong phạm vi

- `ExecutionRunner`, worker/listener wiring, registry configuration, runtime properties, persistence state adapter review, aggregate runtime tests, and required Task 11 reports.
- The existing Task 10 lease/fencing/recovery contracts and the approved Workflow V1 spec/plan.

### Ngoài phạm vi / chủ động chưa làm

- HTTP provider implementation and sanitizer, which remain Task 13 ownership.
- Task 12 HTTP/query changes, plan/progress ledgers, commit, stage, push, worktree, and external agent execution.

### Tiêu chí hoàn thành

- [x] Focused runtime unit tests pass after HTTP source-ready handshake.
- [x] Real PostgreSQL/RabbitMQ integration test passes with the enabled worker and concrete runner.
- [x] Combined Workflow suite passes; actual test counts and limitations are recorded here and in the scratch report.
- [ ] Coordinator runs fresh GitNexus change detection before any commit.

## 4. Bối cảnh và quyết định

- The partial worker already supplied `ExecutionRuntimeIntegrationTest.java` but no Surefire report. It is preserved as the acceptance fixture and not treated as completion evidence.
- The approved Task 11 contract requires attempts to be persisted before provider calls, active-path mappings only, concurrent independent nodes, joins that wait for all active predecessors, three total attempts with one-second/two-second delays, and fenced stale completion behavior.
- The integration fixture sets `weav.workflow.http.executor.enabled=false` so its deterministic `http.request` test adapter is the sole registry entry. Task 13 must use the same conditional property; otherwise Spring will register duplicate `http.request` adapters and fail closed during `NodeExecutorRegistry` construction.

## 5. Thay đổi đã thực hiện

### 5.1 Code and behavior

- `ExecutionRunner`: shutdown now waits against one deadline bounded by the smaller of thirty seconds and the configured lease duration, preserving lease expiry/recovery as the authority after in-flight work does not settle.
- `ExecutionJobListener`: refreshed the stale Task 10 comment; behavior remains UUID-only and concrete-runner gated.
- `ExecutionRuntimeIntegrationTest`: preserved the real runtime fixture, set a ten-second heartbeat interval to avoid a heartbeat racing the deliberate lease-expiry takeover assertion, and added an in-flight shutdown handoff test.
- `ExecutionRunnerTest`: added one-attempt/no-retry assertions for mapping, configuration, and confirmed authentication failures.
- `ExecutionRunnerConfiguration`: added the production concrete-runner bean wiring behind the existing application-runner port condition so the enabled worker has an actual runner at runtime.
- `ExecutionRecoveryTest`: marked the Task 10 test runner `@Primary` so its deliberate handoff double remains the selected bean when production wiring is present in the test context.

### 5.2 Cấu hình

- `src/main/resources/application.properties`: added worker enable/owner/lease/heartbeat/redelivery/registry runtime, bounded executor/timer, and recovery defaults. The worker default is `false`; the redelivery delay is numeric milliseconds because `ExecutionWorkerRabbitConfiguration` consumes a `long`.
- `src/test/resources/application.properties`: explicitly disables the worker and HTTP executor and sets bounded test pools.

### 5.3 Bàn giao tài liệu

- `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-11-completion-report.md`: recovery status, acceptance coverage, graph caveat, and serialized verification gate.

## 6. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/application/execution/ExecutionRunner.java` | Lease-safe bounded shutdown wait | Existing untracked Task 11 runtime source; review with runner tests. |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/messaging/ExecutionJobListener.java` | Comment aligned with concrete runner | No behavior change. |
| Sửa | `services/workflow-service/src/main/resources/application.properties` | Worker/runtime defaults | Worker remains disabled by default. |
| Sửa | `services/workflow-service/src/test/resources/application.properties` | Explicit test isolation properties | HTTP lane must honor executor switch. |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/application/execution/ExecutionRunnerTest.java` | Non-retryable failure regression | Mapping/config/auth each consume one attempt. |
| Thêm/preserve | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/execution/ExecutionRuntimeIntegrationTest.java` | Real DB/Rabbit/runtime acceptance fixture | 8/8 passed with Testcontainers. |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/execution/ExecutionRunnerConfiguration.java` | Concrete production runner bean wiring | Worker remains disabled by default; enabled integration path uses the actual runner. |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/application/execution/ExecutionRecoveryTest.java` | Preserve Task 10 runner override | `@Primary` selects the intentional recovery test double. |
| Sửa | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-11-completion-report.md` | Task 11 recovery handoff | Actual serialized and combined counts recorded. |

## 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus binding | `mcp__gitnexus__list_repos`, then impacts for `ExecutionRunner`, `ExecutionJobListener`, `ExecutionStateAdapter`, `NodeExecutorRegistry` | `UNKNOWN` / target-not-found; index `4aad0ce` is three commits behind | New Task 10/11 symbols are absent from the index; source search/manual wiring used as corroboration. |
| Diff whitespace | `git diff --check` plus owned-file trailing-whitespace scan | PASS | Tracked diff check and untracked owned files; line-ending warnings only. |
| Maven focused suite | `mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.compiler.fork=true' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' -Dtest=ExecutionRunnerTest,ExecutionRuntimeTest test` with `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` | PASS: 8 tests, 0 failures, 0 errors, 0 skipped | Ran after HTTP source-ready coordination; no real containers required for this slice. |
| Real runtime suite | Same Maven wrapper/repository settings with `-Dtest=ExecutionRuntimeIntegrationTest`, elevated Docker host access, and UTC | PASS: 8 tests, 0 failures, 0 errors, 0 skipped; 46.864s | Real Testcontainers PostgreSQL 18.6 and RabbitMQ path; serialized Maven slot. |
| Task 10 recovery suite | Same Maven wrapper/repository settings with `-Dtest=ExecutionRecoveryTest`, elevated Docker host access, and UTC | PASS: 7 tests, 0 failures, 0 errors, 0 skipped; 39.734s | Confirms recovery/fencing handoff remains green with production runner wiring present. |
| Combined suite | Coordinator-owned full Workflow `test` after both lanes were stable | PASS: 277 tests, 0 failures, 0 errors, 0 skipped; BUILD SUCCESS; 03:12 | One serialized Maven process; includes runtime, recovery, HTTP, and existing service tests. |

## 8. Rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý / chủ sở hữu |
| --- | --- | --- | --- |
| Trung bình | GitNexus impact is unresolved | New runtime symbols return target-not-found/`UNKNOWN` against stale index; a later method impact also hit the index storage-version mismatch | Coordinator refreshes/rebuilds the index and runs `detect_changes` before commit. |
| Thấp | Integration retry assertions use real wall clock | SQL checks require at least 700ms then 1700ms between attempt starts | Unit test uses fixed clock for exact `+1s/+3s` eligibility; integration remains real-container timing evidence. |
| Thấp | Java 25 forked compiler diagnostics | Maven reported cached Tomcat/JAXB JAR `AccessDeniedException` diagnostics while all requested goals completed successfully | Keep the configured Maven repository/junction and verify the next clean build if the toolchain is changed. |

## 9. Trạng thái bàn giao

### Đã hoàn tất trong session

1. Coordinated the HTTP source-ready state and conditional executor property before Maven.
2. Ran focused runner/state tests, the real PostgreSQL/RabbitMQ runtime suite, and Task 10 recovery suite in separate serialized Maven processes.
3. Ran the combined Workflow suite after both lanes were stable and recorded the actual counts above.

### Coordinator next steps

1. Review the shared dirty diff and confirm ownership boundaries across Tasks 10–13.
2. Refresh GitNexus for the current checkout, rerun impact where needed, and run `detect_changes` before any commit.
3. Decide commit/push separately; this lane performed no stage, commit, push, worktree, or external-agent action.

### Hướng dẫn cho AI agent tiếp theo

- Read the approved spec/plan, this log, the scratch report, Task 10 report, and `git status` before editing.
- Do not replace `ExecutionRunner` with a no-op or call pool-only tests runtime acceptance. The serialized evidence above is the actual completion evidence.
- Do not stage, commit, push, create a worktree, or run an external agent.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 Asia/Saigon` |
| Trạng thái worktree | Dirty shared worktree; Task 11/runtime and other workflow task changes are uncommitted |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 11 runtime recovery |
| Cần đọc trước khi tiếp tục | Approved Workflow spec/plan, Task 10 report, `scratchtask-11-completion-report.md`, and the coordinator's fresh GitNexus review |
