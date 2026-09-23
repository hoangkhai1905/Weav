# Nhật ký làm việc - Workflow Service Task 8

## 1. Metadata

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

## 2. Tóm tắt điều hành

### Kết quả chính

- Thêm manual và automatic execution admission. Adapter khóa workflow rồi registration, đọc trạng thái/version/root hiện tại từ PostgreSQL và ghi execution, một node row cho mỗi node cùng outbox event trong một transaction.
- Thêm publisher dùng claim lease ngắn, gửi bên ngoài DB transaction, yêu cầu mandatory routing và correlated positive confirm; chỉ đánh dấu event PUBLISHED sau routed ACK. Polling được bật bằng scheduling configuration.
- Thêm migration V3 theo hướng additive cho root, correlation, traceparent, schedule, edge/worker lease, node retry và outbox lease/retry. V1 trigger_id được kiểm tra là đã tồn tại.
- Bổ sung input freeze/size/depth guard, preserving JSON object/array/scalar/null cho automatic input; manual input chỉ nhận object.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | PASS | Full Workflow Maven module BUILD SUCCESS |
| Unit / integration test | PASS | 196/196; zero failures/errors/skips |
| Migration / database | PASS | Populated V2 → V3 trên PostgreSQL 18.6 Testcontainers; dữ liệu cũ còn nguyên |
| RabbitMQ | PASS | Testcontainers kiểm persistent routed delivery, confirm, return, outage và duplicate window |
| Review thay đổi | Đã kiểm tra | git diff --check exit 0; Git chỉ báo line ending cho application.properties |
| Commit / PR | Chưa tạo | Không stage, commit hoặc push |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Tạo execution admission đã xác thực quyền và pin version/root hiện tại.
2. Commit execution, node rows và UUID-only outbox intent nguyên tử; admission không phụ thuộc broker.
3. Gửi outbox an toàn qua RabbitMQ với routed confirms, lease recovery và retry tách khỏi node attempt count.
4. Thêm V3 mà không sửa/xóa dữ liệu V1/V2.

### Trong phạm vi

- Task 8 application port/use case/DTO/service, execution và outbox aggregate/port/entity/mapper/repository.
- Rabbit exchange/queue/DLQ, scheduled outbox publisher, application/test properties.
- Migration V3 và Task 8 regression tests.
- Chỉ ghi worklog dưới docs/work_logs/K/ và report dưới .superpowers/sdd/2026-09-21-workflow-service-v1/.

### Ngoài phạm vi

- Không thêm HTTP execution API/controller, execution worker/listener, node runner hay runtime transitions của Tasks 10–11.
- Không triển khai schedule scanner, webhook ingress hoặc trigger provisioning.
- Không sửa plan/progress ledger thuộc coordinator.
- Không áp dụng migration vào production/shared database; không stage/commit/push.

### Tiêu chí hoàn thành

- [x] Manual admission yêu cầu WORKFLOW_RUN, xác nhận workspace, PUBLISHED state, current version và exact manual root.
- [x] Automatic input giữ nguyên JSON shape; schedule firing slot được dedupe.
- [x] Execution, per-node rows và PENDING outbox được ghi cùng transaction; rollback không để lại partial admission.
- [x] Publisher gửi persistent UUID-only messages, mandatory route, routed positive confirm, fenced lease completion và retry.
- [x] V3 giữ lại dữ liệu V2 và không tạo lại trigger_id đã có trong V1.
- [x] Focused outbox tests và full Workflow module pass; log/report được cập nhật.

## 4. Bối cảnh và quyết định

- Nguồn sự thật là docs/superpowers/specs/workflow-service-spec.md và Task 8 trong docs/superpowers/plans/2026-09-21-workflow-service-v1.md. Task 9 GraphState/readiness/retry thuộc lane riêng; Task 8 chỉ thêm persistence fields cần cho delivery.
- Admission lock theo thứ tự workflow row rồi trigger registration row, sau đó kiểm tra lại PUBLISHED/current version/active registration từ database. Event body không được quyết định workflow, version hay root.
- Manual authorization chạy trước persistence; automatic admission lấy workflow và root từ registration hiện hành. Manual input phải là object; automatic input được freeze như JSON object/array/scalar/null, có giới hạn bytes và depth.
- Payload outbox chỉ có executionId. Correlation ID và traceparent được truyền qua AMQP properties/headers. Rabbit send không nằm trong admission transaction.
- Outbox claim/update dùng lease token fencing. Claim transaction kết thúc trước network publish; mark-published và schedule-retry chạy trong transaction riêng. Retry count thuộc publisher và không tăng node attempt count.
- V1 đã có trigger_id. V3 chỉ thêm cột trạng thái delivery mới và partial unique trigger/scheduled slot index; test upgrade seed dữ liệu V2 rồi xác nhận các row và payload cũ còn nguyên.
- Scheduling review phát hiện @Scheduled không được bật và scheduled method trả int. RabbitExecutionConfiguration bật @EnableScheduling; publisher dùng wrapper void theo @Scheduled, đồng thời giữ publishPending() cho kiểm tra trực tiếp. Test properties trì hoãn polling tự động để không race các test.
- GitNexus MCP impact cho publisher/config/test mới trả target-not-found và risk UNKNOWN; CLI fallback lỗi EPERM realpath C:/Users/nhoan. Đã search call sites và đọc source trực tiếp; UNKNOWN vẫn được ghi là chưa giải đáp bởi index, không coi là risk thấp.

