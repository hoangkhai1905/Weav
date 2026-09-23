# Workflow Service V1 detailed record — admission and execution

> Historical task notes recovered from commit 18b6dfa. The source records below retain their original decisions, file inventories, test commands, and handoff details. Their test counts are milestone snapshots; the final integrated release evidence is in workflow-service-v1.md.

Source notes are grouped here to keep the K folder navigable while retaining implementation detail.

---

### Source record: 2026-09-21-workflow-service-task-8.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-09-21 |
| Múi giờ ghi log | Asia/Saigon |
| Dự án / repository | Weav / T:/Weav |
| Nhánh / commit đầu ngày | feature/workflow-service / c836de2 |
| Người thực hiện | Codex execution worker, Task 8 |
| Người review / nhận bàn giao | Coordinator /root |
| Trạng thái cuối session | Task 8 implementation và kiểm tra hoàn tất; chờ coordinator review |
| Phạm vi session | Atomic execution admission, V3 delivery state và durable RabbitMQ outbox |
| Liên kết liên quan | Workflow Service V1 spec, approved plan Task 8 |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thêm manual và automatic execution admission. Adapter khóa workflow rồi registration, đọc trạng thái/version/root hiện tại từ PostgreSQL và ghi execution, một node row cho mỗi node cùng outbox event trong một transaction.
- Thêm publisher dùng claim lease ngắn, gửi bên ngoài DB transaction, yêu cầu mandatory routing và correlated positive confirm; chỉ đánh dấu event PUBLISHED sau routed ACK. Polling được bật bằng scheduling configuration.
- Thêm migration V3 theo hướng additive cho root, correlation, traceparent, schedule, edge/worker lease, node retry và outbox lease/retry. V1 trigger_id được kiểm tra là đã tồn tại.
- Bổ sung input freeze/size/depth guard, preserving JSON object/array/scalar/null cho automatic input; manual input chỉ nhận object.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | PASS | Full Workflow Maven module BUILD SUCCESS |
| Unit / integration test | PASS | 196/196; zero failures/errors/skips |
| Migration / database | PASS | Populated V2 → V3 trên PostgreSQL 18.6 Testcontainers; dữ liệu cũ còn nguyên |
| RabbitMQ | PASS | Testcontainers kiểm persistent routed delivery, confirm, return, outage và duplicate window |
| Review thay đổi | Đã kiểm tra | git diff --check exit 0; Git chỉ báo line ending cho application.properties |
| Commit / PR | Chưa tạo | Không stage, commit hoặc push |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Tạo execution admission đã xác thực quyền và pin version/root hiện tại.
2. Commit execution, node rows và UUID-only outbox intent nguyên tử; admission không phụ thuộc broker.
3. Gửi outbox an toàn qua RabbitMQ với routed confirms, lease recovery và retry tách khỏi node attempt count.
4. Thêm V3 mà không sửa/xóa dữ liệu V1/V2.

##### Trong phạm vi

- Task 8 application port/use case/DTO/service, execution và outbox aggregate/port/entity/mapper/repository.
- Rabbit exchange/queue/DLQ, scheduled outbox publisher, application/test properties.
- Migration V3 và Task 8 regression tests.
- Chỉ ghi worklog dưới docs/work_logs/K/ và report dưới .superpowers/sdd/2026-09-21-workflow-service-v1/.

##### Ngoài phạm vi

- Không thêm HTTP execution API/controller, execution worker/listener, node runner hay runtime transitions của Tasks 10–11.
- Không triển khai schedule scanner, webhook ingress hoặc trigger provisioning.
- Không sửa plan/progress ledger thuộc coordinator.
- Không áp dụng migration vào production/shared database; không stage/commit/push.

##### Tiêu chí hoàn thành

- [x] Manual admission yêu cầu WORKFLOW_RUN, xác nhận workspace, PUBLISHED state, current version và exact manual root.
- [x] Automatic input giữ nguyên JSON shape; schedule firing slot được dedupe.
- [x] Execution, per-node rows và PENDING outbox được ghi cùng transaction; rollback không để lại partial admission.
- [x] Publisher gửi persistent UUID-only messages, mandatory route, routed positive confirm, fenced lease completion và retry.
- [x] V3 giữ lại dữ liệu V2 và không tạo lại trigger_id đã có trong V1.
- [x] Focused outbox tests và full Workflow module pass; log/report được cập nhật.

#### 4. Bối cảnh và quyết định

- Nguồn sự thật là docs/superpowers/specs/workflow-service-spec.md và Task 8 trong docs/superpowers/plans/2026-09-21-workflow-service-v1.md. Task 9 GraphState/readiness/retry thuộc lane riêng; Task 8 chỉ thêm persistence fields cần cho delivery.
- Admission lock theo thứ tự workflow row rồi trigger registration row, sau đó kiểm tra lại PUBLISHED/current version/active registration từ database. Event body không được quyết định workflow, version hay root.
- Manual authorization chạy trước persistence; automatic admission lấy workflow và root từ registration hiện hành. Manual input phải là object; automatic input được freeze như JSON object/array/scalar/null, có giới hạn bytes và depth.
- Payload outbox chỉ có executionId. Correlation ID và traceparent được truyền qua AMQP properties/headers. Rabbit send không nằm trong admission transaction.
- Outbox claim/update dùng lease token fencing. Claim transaction kết thúc trước network publish; mark-published và schedule-retry chạy trong transaction riêng. Retry count thuộc publisher và không tăng node attempt count.
- V1 đã có trigger_id. V3 chỉ thêm cột trạng thái delivery mới và partial unique trigger/scheduled slot index; test upgrade seed dữ liệu V2 rồi xác nhận các row và payload cũ còn nguyên.
- Scheduling review phát hiện @Scheduled không được bật và scheduled method trả int. RabbitExecutionConfiguration bật @EnableScheduling; publisher dùng wrapper void theo @Scheduled, đồng thời giữ publishPending() cho kiểm tra trực tiếp. Test properties trì hoãn polling tự động để không race các test.
- GitNexus MCP impact cho publisher/config/test mới trả target-not-found và risk UNKNOWN; CLI fallback lỗi EPERM realpath C:/Users/nhoan. Đã search call sites và đọc source trực tiếp; UNKNOWN vẫn được ghi là chưa giải đáp bởi index, không coi là risk thấp.

