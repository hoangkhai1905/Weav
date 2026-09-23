# Nhật ký ngày `2026-09-21` — Workflow Service V1 Task 9

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker — graph/mapping lane |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | Task 9 pure-domain implementation complete and tested; coordinator review pending; chưa commit |
| Phạm vi session | Fix mapping output path có segment rỗng và triển khai readiness/condition/retry domain thuần |
| Liên kết liên quan | Workflow spec; Workflow V1 plan Task 9; Task 3 report |

## 2. Tóm tắt điều hành

### Kết quả chính

- `ReadinessPlanner` lập lịch theo trạng thái từng edge; cạnh `UNKNOWN` khiến join chờ, cạnh inactive không chặn nhánh active, node chỉ được trả READY một lần, và nhánh không chọn được lan truyền SKIPPED.
- `ConditionEvaluator` hỗ trợ `eq`, `ne`, `gt`, `gte`, `lt`, `lte`; equality lồng nhau so sánh JSON number bằng giá trị số và ordering chỉ cho phép operand số.
- `RetryPolicy` phân biệt lỗi transient/permanent, giới hạn tổng số lần thử ở 3 và đặt delay sau lần 1/2 là 1/2 giây.
- Sửa regression Task 3: `{{ nodes.a.output. }}` và biến thể dotted node ID bị từ chối ở reference extraction/resolution; `{{ nodes.a.output }}` tiếp tục hợp lệ.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | `PASS` | Full Workflow Maven `test` lifecycle |
| Unit / integration | `PASS` | Focused combined selector 102/102; full module 132/132 |
| Database / migration | Chưa đổi | Full suite Testcontainers PostgreSQL/RabbitMQ chạy thành công |
| Runtime service | Chưa kiểm tra | Task 9 thuần domain; chưa có runner/engine |
| Review thay đổi | Đã kiểm tra | Source/tests reviewed; `git diff --check` recorded below |
| Commit / PR | Chưa tạo | Chờ coordinator review; không stage/commit/push |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- Thêm `GraphState`, `ReadinessPlanner`, `ConditionEvaluator`, `RetryPolicy` và pure domain tests.
- Regression nhỏ cho lỗi trailing-dot trong `MappingResolver` theo review của coordinator.
- Work log và Task 9 scratch report.

### Ngoài phạm vi

- Không triển khai admission, persistence, execution engine/runner, node executor, HTTP API hoặc database changes.
- Không sửa Task 5 authoring/security worker files, plan, ledger, migration, Compose hay contract ngoài schema existing Task 3.
- Không stage, commit, push hoặc chạy external CLI.

### Tiêu chí hoàn thành

- [x] Trạng thái root/edge được khởi tạo theo trigger đang fire và các trigger không hoạt động.
- [x] Join chờ mọi edge còn UNKNOWN và chỉ đòi các predecessor có edge ACTIVE.
- [x] Condition branches chỉ kích hoạt port được chọn; inactive subtree được skip.
- [x] Repeated readiness không trả lại node đã READY.
- [x] JSON structural equality, numeric ordering, invalid ordering, retry classes/count/delay có tests.
- [x] Task 3 empty trailing path regression RED/GREEN; work log/report cập nhật.

## 4. Bối cảnh, giả định và quyết định

- **Nguồn sự thật:** Workflow spec phần predicate operators và mapping; plan Task 9; clarification của coordinator trong task dispatch.
- **GraphState:** Chỉ lưu node statuses và edge states. Root input và node output thuộc execution snapshot tương lai; không thêm state fields chưa có contract.
- **Readiness mutation:** `ready(..)` trả list node mới READY và cập nhật GraphState sang READY; plan yêu cầu status transition nhưng interface trả về list. Lưu status ngăn lời gọi lặp schedule cùng node lần hai. `afterSuccess(..)` trả state copy có status/edge transitions mới.
- **Runtime ancestry:** Mapping resolver nhận outputs do engine cấp; chỉ future engine cung cấp outputs của successful active-path ancestors. Resolver không tự quyết định runtime ancestry.
- **Missing/null:** Condition evaluator nhận hai giá trị đã resolve; `null` là JSON value tường minh. Missing property phải bị mapping/runtime resolver từ chối trước khi gọi evaluator.
- **Retry classification:** HTTP 429 và 5xx cùng codes `NETWORK_ERROR`, `TIMEOUT`, `WORKER_INTERRUPTED` được retryable. Mapping/config/dependency/authentication-rejected là permanent; unknown code/status không retry. Caller cần map failure vào các classification này.