## 5. Nhật ký session

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 2026-09-21 | Đọc AGENTS.md, spec, Task 8 plan, progress và Task 6/7/9 reports | Xác nhận ownership, admission contract, transaction boundaries và giới hạn Tasks 10–11 | Xong |
| 2026-09-21 | Kiểm tra GitNexus impact và source call sites trước khi sửa | New symbols target-not-found/UNKNOWN; source search cho thấy publisher được inject bởi test và kích hoạt bằng Spring scheduling | Xong |
| 2026-09-21 | Chạy focused admission/JSON/migration/persistence/outbox tests | Phát hiện test dùng accessor outbound cho AMQP message inbound; đổi sang receivedDeliveryMode, không đổi publisher persistence behavior | Xong |
| 2026-09-21 | Kiểm tra scheduling wiring | Phát hiện thiếu @EnableScheduling và scheduled method có return int; thêm config/wrapper void và test registration | Xong |
| 2026-09-21 | Chạy focused ExecutionOutboxTest sau wiring cuối | 6/6, zero failures/errors/skips | Xong |
| 2026-09-21 | Chạy full Workflow Service module sau mọi thay đổi | 196/196, zero failures/errors/skips, BUILD SUCCESS | Xong |
| 2026-09-21 | Chạy git diff --check và chuẩn bị handoff | Exit 0; chỉ có line-ending warnings; không stage/commit/push | Xong |

### Diễn giải kiểm tra

- Lần chạy đầu trong sandbox dừng ở compile khi đọc cached Tomcat JAR ngoài workspace. Cùng lệnh chạy lại với quyền đọc Maven cache hoàn tất; không có source compile failure.
- Lần focused đầu có 24/25 test pass. Rabbit delivery mode phía nhận được Spring AMQP ánh xạ vào receivedDeliveryMode; sửa assertion trong test rồi ExecutionOutboxTest pass 5/5, sau khi thêm scheduling registration test là 6/6.
- Full suite cuối chạy sau khi bật scheduling: 196 test, zero failures/errors/skips. Testcontainers dùng PostgreSQL 18.6 và RabbitMQ. Warning về returned unroutable message và unique-node rollback là do regression test chủ động kích hoạt; assertion tương ứng pass.

## 6. Thay đổi đã thực hiện

| Nhóm | File | Thay đổi |
| --- | --- | --- |
| Application | services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ExecutionAdmissionPort.java; application/service/ExecutionAdmissionService.java; application/usecase/TriggerExecutionUseCase.java; application/dto/ExecutionResultDto.java | Admission command/result, manual authorization, JSON input guards và use case wrapper |
| Domain | domain/model/aggregate/execution/WorkflowExecution.java; NodeExecution.java; domain/model/aggregate/workflow/OutboxEvent.java; domain/port/out/OutboxEventRepository.java | Trigger/root/context, arbitrary JSON input, node next-attempt time, publisher lease/retry state |
| Persistence | infrastructure/persistence/entity/WorkflowExecutionJpaEntity.java; NodeExecutionJpaEntity.java; OutboxEventJpaEntity.java; mapper/ExecutionPersistenceMapper.java; repository/WorkflowExecutionRepositoryAdapter.java; OutboxEventRepositoryAdapter.java | Object JSONB round-trip, locking/atomic admission, schedule dedupe, short SKIP LOCKED claims và fenced updates |
| Messaging/config | infrastructure/messaging/RabbitExecutionConfiguration.java; ExecutionOutboxPublisher.java; src/main/resources/application.properties | Durable exchange/queue/DLQ, scheduling activation, mandatory persistent send, confirms/returns, retry/backoff và bounds |
| Migration | src/main/resources/db/migration/V3__execution_delivery_state.sql | Additive delivery fields/indexes cho execution, node execution, outbox |
| Tests | src/test/java/com/weav/workflow/application/ExecutionAdmissionTest.java; infrastructure/messaging/ExecutionOutboxTest.java; infrastructure/persistence/ExecutionDeliveryMigrationTest.java; domain/definition/JsonValuesTest.java; src/test/resources/application.properties | Admission, broker failure/crash windows, migration preservation, arbitrary JSON và deterministic scheduler setup |