#### 5. Nhật ký session

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 2026-09-21 | Đọc AGENTS.md, spec, Task 8 plan, progress và Task 6/7/9 reports | Xác nhận ownership, admission contract, transaction boundaries và giới hạn Tasks 10–11 | Xong |
| 2026-09-21 | Kiểm tra GitNexus impact và source call sites trước khi sửa | New symbols target-not-found/UNKNOWN; source search cho thấy publisher được inject bởi test và kích hoạt bằng Spring scheduling | Xong |
| 2026-09-21 | Chạy focused admission/JSON/migration/persistence/outbox tests | Phát hiện test dùng accessor outbound cho AMQP message inbound; đổi sang receivedDeliveryMode, không đổi publisher persistence behavior | Xong |
| 2026-09-21 | Kiểm tra scheduling wiring | Phát hiện thiếu @EnableScheduling và scheduled method có return int; thêm config/wrapper void và test registration | Xong |
| 2026-09-21 | Chạy focused ExecutionOutboxTest sau wiring cuối | 6/6, zero failures/errors/skips | Xong |
| 2026-09-21 | Chạy full Workflow Service module sau mọi thay đổi | 196/196, zero failures/errors/skips, BUILD SUCCESS | Xong |
| 2026-09-21 | Chạy git diff --check và chuẩn bị handoff | Exit 0; chỉ có line-ending warnings; không stage/commit/push | Xong |

##### Diễn giải kiểm tra

- Lần chạy đầu trong sandbox dừng ở compile khi đọc cached Tomcat JAR ngoài workspace. Cùng lệnh chạy lại với quyền đọc Maven cache hoàn tất; không có source compile failure.
- Lần focused đầu có 24/25 test pass. Rabbit delivery mode phía nhận được Spring AMQP ánh xạ vào receivedDeliveryMode; sửa assertion trong test rồi ExecutionOutboxTest pass 5/5, sau khi thêm scheduling registration test là 6/6.
- Full suite cuối chạy sau khi bật scheduling: 196 test, zero failures/errors/skips. Testcontainers dùng PostgreSQL 18.6 và RabbitMQ. Warning về returned unroutable message và unique-node rollback là do regression test chủ động kích hoạt; assertion tương ứng pass.

#### 6. Thay đổi đã thực hiện

| Nhóm | File | Thay đổi |
| --- | --- | --- |
| Application | services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ExecutionAdmissionPort.java; application/service/ExecutionAdmissionService.java; application/usecase/TriggerExecutionUseCase.java; application/dto/ExecutionResultDto.java | Admission command/result, manual authorization, JSON input guards và use case wrapper |
| Domain | domain/model/aggregate/execution/WorkflowExecution.java; NodeExecution.java; domain/model/aggregate/workflow/OutboxEvent.java; domain/port/out/OutboxEventRepository.java | Trigger/root/context, arbitrary JSON input, node next-attempt time, publisher lease/retry state |
| Persistence | infrastructure/persistence/entity/WorkflowExecutionJpaEntity.java; NodeExecutionJpaEntity.java; OutboxEventJpaEntity.java; mapper/ExecutionPersistenceMapper.java; repository/WorkflowExecutionRepositoryAdapter.java; OutboxEventRepositoryAdapter.java | Object JSONB round-trip, locking/atomic admission, schedule dedupe, short SKIP LOCKED claims và fenced updates |
| Messaging/config | infrastructure/messaging/RabbitExecutionConfiguration.java; ExecutionOutboxPublisher.java; src/main/resources/application.properties | Durable exchange/queue/DLQ, scheduling activation, mandatory persistent send, confirms/returns, retry/backoff và bounds |
| Migration | src/main/resources/db/migration/V3__execution_delivery_state.sql | Additive delivery fields/indexes cho execution, node execution, outbox |
| Tests | src/test/java/com/weav/workflow/application/ExecutionAdmissionTest.java; infrastructure/messaging/ExecutionOutboxTest.java; infrastructure/persistence/ExecutionDeliveryMigrationTest.java; domain/definition/JsonValuesTest.java; src/test/resources/application.properties | Admission, broker failure/crash windows, migration preservation, arbitrary JSON và deterministic scheduler setup |

Shared files như application.properties và một số aggregate/entity có thay đổi từ các task khác trong cùng checkout; bảng trên chỉ mô tả phần Task 8.

#### 7. Kiểm tra và bằng chứng

Maven chạy từ services/workflow-service. Maven home junction đã xác nhận trỏ tới C:/Users/nhoan/.m2; JAVA_TOOL_OPTIONS đặt -Duser.timezone=UTC.

| Phạm vi | Lệnh / thao tác | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| Outbox focused cuối | .\mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=ExecutionOutboxTest test | 6/6 PASS | PostgreSQL/RabbitMQ Testcontainers; test đăng ký scheduler và polling trực tiếp |
| Full Workflow module cuối | .\mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository test | 196/196 PASS; BUILD SUCCESS | Combined current checkout Tasks 1–9; PostgreSQL 18.6/RabbitMQ Testcontainers |
| Migration upgrade | ExecutionDeliveryMigrationTest trong full run | Populated V2 → V3 PASS; trigger_id vẫn một cột; execution/node/outbox/version data được giữ | Disposable PostgreSQL, không phải production copy |
| Rabbit delivery | ExecutionOutboxTest trong full run | Persistent routed delivery, positive confirm, return, broker down/recovery, crash-after-confirm duplicate window đều PASS | Không chạy consumer/worker xử lý execution |
| Static diff | git diff --check | Exit 0 | Git in line-ending notice cho application.properties |
| GitNexus | impact cho publisher/config/test | target not found, risk UNKNOWN; CLI fallback EPERM | Root cần chạy change detection trước khi commit; search/source review đã thực hiện cho lane này |

#### 8. Sự cố, rủi ro và giới hạn

| Mức độ | Vấn đề | Bằng chứng / xử lý | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | Outbox delivery cần một consumer runtime | Task 8 chỉ gửi executionId vào durable queue; chưa có Task 10–11 worker/listener | Root giữ runtime acceptance cho các task sau |
| Thấp | Chưa chạy production-sized migration/performance test | V3 kiểm bằng populated Testcontainers schema, không dùng copy dữ liệu lớn; index tạo bình thường trong test migration | Review migration lock/rollout trước production nếu bảng lớn |
| Thấp | GitNexus không index được các symbol mới | impact trả UNKNOWN; đã kiểm tra rg và source thủ công | Coordinator refresh/analyze graph và chạy detect_changes trước commit |
| N/A | Không còn blocker test Task 8 | Final full suite 196/196 pass | Root review combined changes |