## 5. Nhật ký thực hiện

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước edit Task 3 | GitNexus upstream impact cho `nodeReferenceAt` và test symbol | Index stale; impact UNKNOWN/target-not-found. Search source xác nhận production references ở `DefinitionValidator` và test/resolver paths | Xong |
| Task 3 regression | Thêm test `references()`/graph-aware references/`resolve` cho simple và dotted IDs | RED: `MappingResolverTest` 17 tests, 1 failure vì trailing-dot expression không ném `MappingException` | Xong |
| Task 3 fix | Chặn trường hợp marker `.output` theo sau đúng một dấu chấm cuối | GREEN: cùng test class 17/17; exact `.output` và dotted IDs còn hợp lệ | Xong |
| Task 9 tests | Viết tests cho readiness/condition/retry trước production | RED test compile vì 4 Task 9 production symbols còn thiếu (9 compiler errors) | Xong |
| Task 9 implementation | Thêm status-only GraphState và 3 pure policies | Focused tests cover roots/joins/branches/conditions/retry | Xong |
| Verification | Focused selector rồi full Workflow module test | PASS 102/102; PASS 132/132, PostgreSQL/RabbitMQ Testcontainers; BUILD SUCCESS | Xong |
| Handoff | Cập nhật K work logs/report và trả Maven slot | `/root/workflow_security_worker` được báo có thể tiếp tục Task 5 | Xong |

## 6. Thay đổi đã thực hiện

### 6.1. Code và hành vi

- `GraphState` giữ immutable-by-copy node/edge maps với `NodeExecutionStatus` và `EdgeState { UNKNOWN, ACTIVE, INACTIVE }`; getters là read-only views.
- `ReadinessPlanner.initialize` đánh dấu firing trigger `SUCCESS`, trigger khác `SKIPPED`, và outgoing trigger edges `ACTIVE`/`INACTIVE`. Planner kiểm tra DAG/index consistency, unresolved joins, success readiness và branch exclusion.
- `ReadinessPlanner.afterSuccess` chỉ nhận node READY/RUNNING; ordinary edge output thành ACTIVE; `logic.condition` cần chọn `true` hoặc `false` và các cạnh port khác thành INACTIVE. Lặp cùng completion giữ route ổn định.
- `ConditionEvaluator` so sánh map/list theo cấu trúc, map key order không quan trọng, list order có ý nghĩa; number wrappers so sánh qua `BigDecimal`. Ordering nhận số; operator khác bị từ chối.
- `RetryPolicy` định nghĩa `MAX_ATTEMPTS=3`, retryable transient classes/statuses và `Duration` delay sau lần thử.
- `MappingResolver.nodeReferenceAt` từ chối path rỗng tạo bởi trailing `.` trong khi vẫn nhận biểu thức `nodes.<id>.output` không có property suffix.