Shared files như application.properties và một số aggregate/entity có thay đổi từ các task khác trong cùng checkout; bảng trên chỉ mô tả phần Task 8.

## 7. Kiểm tra và bằng chứng

Maven chạy từ services/workflow-service. Maven home junction đã xác nhận trỏ tới C:/Users/nhoan/.m2; JAVA_TOOL_OPTIONS đặt -Duser.timezone=UTC.

| Phạm vi | Lệnh / thao tác | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| Outbox focused cuối | .\mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=ExecutionOutboxTest test | 6/6 PASS | PostgreSQL/RabbitMQ Testcontainers; test đăng ký scheduler và polling trực tiếp |
| Full Workflow module cuối | .\mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository test | 196/196 PASS; BUILD SUCCESS | Combined current checkout Tasks 1–9; PostgreSQL 18.6/RabbitMQ Testcontainers |
| Migration upgrade | ExecutionDeliveryMigrationTest trong full run | Populated V2 → V3 PASS; trigger_id vẫn một cột; execution/node/outbox/version data được giữ | Disposable PostgreSQL, không phải production copy |
| Rabbit delivery | ExecutionOutboxTest trong full run | Persistent routed delivery, positive confirm, return, broker down/recovery, crash-after-confirm duplicate window đều PASS | Không chạy consumer/worker xử lý execution |
| Static diff | git diff --check | Exit 0 | Git in line-ending notice cho application.properties |
| GitNexus | impact cho publisher/config/test | target not found, risk UNKNOWN; CLI fallback EPERM | Root cần chạy change detection trước khi commit; search/source review đã thực hiện cho lane này |

## 8. Sự cố, rủi ro và giới hạn

| Mức độ | Vấn đề | Bằng chứng / xử lý | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | Outbox delivery cần một consumer runtime | Task 8 chỉ gửi executionId vào durable queue; chưa có Task 10–11 worker/listener | Root giữ runtime acceptance cho các task sau |
| Thấp | Chưa chạy production-sized migration/performance test | V3 kiểm bằng populated Testcontainers schema, không dùng copy dữ liệu lớn; index tạo bình thường trong test migration | Review migration lock/rollout trước production nếu bảng lớn |
| Thấp | GitNexus không index được các symbol mới | impact trả UNKNOWN; đã kiểm tra rg và source thủ công | Coordinator refresh/analyze graph và chạy detect_changes trước commit |
| N/A | Không còn blocker test Task 8 | Final full suite 196/196 pass | Root review combined changes |

### Điều chưa được kiểm tra

- Không áp dụng V3 lên production/shared database hoặc đo thời gian tạo index với dữ liệu lớn.
- Không chạy Workflow/Workspace deployment qua Docker Compose.
- Không xác minh một execution được worker tiêu thụ và hoàn thành; worker/listener nằm ngoài Task 8.
- Không có Task 8 public HTTP controller; API wiring thuộc task sau.

## 9. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Root review Task 8 service/adapter transaction, migration, publisher confirm/return/lease logic và scheduler wiring.
2. Root review các aggregate/entity shared với Tasks 1–9 trong combined diff; progress/plan ledger vẫn do coordinator sở hữu.
3. Trước commit, chạy GitNexus detect_changes và independent diff/security review.

### Chưa làm

- Không stage, commit, push hoặc sửa progress.md/approved plan.
- Không triển khai execution consumer/runtime.

### Hướng dẫn cho AI agent tiếp theo

- Đọc file log này, scratchtask-8-report.md, spec/plan và git status trước khi sửa.
- Không coi GitNexus UNKNOWN là low risk hoặc bằng chứng không có caller.
- Chạy lại full Workflow module sau bất kỳ thay đổi nào vào chung execution/outbox/migration files.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | 2026-09-21 22:48 Asia/Saigon |
| Trạng thái worktree | Có thay đổi chưa commit từ Tasks 1–9; Task 8 không stage/commit |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex execution worker, Task 8 |
| Cần đọc trước khi tiếp tục | Task 8 report, approved spec/plan và progress ledger |