##### Điều chưa được kiểm tra

- Không áp dụng V3 lên production/shared database hoặc đo thời gian tạo index với dữ liệu lớn.
- Không chạy Workflow/Workspace deployment qua Docker Compose.
- Không xác minh một execution được worker tiêu thụ và hoàn thành; worker/listener nằm ngoài Task 8.
- Không có Task 8 public HTTP controller; API wiring thuộc task sau.

#### 9. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Root review Task 8 service/adapter transaction, migration, publisher confirm/return/lease logic và scheduler wiring.
2. Root review các aggregate/entity shared với Tasks 1–9 trong combined diff; progress/plan ledger vẫn do coordinator sở hữu.
3. Trước commit, chạy GitNexus detect_changes và independent diff/security review.

##### Chưa làm

- Không stage, commit, push hoặc sửa progress.md/approved plan.
- Không triển khai execution consumer/runtime.

##### Hướng dẫn cho AI agent tiếp theo

- Đọc file log này, scratchtask-8-report.md, spec/plan và git status trước khi sửa.
- Không coi GitNexus UNKNOWN là low risk hoặc bằng chứng không có caller.
- Chạy lại full Workflow module sau bất kỳ thay đổi nào vào chung execution/outbox/migration files.

#### 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | 2026-09-21 22:48 Asia/Saigon |
| Trạng thái worktree | Có thay đổi chưa commit từ Tasks 1–9; Task 8 không stage/commit |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex execution worker, Task 8 |
| Cần đọc trước khi tiếp tục | Task 8 report, approved spec/plan và progress ledger |
---

### Source record: 2026-09-21-workflow-service-task-9.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- `ReadinessPlanner` lập lịch theo trạng thái từng edge; cạnh `UNKNOWN` khiến join chờ, cạnh inactive không chặn nhánh active, node chỉ được trả READY một lần, và nhánh không chọn được lan truyền SKIPPED.
- `ConditionEvaluator` hỗ trợ `eq`, `ne`, `gt`, `gte`, `lt`, `lte`; equality lồng nhau so sánh JSON number bằng giá trị số và ordering chỉ cho phép operand số.
- `RetryPolicy` phân biệt lỗi transient/permanent, giới hạn tổng số lần thử ở 3 và đặt delay sau lần 1/2 là 1/2 giây.
- Sửa regression Task 3: `{{ nodes.a.output. }}` và biến thể dotted node ID bị từ chối ở reference extraction/resolution; `{{ nodes.a.output }}` tiếp tục hợp lệ.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | `PASS` | Full Workflow Maven `test` lifecycle |
| Unit / integration | `PASS` | Focused combined selector 102/102; full module 132/132 |
| Database / migration | Chưa đổi | Full suite Testcontainers PostgreSQL/RabbitMQ chạy thành công |
| Runtime service | Chưa kiểm tra | Task 9 thuần domain; chưa có runner/engine |
| Review thay đổi | Đã kiểm tra | Source/tests reviewed; `git diff --check` recorded below |
| Commit / PR | Chưa tạo | Chờ coordinator review; không stage/commit/push |

#### 3. Mục tiêu và phạm vi

##### Trong phạm vi

- Thêm `GraphState`, `ReadinessPlanner`, `ConditionEvaluator`, `RetryPolicy` và pure domain tests.
- Regression nhỏ cho lỗi trailing-dot trong `MappingResolver` theo review của coordinator.
- Work log và Task 9 scratch report.

##### Ngoài phạm vi

- Không triển khai admission, persistence, execution engine/runner, node executor, HTTP API hoặc database changes.
- Không sửa Task 5 authoring/security worker files, plan, ledger, migration, Compose hay contract ngoài schema existing Task 3.
- Không stage, commit, push hoặc chạy external CLI.

##### Tiêu chí hoàn thành

- [x] Trạng thái root/edge được khởi tạo theo trigger đang fire và các trigger không hoạt động.
- [x] Join chờ mọi edge còn UNKNOWN và chỉ đòi các predecessor có edge ACTIVE.
- [x] Condition branches chỉ kích hoạt port được chọn; inactive subtree được skip.
- [x] Repeated readiness không trả lại node đã READY.
- [x] JSON structural equality, numeric ordering, invalid ordering, retry classes/count/delay có tests.
- [x] Task 3 empty trailing path regression RED/GREEN; work log/report cập nhật.

#### 4. Bối cảnh, giả định và quyết định

- **Nguồn sự thật:** Workflow spec phần predicate operators và mapping; plan Task 9; clarification của coordinator trong task dispatch.
- **GraphState:** Chỉ lưu node statuses và edge states. Root input và node output thuộc execution snapshot tương lai; không thêm state fields chưa có contract.
- **Readiness mutation:** `ready(..)` trả list node mới READY và cập nhật GraphState sang READY; plan yêu cầu status transition nhưng interface trả về list. Lưu status ngăn lời gọi lặp schedule cùng node lần hai. `afterSuccess(..)` trả state copy có status/edge transitions mới.
- **Runtime ancestry:** Mapping resolver nhận outputs do engine cấp; chỉ future engine cung cấp outputs của successful active-path ancestors. Resolver không tự quyết định runtime ancestry.
- **Missing/null:** Condition evaluator nhận hai giá trị đã resolve; `null` là JSON value tường minh. Missing property phải bị mapping/runtime resolver từ chối trước khi gọi evaluator.
- **Retry classification:** HTTP 429 và 5xx cùng codes `NETWORK_ERROR`, `TIMEOUT`, `WORKER_INTERRUPTED` được retryable. Mapping/config/dependency/authentication-rejected là permanent; unknown code/status không retry. Caller cần map failure vào các classification này.