### 6.2. File ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/execution/GraphState.java` | Status-only graph state | Không chứa input/output |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/execution/ReadinessPlanner.java` | Active edge readiness/branch exclusion | Thuần Java domain |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/execution/ConditionEvaluator.java` | Predicate operators and JSON comparisons | Missing input phải được phát hiện upstream |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/execution/RetryPolicy.java` | Retry categories/budget/delays | Caller phải dùng stable failure classifications |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/execution/ReadinessPlannerTest.java` | Root/join/nested branch regressions | Pure domain |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/execution/ConditionEvaluatorTest.java` | Nested equality/types/order failures | JSON structural behavior |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/execution/RetryPolicyTest.java` | Error classes/max attempts/delays | Covers permanent precedence |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingResolver.java` | Reject empty output path segment | Preserve exact output root |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/domain/mapping/MappingResolverTest.java` | Simple and dotted trailing-dot tests | Includes reference collection and resolution |
| `Sửa` | `docs/work_logs/K/2026-09-21-workflow-service-task-3.md` | Follow-up mapping regression evidence | Corrects stale T path entry |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-9-report.md` | Scoped Task 9 handoff | Coordinator review pending |
| `Thêm` | `docs/work_logs/K/2026-09-21-workflow-service-task-9.md` | Session log | No plan/ledger edit |

## 7. Kiểm tra và bằng chứng

Tất cả Maven commands chạy từ `services/workflow-service`; đã xác minh Maven-home junction `C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home` trỏ `C:\Users\nhoan\.m2`. Environment đặt `MAVEN_USER_HOME` về junction, `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`, repository `C:\Users\nhoan\.m2\repository`.

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=MappingResolverTest,DefinitionValidatorTest,DefinitionJsonCodecTest,ReadinessPlannerTest,ConditionEvaluatorTest,RetryPolicyTest,WorkspaceClientTest,WorkflowSecurityTest' '-DfailIfNoTests=false' test
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' test
```

| Hạng mục | Kết quả thực tế | Phạm vi / giới hạn |
| --- | --- | --- |
| Mapping TDD RED | 17 tests; 1 failure đúng expected | Trước fix, resolver chấp nhận trailing dot |
| Mapping focused GREEN | 17/17; 0 failures/errors/skips | `MappingResolverTest` |
| Combined focused suite | 102/102; 0 failures/errors/skips | Mapping/definition/codec, Task 9 và Task 4 selectors hiện có |
| Full Workflow module | 132/132; 0 failures/errors/skips; BUILD SUCCESS | Docker-backed PostgreSQL 18.6, RabbitMQ; chạy trước Task 5 edits |
| `git diff --check` | PASS, exit 0; output chỉ có line-ending notices trên `application.properties` của security lane | PowerShell trailing-whitespace scan cũng PASS trên toàn bộ source/test/log/report file thuộc lane này; coordinator vẫn review combined diff |

## 8. Rủi ro và việc chưa được kiểm tra

- Task 9 chưa được tiêu thụ bởi execution runner/engine và chưa được persist; Tasks 10–11 mới đưa fencing, runtime snapshots, cancellation và durable retries vào hệ thống.
- Pure unit tests không chứng minh parallel executor lifecycle, database atomicity, restart recovery hoặc live integrations.
- `ConditionEvaluator` không phân biệt missing với JSON null; contract phụ thuộc mapping/resolver kiểm tra property tồn tại trước khi gọi.
- Retry codes phải khớp với codes do future executor tạo; unknown errors hiện fail closed (không retry).
- GitNexus index stale; UNKNOWN/target-not-found đã được source-corroborate cho mapping edit, không coi đây là all-clear. Chưa chạy `detect_changes` vì chưa commit.
- Full run 132 tests predates Task 5 changes. Coordinator/security worker cần chạy suite kết hợp cuối sau khi Task 5 tests/source ổn định.

## 9. Trạng thái bàn giao

1. Coordinator review Task 3 fix và Task 9 pure domain implementation.
2. Security/authoring worker có Maven slot; tôi không chạy build song song với họ.
3. Sau khi Task 5 hoàn tất, chạy combined module suite với mọi worker file/tests hiện có và xác nhận tổng test count mới.
4. Tasks 10–11 cần dùng GraphState contracts, gắn input/output vào execution snapshot, persist atomic edge/node state và map lỗi vào RetryPolicy.
5. Chưa stage/commit/push; trước commit phải review shared diff và chạy GitNexus `detect_changes`.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 17:08 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; nhiều lane cùng branch với ownership tách biệt |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker — graph/mapping lane |
| Cần đọc trước khi tiếp tục | Task 9 report, Task 3 follow-up trong K log, Workflow plan Tasks 9–11 |
