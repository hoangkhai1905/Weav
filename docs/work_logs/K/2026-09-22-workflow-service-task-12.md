# Nhật ký ngày `2026-09-22`

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav / T:\\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service / shared dirty checkout` |
| Người thực hiện | `Codex Workflow Task12 monitor lane` |
| Người review / nhận bàn giao | `root coordinator` |
| Trạng thái cuối ngày | `Hoàn thành lane; chờ root review/combined run` |
| Phạm vi session | `Manual execution admission, authorized monitoring projections, contract, and HTTP tests` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Added the manual execution controller with signed-JWT principal extraction, correlation/trace propagation, object-only input, and `202 Accepted` after Task8 admission returns.
- Added monitor authorization and bounded JDBC projections for exact workspace/workflow/execution tuples, stable pagination, attempt state, log pagination, and recursive persisted-data sanitization.
- Extended the body limit filter narrowly to the execution POST route, added chunked-route coverage, expanded the Workflow OpenAPI contract, and updated the contract README.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Forked Java 25 compiler; 131 main and 42 test sources compiled. |
| Unit / integration test | `PASS 19/19` | Serialized selector: `ExecutionRunnerTest` 4/4, `ExecutionRuntimeTest` 3/3, `WorkflowRequestBodyLimitFilterTest` 4/4, `WorkflowExecutionHttpTest` 8/8. |
| Migration / database | `Chưa thêm migration` | Uses existing execution/node/attempt/log schema and V3 columns. |
| Review thay đổi | `Đã kiểm tra` | GitNexus upstream impact was run before edits; new symbols were absent/stale and manually corroborated. |
| Commit / PR | `Chưa tạo` | Root owns commit/stage/push. |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- `WorkflowExecutionController`, `ManualExecutionRequest`, `ExecutionQueryService`, `ExecutionQueryPort`, `ExecutionQueryAdapter`, `ExecutionResponse`, and `WorkflowExecutionHttpTest`.
- Narrow `WorkflowRequestBodyLimitFilter` execution route extension and its test.
- `packages/contracts/http/workflow/openapi.yaml` and its README.

### Ngoài phạm vi

- Task11 runtime/node executor/entities/state adapter/listener/config files.
- Scheduled and webhook runtime routes, provider contracts, migrations, application/test properties, commit, stage, or push.

## 4. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Hệ quả và việc theo dõi |
| --- | --- | --- |
| Use `JdbcTemplate` projection SQL for monitoring | Avoids lazy JPA serialization and permits explicit tuple scoping, stable order, bounded log pages, and selected columns. | Query SQL must remain aligned with the existing Workflow schema. |
| Authorize `WORKFLOW_MONITOR` before query and keep `WORKFLOW_RUN` in admission | The spec requires distinct run/monitor capabilities and Workspace-owned authorization. | Real HTTP and MockMvc tests cover both capability denials. |
| Sanitize every persisted JSON/message/metadata value recursively | Legacy persisted outputs and provider responses may contain credentials. | Malformed persisted data becomes a safe availability marker; no raw provider details enter HTTP. |
| Keep webhook documentation marked planned | Tasks16/17 own schedule/webhook behavior; no deferred route is presented as live. | Gateway must not proxy the route before Task17. |

## 5. Thay đổi đã thực hiện

### Code và API

- Added `POST /workspaces/{workspaceId}/workflows/{workflowId}/executions` with signed JWT subject, `WORKFLOW_RUN`, object-only `{input:{...}}`, body limit, correlation/trace propagation, and `202` response mapping.
- Added monitor list/detail GET routes with `WORKFLOW_MONITOR`, page/size bounds, exact tuple lookup, deterministic order, node/attempt projections, and `logPage`/`logSize` pagination with `hasNext`.
- Added recursive key/string sanitization for persisted output, error, attempt data, log message, and log metadata.
- Kept the JDBC repository adapter proxyable for Spring's exception translator and corrected the HTTP oversized-body fixture so its raw JSON exceeds the 1 MiB filter limit.

### Contract and tests

- OpenAPI now contains ten public Workflow resource methods, the planned Task17 webhook shape, and the unchanged internal usage operation (`getConnectionUsage`, exact boolean success response, `401/429/500`).
- README documents service paths without `/api/v1`, Gateway prefix ownership, commit-before-202, capability split, sanitization, and deferred schedule/webhook status.
- HTTP coverage includes MockMvc signed JWT cases, real RANDOM_PORT HTTP with a signed JWT and PostgreSQL/Testcontainers, state/capability/tuple/pagination/sanitization/error cases, and chunked execution request-size enforcement.

## 6. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| GitNexus impact | `node .gitnexus/run.cjs impact ...` for existing symbols before edits | Existing execution/workflow symbols were LOW or stale/UNKNOWN; new Task12 symbols were absent. Source search/manual wiring corroborated UNKNOWN results. | Index was three commits behind HEAD. |
| Initial focused Maven | `-Dtest=WorkflowExecutionHttpTest test` | Main/test compilation reached the test phase; context stopped at Task11-owned `NodeExecutorRegistry` missing constructor selection. | Runtime worker later added `@Autowired`; no runtime file was edited here. |
| Serialized selector | `-Dmaven.compiler.fork=true -Djdk.net.URLClassPath.disableClassPathURLCheck=true -Dtest=WorkflowExecutionHttpTest,WorkflowRequestBodyLimitFilterTest,ExecutionRunnerTest,ExecutionRuntimeTest test` | `19/19` passed; BUILD SUCCESS. PostgreSQL 18.6/RabbitMQ Testcontainers and RANDOM_PORT Tomcat signed-JWT flow ran. | Focused selector; root owns final combined suite. |
| Second focused Maven attempt | Same selector before slot release | Overlapped an active Workflow Surefire/full run; testCompile saw transient missing main classes. | Unverified; do not use as source evidence. |
| Diff hygiene | `git diff --check` | Passed; only pre-existing LF-to-CRLF notices for application properties. | Untracked files require root's final ownership review. |

## 7. Rủi ro và blocker

- The focused selector is green after the runtime worker explicitly released the Maven slot. Root still owns the post-Task12 full combined suite.
- GitNexus is stale for fresh Task11/Task12 symbols; the UNKNOWN result is treated as unresolved and was manually corroborated with source search. Root owns final `detect_changes` before commit.
- Shared checkout contains other workers' uncommitted files; preserve them and review ownership before handoff.

## 8. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Root reviews this lane with the runtime worker's owned diff and runs the final combined suite.
2. Keep Task11 runtime/config files under the runtime worker's ownership.
3. Run fresh GitNexus change detection before any commit.

### Không làm

- No commit, stage, push, worktree, CLI, application properties, or test properties changes.

## 9. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 21:45 Asia/Saigon` |
| Trạng thái worktree | `shared dirty checkout; existing worker changes preserved` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Codex Workflow Task12 monitor lane` |