#### 5. Nhật ký thực hiện

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước edit Task 3 | GitNexus upstream impact cho `nodeReferenceAt` và test symbol | Index stale; impact UNKNOWN/target-not-found. Search source xác nhận production references ở `DefinitionValidator` và test/resolver paths | Xong |
| Task 3 regression | Thêm test `references()`/graph-aware references/`resolve` cho simple và dotted IDs | RED: `MappingResolverTest` 17 tests, 1 failure vì trailing-dot expression không ném `MappingException` | Xong |
| Task 3 fix | Chặn trường hợp marker `.output` theo sau đúng một dấu chấm cuối | GREEN: cùng test class 17/17; exact `.output` và dotted IDs còn hợp lệ | Xong |
| Task 9 tests | Viết tests cho readiness/condition/retry trước production | RED test compile vì 4 Task 9 production symbols còn thiếu (9 compiler errors) | Xong |
| Task 9 implementation | Thêm status-only GraphState và 3 pure policies | Focused tests cover roots/joins/branches/conditions/retry | Xong |
| Verification | Focused selector rồi full Workflow module test | PASS 102/102; PASS 132/132, PostgreSQL/RabbitMQ Testcontainers; BUILD SUCCESS | Xong |
| Handoff | Cập nhật K work logs/report và trả Maven slot | `/root/workflow_security_worker` được báo có thể tiếp tục Task 5 | Xong |

#### 6. Thay đổi đã thực hiện

##### 6.1. Code và hành vi

- `GraphState` giữ immutable-by-copy node/edge maps với `NodeExecutionStatus` và `EdgeState { UNKNOWN, ACTIVE, INACTIVE }`; getters là read-only views.
- `ReadinessPlanner.initialize` đánh dấu firing trigger `SUCCESS`, trigger khác `SKIPPED`, và outgoing trigger edges `ACTIVE`/`INACTIVE`. Planner kiểm tra DAG/index consistency, unresolved joins, success readiness và branch exclusion.
- `ReadinessPlanner.afterSuccess` chỉ nhận node READY/RUNNING; ordinary edge output thành ACTIVE; `logic.condition` cần chọn `true` hoặc `false` và các cạnh port khác thành INACTIVE. Lặp cùng completion giữ route ổn định.
- `ConditionEvaluator` so sánh map/list theo cấu trúc, map key order không quan trọng, list order có ý nghĩa; number wrappers so sánh qua `BigDecimal`. Ordering nhận số; operator khác bị từ chối.
- `RetryPolicy` định nghĩa `MAX_ATTEMPTS=3`, retryable transient classes/statuses và `Duration` delay sau lần thử.
- `MappingResolver.nodeReferenceAt` từ chối path rỗng tạo bởi trailing `.` trong khi vẫn nhận biểu thức `nodes.<id>.output` không có property suffix.

##### 6.2. File ảnh hưởng

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

#### 7. Kiểm tra và bằng chứng

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

#### 8. Rủi ro và việc chưa được kiểm tra

- Task 9 chưa được tiêu thụ bởi execution runner/engine và chưa được persist; Tasks 10–11 mới đưa fencing, runtime snapshots, cancellation và durable retries vào hệ thống.
- Pure unit tests không chứng minh parallel executor lifecycle, database atomicity, restart recovery hoặc live integrations.
- `ConditionEvaluator` không phân biệt missing với JSON null; contract phụ thuộc mapping/resolver kiểm tra property tồn tại trước khi gọi.
- Retry codes phải khớp với codes do future executor tạo; unknown errors hiện fail closed (không retry).
- GitNexus index stale; UNKNOWN/target-not-found đã được source-corroborate cho mapping edit, không coi đây là all-clear. Chưa chạy `detect_changes` vì chưa commit.
- Full run 132 tests predates Task 5 changes. Coordinator/security worker cần chạy suite kết hợp cuối sau khi Task 5 tests/source ổn định.

#### 9. Trạng thái bàn giao

1. Coordinator review Task 3 fix và Task 9 pure domain implementation.
2. Security/authoring worker có Maven slot; tôi không chạy build song song với họ.
3. Sau khi Task 5 hoàn tất, chạy combined module suite với mọi worker file/tests hiện có và xác nhận tổng test count mới.
4. Tasks 10–11 cần dùng GraphState contracts, gắn input/output vào execution snapshot, persist atomic edge/node state và map lỗi vào RetryPolicy.
5. Chưa stage/commit/push; trước commit phải review shared diff và chạy GitNexus `detect_changes`.

#### 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 17:08 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; nhiều lane cùng branch với ownership tách biệt |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker — graph/mapping lane |
| Cần đọc trước khi tiếp tục | Task 9 report, Task 3 follow-up trong K log, Workflow plan Tasks 9–11 |
---

### Source record: 2026-09-21-workflow-service-task-10.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` (tiếp tục kiểm tra ngày `2026-09-22`) |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker — Task 10 leases/fencing/recovery |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | Task 10 implementation and focused integration tests complete; coordinator review pending; chưa commit |
| Phạm vi session | Durable execution leases, fencing, acknowledged-message recovery, and gated UUID-only Rabbit listener |
| Liên kết liên quan | Workflow spec; Workflow V1 plan Task 10; Task 9 report; Task 8 report |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thêm `ExecutionStatePort` lease contract và `ExecutionStateAdapter` dùng `CURRENT_TIMESTAMP` của PostgreSQL cho claim, renew, load, commit và release; mọi transition được fence bằng owner/token/expiry.
- Takeover giữ nguyên node `SUCCESS`/`SKIPPED`, chuyển attempt đang `RUNNING` thành `WORKER_INTERRUPTED`, giữ ngân sách attempts đã dùng và áp dụng retry delay đã lưu.
- Thêm scanner bounded, guarded và multi-replica-safe để khôi phục execution đã được broker xác nhận nhưng bị bỏ lại; recovery ghi UUID-only outbox event trong transaction DB.
- Thêm UUID-only listener với DLQ cho envelope sai, delayed durable retry khi DB lỗi tạm thời, duplicate/terminal ACK có điều kiện và runner handoff boundary. Worker/scanner không chạy mặc định; yêu cầu bật `weav.workflow.execution.worker.enabled=true` cùng một `ExecutionRunner` thật.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | `PASS` | Maven test lifecycle; biên dịch 119 main và 39 test sources |
| Unit / integration | `PASS` | Focused `ExecutionLeaseTest,ExecutionRecoveryTest`: 15/15, 0 failure/error/skip |
| Database / broker | `PASS` | PostgreSQL 18.6 và RabbitMQ Testcontainers trong focused suite |
| Runtime service | Chưa bật | Worker/scanner feature flag mặc định tắt; Task 11 runner chưa được triển khai |
| Review thay đổi | Chưa hoàn tất | GitNexus fresh-file impacts báo `UNKNOWN`; source search/manual wiring review đã thực hiện |
| Commit / PR | Chưa tạo | Theo phạm vi worker; không stage/commit/push |

#### 3. Mục tiêu và phạm vi

##### Trong phạm vi

- Lease port, snapshot/transition contracts, persistence adapter, Rabbit listener, recovery scanner/configuration và regression tests.
- Khôi phục an toàn execution đã mất consumer sau ACK; không nhận công việc mới khi ứng dụng dừng.

##### Ngoài phạm vi

- Task 11 runner/node execution engine và các connector.
- Sửa authoring/security/draft/definition paths hoặc Task 8 admission/outbox flows.
- Exactly-once side effects bên ngoài service; broker delivery vẫn có thể lặp và consumer phải idempotent.

##### Tiêu chí hoàn thành

- Claim/renew/commit/release được fence bằng giờ DB và stale owner không thể ghi trạng thái.
- Restart/takeover bảo toàn node terminal và attempt budget.
- Recovery bounded, guarded và dùng outbox bền vững; malformed delivery vào DLQ, lỗi DB tạm thời không tạo hot loop.
- Ch focused real PostgreSQL/Rabbit regressions pass, diff sạch và có log bàn giao.

#### 4. Bối cảnh và quyết định

- Task 9 đã cung cấp GraphState/readiness/condition/retry semantics; adapter chuyển persisted snapshot thành lease/transition mà không thay đổi hợp đồng này.
- Chọn database `CURRENT_TIMESTAMP` làm nguồn thời gian fence; renew dùng transaction ngắn riêng để runner dài không giữ transaction mở.
- Không ACK message vào no-op runner khi Task 11 còn thiếu. Runtime listener/scanner được gate; dependency injection yêu cầu `ExecutionRunner` thật khi bật worker.
- Khi mất lease, adapter từ chối transition và transaction rollback nguyên tử. Legacy state thiếu root/version không thể khôi phục thì thất bại rõ ràng với mã sanitized `LEGACY_STATE_UNRECOVERABLE`.

#### 5. Thay đổi

##### Application/domain boundary

- `application/port/out/ExecutionStatePort.java`: lease, snapshot, transition và fencing API.
- `application/port/out/ExecutionRecoveryPort.java`: bounded recovery selection/guard contract.
- `application/port/in/ExecutionRunner.java`: handoff `run(Lease)` cho runner sẽ do Task 11 cung cấp.

##### Persistence, messaging, scheduling

- `infrastructure/persistence/repository/ExecutionStateAdapter.java`: PostgreSQL claim/renew/load/commit/release; transition các node, attempt, log và edge trong transaction ngắn; stale lease/constraint failure rollback.
- `infrastructure/messaging/ExecutionJobListener.java`: strict UUID-only envelope, invalid-message reject/DLQ, transient DB delayed retry với persistent TTL/retry queue, terminal/already-owned duplicate ACK, ACK delivery gốc chỉ sau positive confirm.
- `infrastructure/messaging/ExecutionWorkerRabbitConfiguration.java`: durable retry/dead-letter topology và consumer shutdown/admission behavior.
- `infrastructure/scheduling/ExecutionRecoveryScanner.java`: batch giới hạn, `FOR UPDATE SKIP LOCKED`, pending/recent outbox guard, UUID-only event insert nguyên tử.
- Cấu hình `weav.workflow.execution.worker.enabled` để ngăn consumer/scanner tự chạy trước khi có runner thật.

##### Regression tests

- `ExecutionLeaseTest`: cạnh tranh claim, renew/heartbeat, stale owner, takeover với SUCCESS/SKIPPED và attempt budget, rollback nguyên tử, thiếu legacy root.
- `ExecutionRecoveryTest`: recovery sau ACK/lease expiry, runner handoff thật trong test, broker confirm, duplicate terminal, malformed-to-DLQ, DB retry trước ACK, shutdown/requeue và null-map/finishedAt contracts.

Không thêm migration Task 10; các state fields cần thiết đã được Task 8 V3 cung cấp.

#### 6. Kiểm tra và bằng chứng

Chạy từ `services/workflow-service` với `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` và local Maven repository `C:\Users\nhoan\.m2\repository`:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=ExecutionLeaseTest,ExecutionRecoveryTest' test
```

- Kết quả cuối: `ExecutionLeaseTest` 8/8, `ExecutionRecoveryTest` 7/7; tổng `15/15`, 0 failure/error/skip, `BUILD SUCCESS`.
- Surefire chạy real PostgreSQL 18.6/RabbitMQ Testcontainers; Maven lifecycle compile toàn bộ main/test sources.
- `git diff --check`: exit 0. Quét trailing whitespace PowerShell trên 9 file Task 10 thuộc ownership: không thấy kết quả.

##### Điều chưa được kiểm tra

- Chưa chạy full Workflow suite sau khi các Task 10 và M1 fixes cùng ổn định; coordinator giữ slot để chạy combined suite.
- Chưa bật consumer trong deployment; Task 11 runner/runtime acceptance vẫn còn.
- GitNexus index chưa bao gồm các file mới: impact trả `UNKNOWN`/target-not-found; đã kiểm tra Spring bean, listener, scheduler và test wiring bằng source search/manual review nhưng graph chưa được xác nhận.

#### 7. Sự cố và rủi ro

- Một lần test broker confirm bị timeout; các lần cuối với mandatory routing, confirms/returns và regression trực tiếp đều pass. Nguyên nhân lần timeout riêng lẻ chưa được xác định, không kết luận đó là defect đã sửa.
- Một test stale-owner cần unwrap nguyên nhân cụ thể do Spring repository proxy bọc exception; rollback test được sửa để cung cấp snapshot node đầy đủ. Các test cuối cùng pass.
- Lưu ý delivery là at-least-once; duplicate publish/consume vẫn có thể xảy ra. Không tuyên bố exactly-once external side effects.

#### 8. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator review Task 10 diff và chạy combined Workflow suite sau M1 fixes.
2. Trước commit, refresh GitNexus/index hoặc xác nhận tác động mới, sau đó chạy `detect_changes`; root owns review/acceptance.

##### Hạn chế

- Không triển khai Task 11 tại session này. Giữ worker/scanner disabled trong runtime cho tới khi real `ExecutionRunner` được nối và verified.
- Không stage, commit hoặc push.

#### 9. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; workspace chia sẻ chứa các task khác |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker |
| Cần đọc trước khi tiếp tục | Workflow spec, approved plan Task 10, file này và `scratchtask-10-report.md` |
---

### Source record: 2026-09-22-workflow-service-task-11.md


#### Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-09-22` |
| Múi giờ | `Asia/Saigon` |
| Repository / nhánh | `T:\Weav` / `feature/workflow-service` |
| Người thực hiện | Worker Task 11 |
| Người nhận bàn giao | `/root`, monitor worker Task 12 |
| Trạng thái | Đang tiếp tục; source handoff chờ serialized monitor verification |
| Phạm vi | Durable concurrent workflow-node execution, attempts/retries, registry and bounded runtime resources |

#### Kết quả

- Added the `NodeExecutor` boundary, safe failure/result records, fail-closed registry, built-in `logic.condition` evaluator, attempt invoker, and `RetryWaitPort`.
- Added the fenced `application.port.in.ExecutionRunner` implementation. It initializes and persists graph state, writes RUNNING attempts before provider calls, resolves/revalidates active-path mappings, commits safe terminal output/error, runs READY nodes concurrently within a bound, preserves retry budget, and waits without a database transaction.
- Added bounded executor/timer configuration and scheduled retry waiting. Added aggregate terminal failure transitions for node attempts/nodes.
- Added unit coverage for concurrent admission/attempt persistence, retries, active branch mapping, missing adapters, bounded pools, and timer waiting.
- Fixed Spring wiring discovered during Task 12 context review: `NodeExecutorRegistry` list constructor is explicitly `@Autowired`; runtime clock injections use the qualified `workflowExecutionClock` bean.

#### Owned files

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

#### Decisions and safeguards

- The existing `application.port.in.ExecutionRunner.run(Lease)` boundary is implemented directly; no second runner port or duplicate bean name was introduced.
- Provider calls occur in bounded executor threads outside `ExecutionStateAdapter` transactions. Heartbeats use separate short renewals. A failed fence prevents stale completion commits and stops further admission.
- Retry policy uses three total attempts and persisted eligibility after one and two consumed attempts. The runtime does not invent external adapters or no-op providers; missing registry entries become sanitized `DEPENDENCY_NOT_CONFIGURED` failures.
- Mapping context is derived from active graph edges and successful ancestors for the specific target node. Inactive branch outputs are not exposed.
- GitNexus impact for new/uncommitted runtime symbols was `UNKNOWN`/target-not-found because the repository index predates Tasks 10–11. CLI fallback was blocked by `EPERM realpath`; source search and call-site inspection corroborated the boundary and no HIGH/CRITICAL result was available. Refresh graph metadata before commit review.

#### Verification evidence

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

#### Handoff / next steps

1. No Maven process is owned by this worker after focused session `46181` completed `BUILD SUCCESS` at `2026-09-22 21:35 Asia/Saigon`; the serialized slot is released to the monitor worker.
2. Monitor should rerun `ExecutionRunnerTest,ExecutionRuntimeTest` after the registry/clock wiring fixes, then run its Spring context check. Do not overlap another Maven invocation.
3. Coordinator should run the real PostgreSQL/Rabbit path with deterministic fake executors, restart/lease-loss cases, and the post-Task 11 combined suite. This worker did not claim those checks.
4. No commit, stage, push, plan-ledger, progress-ledger, or Task 12 files were changed.

#### Session close

| Trường | Giá trị |
| --- | --- |
| Worktree | Shared dirty worktree; only Task 11 owned files above were edited in this session |
| Commit / PR | Chưa tạo |
| Cần đọc tiếp | This log, `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-11-report.md`, Task 10 report, then serialized test output |
---

### Source record: 2026-09-22-workflow-service-task-12.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Added the manual execution controller with signed-JWT principal extraction, correlation/trace propagation, object-only input, and `202 Accepted` after Task8 admission returns.
- Added monitor authorization and bounded JDBC projections for exact workspace/workflow/execution tuples, stable pagination, attempt state, log pagination, and recursive persisted-data sanitization.
- Extended the body limit filter narrowly to the execution POST route, added chunked-route coverage, expanded the Workflow OpenAPI contract, and updated the contract README.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Forked Java 25 compiler; 131 main and 42 test sources compiled. |
| Unit / integration test | `PASS 19/19` | Serialized selector: `ExecutionRunnerTest` 4/4, `ExecutionRuntimeTest` 3/3, `WorkflowRequestBodyLimitFilterTest` 4/4, `WorkflowExecutionHttpTest` 8/8. |
| Migration / database | `Chưa thêm migration` | Uses existing execution/node/attempt/log schema and V3 columns. |
| Review thay đổi | `Đã kiểm tra` | GitNexus upstream impact was run before edits; new symbols were absent/stale and manually corroborated. |
| Commit / PR | `Chưa tạo` | Root owns commit/stage/push. |

#### 3. Mục tiêu và phạm vi

##### Trong phạm vi

- `WorkflowExecutionController`, `ManualExecutionRequest`, `ExecutionQueryService`, `ExecutionQueryPort`, `ExecutionQueryAdapter`, `ExecutionResponse`, and `WorkflowExecutionHttpTest`.
- Narrow `WorkflowRequestBodyLimitFilter` execution route extension and its test.
- `packages/contracts/http/workflow/openapi.yaml` and its README.

##### Ngoài phạm vi

- Task11 runtime/node executor/entities/state adapter/listener/config files.
- Scheduled and webhook runtime routes, provider contracts, migrations, application/test properties, commit, stage, or push.

#### 4. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Hệ quả và việc theo dõi |
| --- | --- | --- |
| Use `JdbcTemplate` projection SQL for monitoring | Avoids lazy JPA serialization and permits explicit tuple scoping, stable order, bounded log pages, and selected columns. | Query SQL must remain aligned with the existing Workflow schema. |
| Authorize `WORKFLOW_MONITOR` before query and keep `WORKFLOW_RUN` in admission | The spec requires distinct run/monitor capabilities and Workspace-owned authorization. | Real HTTP and MockMvc tests cover both capability denials. |
| Sanitize every persisted JSON/message/metadata value recursively | Legacy persisted outputs and provider responses may contain credentials. | Malformed persisted data becomes a safe availability marker; no raw provider details enter HTTP. |
| Keep webhook documentation marked planned | Tasks16/17 own schedule/webhook behavior; no deferred route is presented as live. | Gateway must not proxy the route before Task17. |

#### 5. Thay đổi đã thực hiện

##### Code và API

- Added `POST /workspaces/{workspaceId}/workflows/{workflowId}/executions` with signed JWT subject, `WORKFLOW_RUN`, object-only `{input:{...}}`, body limit, correlation/trace propagation, and `202` response mapping.
- Added monitor list/detail GET routes with `WORKFLOW_MONITOR`, page/size bounds, exact tuple lookup, deterministic order, node/attempt projections, and `logPage`/`logSize` pagination with `hasNext`.
- Added recursive key/string sanitization for persisted output, error, attempt data, log message, and log metadata.
- Kept the JDBC repository adapter proxyable for Spring's exception translator and corrected the HTTP oversized-body fixture so its raw JSON exceeds the 1 MiB filter limit.

##### Contract and tests

- OpenAPI now contains ten public Workflow resource methods, the planned Task17 webhook shape, and the unchanged internal usage operation (`getConnectionUsage`, exact boolean success response, `401/429/500`).
- README documents service paths without `/api/v1`, Gateway prefix ownership, commit-before-202, capability split, sanitization, and deferred schedule/webhook status.
- HTTP coverage includes MockMvc signed JWT cases, real RANDOM_PORT HTTP with a signed JWT and PostgreSQL/Testcontainers, state/capability/tuple/pagination/sanitization/error cases, and chunked execution request-size enforcement.

#### 6. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| GitNexus impact | `node .gitnexus/run.cjs impact ...` for existing symbols before edits | Existing execution/workflow symbols were LOW or stale/UNKNOWN; new Task12 symbols were absent. Source search/manual wiring corroborated UNKNOWN results. | Index was three commits behind HEAD. |
| Initial focused Maven | `-Dtest=WorkflowExecutionHttpTest test` | Main/test compilation reached the test phase; context stopped at Task11-owned `NodeExecutorRegistry` missing constructor selection. | Runtime worker later added `@Autowired`; no runtime file was edited here. |
| Serialized selector | `-Dmaven.compiler.fork=true -Djdk.net.URLClassPath.disableClassPathURLCheck=true -Dtest=WorkflowExecutionHttpTest,WorkflowRequestBodyLimitFilterTest,ExecutionRunnerTest,ExecutionRuntimeTest test` | `19/19` passed; BUILD SUCCESS. PostgreSQL 18.6/RabbitMQ Testcontainers and RANDOM_PORT Tomcat signed-JWT flow ran. | Focused selector; root owns final combined suite. |
| Second focused Maven attempt | Same selector before slot release | Overlapped an active Workflow Surefire/full run; testCompile saw transient missing main classes. | Unverified; do not use as source evidence. |
| Diff hygiene | `git diff --check` | Passed; only pre-existing LF-to-CRLF notices for application properties. | Untracked files require root's final ownership review. |

#### 7. Rủi ro và blocker

- The focused selector is green after the runtime worker explicitly released the Maven slot. Root still owns the post-Task12 full combined suite.
- GitNexus is stale for fresh Task11/Task12 symbols; the UNKNOWN result is treated as unresolved and was manually corroborated with source search. Root owns final `detect_changes` before commit.
- Shared checkout contains other workers' uncommitted files; preserve them and review ownership before handoff.

#### 8. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Root reviews this lane with the runtime worker's owned diff and runs the final combined suite.
2. Keep Task11 runtime/config files under the runtime worker's ownership.
3. Run fresh GitNexus change detection before any commit.

##### Không làm

- No commit, stage, push, worktree, CLI, application properties, or test properties changes.

#### 9. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 21:45 Asia/Saigon` |
| Trạng thái worktree | `shared dirty checkout; existing worker changes preserved` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Codex Workflow Task12 monitor lane` |
---

### Source record: 2026-09-23-workflow-service-runtime-completion.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Preserved and reviewed the partial PostgreSQL/RabbitMQ `ExecutionRuntimeIntegrationTest`, which covers the concrete runner through admission, outbox publish, listener claim, node execution, retries, recovery, fencing, and shutdown.
- Added explicit worker/runtime configuration defaults with the worker disabled unless deliberately enabled; bounded shutdown waiting to the lease-safe window.
- Added focused regressions for mapping, configuration, and authentication failures consuming one attempt without retry.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | PASS | Workflow module compile and the combined Maven suite completed; Java 25 emitted non-failing forked-compiler `AccessDeniedException` diagnostics for cached JARs. |
| Unit / integration test | PASS | Focused runner/state tests `8/8`, real PostgreSQL/RabbitMQ runtime `8/8`, Task 10 recovery `7/7`, combined Workflow suite `277/277`. |
| Migration / database | PASS | Testcontainers PostgreSQL/RabbitMQ started successfully; the real runtime fixture exercised the existing Task 8 V3 schema and Task 10 adapter. |
| Review thay đổi | Đã kiểm tra một phần | GitNexus impacts are `UNKNOWN` for new symbols because index predates Tasks 10/11; source callers and wiring were manually corroborated. |
| Commit / PR | Chưa tạo | Per task scope; no stage/commit/push. |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Recover the partial Task 11 completion artifact without replacing the runner with a no-op or claiming pool-only coverage.
2. Preserve real DB/broker runtime acceptance for admission -> outbox -> listener -> runner -> terminal state, concurrent active paths, retries, recovery, fencing, and shutdown.
3. Hand off exact serialized verification requirements and the HTTP registry configuration handshake.

##### Trong phạm vi

- `ExecutionRunner`, worker/listener wiring, registry configuration, runtime properties, persistence state adapter review, aggregate runtime tests, and required Task 11 reports.
- The existing Task 10 lease/fencing/recovery contracts and the approved Workflow V1 spec/plan.

##### Ngoài phạm vi / chủ động chưa làm

- HTTP provider implementation and sanitizer, which remain Task 13 ownership.
- Task 12 HTTP/query changes, plan/progress ledgers, commit, stage, push, worktree, and external agent execution.

##### Tiêu chí hoàn thành

- [x] Focused runtime unit tests pass after HTTP source-ready handshake.
- [x] Real PostgreSQL/RabbitMQ integration test passes with the enabled worker and concrete runner.
- [x] Combined Workflow suite passes; actual test counts and limitations are recorded here and in the scratch report.
- [ ] Coordinator runs fresh GitNexus change detection before any commit.

#### 4. Bối cảnh và quyết định

- The partial worker already supplied `ExecutionRuntimeIntegrationTest.java` but no Surefire report. It is preserved as the acceptance fixture and not treated as completion evidence.
- The approved Task 11 contract requires attempts to be persisted before provider calls, active-path mappings only, concurrent independent nodes, joins that wait for all active predecessors, three total attempts with one-second/two-second delays, and fenced stale completion behavior.
- The integration fixture sets `weav.workflow.http.executor.enabled=false` so its deterministic `http.request` test adapter is the sole registry entry. Task 13 must use the same conditional property; otherwise Spring will register duplicate `http.request` adapters and fail closed during `NodeExecutorRegistry` construction.

#### 5. Thay đổi đã thực hiện

##### 5.1 Code and behavior

- `ExecutionRunner`: shutdown now waits against one deadline bounded by the smaller of thirty seconds and the configured lease duration, preserving lease expiry/recovery as the authority after in-flight work does not settle.
- `ExecutionJobListener`: refreshed the stale Task 10 comment; behavior remains UUID-only and concrete-runner gated.
- `ExecutionRuntimeIntegrationTest`: preserved the real runtime fixture, set a ten-second heartbeat interval to avoid a heartbeat racing the deliberate lease-expiry takeover assertion, and added an in-flight shutdown handoff test.
- `ExecutionRunnerTest`: added one-attempt/no-retry assertions for mapping, configuration, and confirmed authentication failures.
- `ExecutionRunnerConfiguration`: added the production concrete-runner bean wiring behind the existing application-runner port condition so the enabled worker has an actual runner at runtime.
- `ExecutionRecoveryTest`: marked the Task 10 test runner `@Primary` so its deliberate handoff double remains the selected bean when production wiring is present in the test context.

##### 5.2 Cấu hình

- `src/main/resources/application.properties`: added worker enable/owner/lease/heartbeat/redelivery/registry runtime, bounded executor/timer, and recovery defaults. The worker default is `false`; the redelivery delay is numeric milliseconds because `ExecutionWorkerRabbitConfiguration` consumes a `long`.
- `src/test/resources/application.properties`: explicitly disables the worker and HTTP executor and sets bounded test pools.

##### 5.3 Bàn giao tài liệu

- `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-11-completion-report.md`: recovery status, acceptance coverage, graph caveat, and serialized verification gate.

#### 6. Danh sách file ảnh hưởng

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

#### 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus binding | `mcp__gitnexus__list_repos`, then impacts for `ExecutionRunner`, `ExecutionJobListener`, `ExecutionStateAdapter`, `NodeExecutorRegistry` | `UNKNOWN` / target-not-found; index `4aad0ce` is three commits behind | New Task 10/11 symbols are absent from the index; source search/manual wiring used as corroboration. |
| Diff whitespace | `git diff --check` plus owned-file trailing-whitespace scan | PASS | Tracked diff check and untracked owned files; line-ending warnings only. |
| Maven focused suite | `mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.compiler.fork=true' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' -Dtest=ExecutionRunnerTest,ExecutionRuntimeTest test` with `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` | PASS: 8 tests, 0 failures, 0 errors, 0 skipped | Ran after HTTP source-ready coordination; no real containers required for this slice. |
| Real runtime suite | Same Maven wrapper/repository settings with `-Dtest=ExecutionRuntimeIntegrationTest`, elevated Docker host access, and UTC | PASS: 8 tests, 0 failures, 0 errors, 0 skipped; 46.864s | Real Testcontainers PostgreSQL 18.6 and RabbitMQ path; serialized Maven slot. |
| Task 10 recovery suite | Same Maven wrapper/repository settings with `-Dtest=ExecutionRecoveryTest`, elevated Docker host access, and UTC | PASS: 7 tests, 0 failures, 0 errors, 0 skipped; 39.734s | Confirms recovery/fencing handoff remains green with production runner wiring present. |
| Combined suite | Coordinator-owned full Workflow `test` after both lanes were stable | PASS: 277 tests, 0 failures, 0 errors, 0 skipped; BUILD SUCCESS; 03:12 | One serialized Maven process; includes runtime, recovery, HTTP, and existing service tests. |

#### 8. Rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý / chủ sở hữu |
| --- | --- | --- | --- |
| Trung bình | GitNexus impact is unresolved | New runtime symbols return target-not-found/`UNKNOWN` against stale index; a later method impact also hit the index storage-version mismatch | Coordinator refreshes/rebuilds the index and runs `detect_changes` before commit. |
| Thấp | Integration retry assertions use real wall clock | SQL checks require at least 700ms then 1700ms between attempt starts | Unit test uses fixed clock for exact `+1s/+3s` eligibility; integration remains real-container timing evidence. |
| Thấp | Java 25 forked compiler diagnostics | Maven reported cached Tomcat/JAXB JAR `AccessDeniedException` diagnostics while all requested goals completed successfully | Keep the configured Maven repository/junction and verify the next clean build if the toolchain is changed. |

#### 9. Trạng thái bàn giao

##### Đã hoàn tất trong session

1. Coordinated the HTTP source-ready state and conditional executor property before Maven.
2. Ran focused runner/state tests, the real PostgreSQL/RabbitMQ runtime suite, and Task 10 recovery suite in separate serialized Maven processes.
3. Ran the combined Workflow suite after both lanes were stable and recorded the actual counts above.

##### Coordinator next steps

1. Review the shared dirty diff and confirm ownership boundaries across Tasks 10–13.
2. Refresh GitNexus for the current checkout, rerun impact where needed, and run `detect_changes` before any commit.
3. Decide commit/push separately; this lane performed no stage, commit, push, worktree, or external-agent action.

##### Hướng dẫn cho AI agent tiếp theo

- Read the approved spec/plan, this log, the scratch report, Task 10 report, and `git status` before editing.
- Do not replace `ExecutionRunner` with a no-op or call pool-only tests runtime acceptance. The serialized evidence above is the actual completion evidence.
- Do not stage, commit, push, create a worktree, or run an external agent.

#### 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 Asia/Saigon` |
| Trạng thái worktree | Dirty shared worktree; Task 11/runtime and other workflow task changes are uncommitted |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 11 runtime recovery |
| Cần đọc trước khi tiếp tục | Approved Workflow spec/plan, Task 10 report, `scratchtask-11-completion-report.md`, and the coordinator's fresh GitNexus review |
