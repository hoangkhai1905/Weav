# Nhật ký làm việc - Workflow Service V1 Task 6

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` (`T:\Weav`) |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex Task 6 worker |
| Người review / nhận bàn giao | Coordinator `/root` |
| Trạng thái cuối session | `Hoàn thành phần triển khai; chờ coordinator review` |
| Phạm vi session | Workflow publication bất biến, atomic trigger/version state và pause/resume |
| Liên kết liên quan | Workflow Service V1 spec, plan Task 6, Task 5 worklog |

## 2. Tóm tắt điều hành

### Kết quả chính

- Thêm luồng publish dùng snapshot draft đã validate, kiểm tra Workspace capability và connection attachment trước khi lấy row lock; nếu snapshot đổi trong lúc gọi Workspace thì trả `409 DRAFT_CHANGED`.
- Lưu version bất biến, cập nhật current version, trạng thái workflow, trigger registrations và Task 7 connection-reference projection trong cùng transaction. Publish khi workflow đang `PAUSED` tiếp tục giữ trạng thái paused.
- Thêm pause/resume có capability riêng, từ chối draft chưa publish và cho phép gọi lặp idempotent; schedule, webhook và Telegram tiếp tục fail-closed cho tới khi readiness/provisioning tương ứng được triển khai.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Compile/build | `PASS` | Workflow Maven module compile trong focused và full test |
| Unit / integration test | `PASS` | Task 6 selectors 17/17; full Workflow module 184/184 |
| Migration / database | `PASS` | PostgreSQL 18.6 Testcontainers; Flyway V1/V2 chạy trong suite; Task 6 không thêm migration |
| Health check | `Chưa kiểm tra` | Không triển khai môi trường Compose/live service trong Task 6 |
| Review thay đổi | `Đã kiểm tra` | Task 6 source/tests và `git diff --check`; coordinator review vẫn chờ |
| Commit / PR | `Chưa tạo` | Không stage, commit hoặc push theo phạm vi được giao |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Publish version bất biến từ đúng snapshot đã validate và authorized.
2. Ghi version, current pointer, trigger state và connection references atomically.
3. Quản lý pause/resume và chứng minh state/version behavior bằng HTTP, unit và PostgreSQL concurrency tests.

### Trong phạm vi

- `WorkflowPublicationService`, version/trigger ports và persistence adapters.
- Aggregate/entity/mapper/controller/response cần cho publication và workflow state.
- Unit, signed-JWT HTTP, PostgreSQL publication/concurrency regressions.
- Worklog dưới `docs/work_logs/K/` và report Task 6.

### Ngoài phạm vi / chủ động chưa làm

- Không cài scheduler, webhook secret provisioning hoặc Telegram integration. Các luồng này bị từ chối công khai an toàn cho tới Task 16/17 hoặc integration tương ứng.
- Không sửa `ConnectionReferencePort`, Task 7 adapter/migration/controller hay các file Task 7 khác; publication chỉ gọi `appendVersion(...)` qua port do graph worker sở hữu.
- Không sửa plan/progress ledger, không triển khai execution engine và không thay đổi Compose/live-service wiring.

### Tiêu chí hoàn thành

- [x] Validate và authorize frozen snapshot trước lock; reject conflict nếu draft đổi.
- [x] Persist version/current pointer/trigger/reference projection trong transaction; rollback và concurrency có PostgreSQL coverage.
- [x] Giữ `PAUSED` khi republish; pause/resume có state validation và idempotence.
- [x] Chặn readiness/provisioning chưa tồn tại bằng lỗi dependency an toàn.
- [x] Focused selectors, full Workflow suite, diff check và handoff report.

## 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** Task 5 đã thêm draft API và row-lock save. Task 7 đang thêm version-aware connection-reference projection; publication cần gọi projection cùng transaction, không tạo no-op adapter.
- **GitNexus:** Index cũ hơn checkout vài docs-only commits. Impact cho `Workflow`, `WorkflowVersion`, `WorkflowTrigger` báo LOW; các symbol mới hoặc method chưa được index trả UNKNOWN/không tìm thấy, nên đã corroborate bằng source search và call-site inspection. UNKNOWN không được xem là all-clear.
- **Capability:** `WORKFLOW_PUBLISH` được kiểm tra trước workflow lookup; pause/resume dùng `WORKFLOW_MANAGE_STATE`. Actor lấy từ verified JWT principal tại controller.
- **Snapshot ordering:** Đọc và freeze draft, validate, kiểm tra connection authorization với Workspace, rồi mới lấy workflow row lock. So sánh `schemaVersion` và `draftDefinition` sau refresh/lock; mismatch trả `DRAFT_CHANGED` trước khi cấp số version hoặc ghi dữ liệu.
- **Readiness gates:** Mọi `trigger.schedule`, `trigger.webhook` và `trigger.telegram` publish đều fail closed với `503 DEPENDENCY_UNAVAILABLE` đến khi provider tương ứng có readiness/provisioning contract. Không tạo trigger ready giả hoặc trả credential chưa provision.
- **Reference consistency:** Version được flush trước khi gọi `appendVersion(workflowId, versionId, connections)` vì adapter Task 7 kiểm tra FK bằng JDBC; hai thao tác vẫn dùng chung transaction/datasource. Draft có connection nhưng thiếu production reference adapter thì fail closed.

## 5. Nhật ký theo session

### Session 1 - 2026-09-21

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 2026-09-21 | Đối chiếu Task 6 spec/plan, source Workspace/JWT và ownership Task 7 | Giữ nguyên contract/capability hiện có; không bịa provider readiness | Xong |
| 2026-09-21 | Thêm publication/state service, version/trigger ports và adapters | Publish frozen version và state transition qua transaction | Xong |
| 2026-09-21 | Thêm unit, HTTP ký JWT và PostgreSQL concurrency/rollback tests | Bao phủ authorization, version order, snapshot conflict, pause/resume, queued version pinning | Xong |
| 2026-09-21 | Sửa HTTP assertion quá rộng về từ `config` | Test yêu cầu exact sanitized message + empty details và không lộ draft identifiers; production behavior không đổi | Xong |
| 2026-09-21 | Focused publication tests | 17/17 pass: 11 unit, 3 persistence/concurrency, 3 signed-JWT HTTP | Xong |
| 2026-09-21 | Làm rollback regression không còn vacuous | Seed prior ACTIVE webhook, verify nó DISABLED sau trigger replacement rồi ACTIVE lại sau rollback; focused PostgreSQL selector 1/1 | Xong |
| 2026-09-21 | Full Workflow module suite sau Task 7 harness correction và rollback regression | 184/184 pass, zero failures/errors/skips; PostgreSQL 18.6/RabbitMQ Testcontainers | Xong |
| 2026-09-21 | `git diff --check` | Exit 0; chỉ có line-ending warnings ở application properties ngoài Task 6 | Xong |

### Diễn giải quan trọng

- Lần chạy trước khi sửa test HTTP đã fail tại assertion `response.contains("config")`: response chứa generic, cố định `Workflow trigger configuration is not available`, không phải dữ liệu cấu hình. Đã đổi sang kiểm tra chính xác public message, `details=[]` và không trả tên/draft identifiers. Focused signed-JWT test sau sửa pass.
- Một lần full-suite giữa chừng có 17 errors vì `WorkflowSecurityTest` đăng ký test-only `GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage` trùng route production do Task 7 thêm. Graph worker đã bỏ duplicate test-only mapping; focused security verification và full Workflow suite cuối cùng đều pass. Không thay đổi production Task 4 security code.
- TDD/verification evidence không xem assertion test sai hoặc lỗi harness là lỗi production; các lỗi harness được cô lập, sửa đúng file và xác minh lại trước full-suite pass.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Validate/authorize bên ngoài row lock rồi so sánh snapshot bên trong lock | Tránh giữ workflow lock trong Workspace round trip, không publish draft mới chưa được authorize/validate | Validate lại phiên bản mới sau lock sẽ thay đổi đối tượng đã được Workspace cho phép | Snapshot đổi thì trả 409; caller cần fetch/save rồi publish lại |
| Version, pointer, trigger replacement và reference projection cùng transaction | Rollback test chứng minh version/pointer/triggers không sót nếu lỗi giữa chuỗi write; Task 7 adapter cùng datasource | Ghi references ở transaction riêng hoặc no-op adapter | Projection thiếu với connection-bearing publish thì 503; version insert flush trước FK projection |
| Giữ status PAUSED khi publish version mới | Người dùng không kỳ vọng republish tự bật workflow/trigger | Luôn đặt PUBLISHED sau publish | Trigger mới khi paused được lưu DISABLED; resume mới có thể bật trigger đủ điều kiện |
| Giữ gates đóng cho schedule/webhook/Telegram | Readiness implementation thuộc Task 16/17 hoặc provider task; chưa có endpoint/secret thật | Tạo trigger ACTIVE theo hình thức hoặc sinh secret placeholder | Không có đường execution giả; route publish phản hồi 503 rõ ràng |
| `WebhookProvisioning.toString()` redact credential fields | Ngăn secret lộ qua debug/log/string rendering nếu DTO được mở rộng sau này | Dựa hoàn toàn vào serializer không gọi `toString()` | DTO hiện không phát sinh provisioning; review serialization khi Task 17 thêm secret thật |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `WorkflowPublicationService` kiểm tra capability, đọc draft, parse/validate publish, authorizes từng connection ID literal, fail-closed khi thiếu reference projection, lấy lock và so sánh snapshot, cấp version, cập nhật workflow, thay trigger registrations và append version references.
- `WorkflowVersionAdapter` cấp số theo workflow, insert/flush version immutable và load version; `WorkflowTriggerAdapter` thay registration hiện hành, tìm trigger và enable/disable trigger version hiện tại.
- `Workflow.publishVersion(UUID, Instant)` chuyển version pointer/timestamp nhưng giữ PAUSED; aggregate từ chối pause/resume khi không có published version, lặp pause/resume không đổi state.
- Version snapshot entity dùng field không cập nhật qua ORM; mapper giữ IDs/timestamps và khôi phục trigger/version aggregates.
- `WorkflowController` thêm `POST /workspaces/{workspaceId}/workflows/{workflowId}/publish`, `/pause`, `/resume`; actor lấy từ JWT principal. `DRAFT_CHANGED` trả 409, provider/reference unavailable trả 503, validation trả error details đã sanitize.
- `WorkflowResponse.Publication` biểu diễn publication; `WebhookProvisioning.toString()` không hiển thị endpoint key/secret.
- Unit coverage kiểm tra capability, authorization order, snapshot conflict, closed gates, immutable definition và sanitized validation.
- PostgreSQL concurrency coverage kiểm tra hai publisher cấp version 1/2, draft save/publish race, injected rollback và execution version pinning qua lần edit/republish.
- Rollback regression tạo version/trigger state trước đó, chứng minh trigger cũ thực sự bị disable bên trong transaction trước khi injector throw, sau rollback version pointer/count giữ nguyên và trigger trở lại ACTIVE.
- HTTP coverage dùng JWT HS256 ký trong test để kiểm tra publish/pause/resume, quyền capability, JWT actor và auto-trigger 503; không dùng live Identity service.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** PostgreSQL `workflow`.
- **Migration:** Task 6 không thêm migration. Dùng bảng workflow/version/trigger hiện có; Task 7 V2 thêm reference projection được gọi qua port trong publication transaction.
- **Tương thích:** Không thay schema/API của Workspace. Version snapshots được giữ bất biến; executions đã queue vẫn trỏ version UUID cũ.

### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm production config hoặc dependency.
- PostgreSQL, RabbitMQ Testcontainers dùng bởi integration tests; không sửa hạ tầng runtime.
- Provider schedule/webhook/Telegram vẫn đóng; không tạo secret hoặc readiness state giả.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Ba POST route publish/pause/resume dưới workspace-scoped workflow resource.
- **Security:** JWT actor được xác thực bởi Task 4; publication cần capability `WORKFLOW_PUBLISH`, state changes cần `WORKFLOW_MANAGE_STATE`. Workspace authorize connection attachment trước lock.
- **Validation/error response:** Draft không hợp lệ trả 400 `VALIDATION_ERROR`; snapshot đổi trả 409 `DRAFT_CHANGED`; trigger/reference dependency unavailable trả 503 `DEPENDENCY_UNAVAILABLE` với message an toàn và details rỗng.
- **Logging/metrics:** Không thêm log hoặc metric mới; không log connection credential/config. Error envelope giữ request path/correlation theo hạ tầng hiện có.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowPublicationService.java` | Publish, pause/resume, readiness gates | Dùng Task 4 Workspace ports và Task 7 reference port |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkflowVersionPort.java`, `WorkflowTriggerPort.java` | Application persistence contracts | Không phụ thuộc JPA |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/service/DraftChangedException.java`, `TriggerDependencyUnavailableException.java` | 409 conflict và sanitized provider unavailable | Không chứa draft/config secret |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/repository/WorkflowVersionAdapter.java`, `WorkflowTriggerAdapter.java` | Version insert/flush/query và trigger replacement/state | Ghi chung publication transaction |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/workflow/Workflow.java`, `WorkflowVersion.java`, `WorkflowTrigger.java` | Publication and immutable version/trigger behavior | Một số file cũng chứa Task 1/5 thay đổi đã có |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/entity/WorkflowVersionJpaEntity.java`, `WorkflowTriggerJpaEntity.java`, `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/mapper/WorkflowPersistenceMapper.java` | Explicit restore/mapping và immutable snapshot fields | Mapper cũng được Task 5 sửa trước đó |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/WorkflowController.java`, `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/response/WorkflowResponse.java` | Publish/state endpoints và response mapping | Controller/response dùng chung với Task 5 |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/application/WorkflowPublicationTest.java` | Publication authorization/state unit regressions | 11 tests |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/WorkflowPublicationTestConfiguration.java` | Test-only gates/rollback injection | Không phải production implementation |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/persistence/WorkflowPublicationConcurrencyTest.java` | Real PostgreSQL concurrency, rollback, pinning tests | 3 tests |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowPublicationHttpTest.java` | Signed-JWT publication/state HTTP tests | 3 tests |
| `Thêm` | `docs/work_logs/K/2026-09-21-workflow-service-task-6.md`, `.superpowers/sdd/2026-09-21-workflow-service-v1/task-6-report.md` | Task 6 handoff documentation | Root owns plan/ledger; no changes there |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Focused Task 6 | `mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WorkflowPublicationTest,WorkflowPublicationConcurrencyTest,WorkflowPublicationHttpTest test` với `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` | PASS: 17 tests, zero failures/errors/skips; BUILD SUCCESS | Unit, PostgreSQL/RabbitMQ Testcontainers và signed-JWT MockMvc |
| Focused rollback regression | `-Dtest=WorkflowPublicationConcurrencyTest#failureAfterVersionAndTriggerWritesRollsBackTheWholePublication` với UTC timezone | PASS: 1/1 | Verifies trigger row is DISABLED before injected failure and restored ACTIVE after rollback |
| Full Workflow module | `mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository test` với UTC timezone | PASS: 184 tests, zero failures/errors/skips; BUILD SUCCESS | Reran after final Task 6 test edit; includes Tasks 5/6/7, PostgreSQL 18.6/RabbitMQ Testcontainers |
| Workspace boundary selectors | `WorkflowContractValidationTest,ConnectionUsageProtectionTest` | PASS: 20/20 theo Graph worker | HTTP contract fixtures; không phải live Compose deployment |
| Database integration | Task 6 full suite | PASS: Flyway V1/V2, publication transaction/concurrency/rollback, queued version pinning | Testcontainers; production database không bị thay đổi |
| Static/diff | `git diff --check` | PASS, exit 0 | Git cảnh báo line ending LF→CRLF trong `application.properties` files ngoài Task 6 |

### Điều chưa được kiểm tra

- Chưa chạy end-to-end qua Workspace/Workflow services trong Compose; Workspace boundary được kiểm bằng contract HTTP fixtures và Workflow integration bằng Testcontainers.
- Chưa có evidence production readiness của scheduler/webhook/Telegram; publish cho các trigger đó chủ đích fail closed tới Tasks 16/17/provider work.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Thấp | HTTP test tìm substring `config` trong toàn body | Generic sanitized message có từ “configuration” | Assert exact message, empty details, không lộ draft identifiers; focused test pass | Đã xử lý |
| Thấp | Full suite trước đó có 17 test-context errors | Test-only route trùng production route sau Task 7 controller được đăng ký | Graph worker bỏ test-only route; focused security và full 184/184 pass | Đã xử lý trong graph lane |
| Trung bình | Scheduler/webhook/Telegram chưa provision | Các task/provider tương ứng chưa triển khai | Publish fail-closed 503; không đánh dấu trigger ACTIVE | Task 16/17 và provider owner |
| Trung bình | GitNexus index không hoàn toàn hiện hành | Index cũ hơn checkout; một số target UNKNOWN | Dùng targeted source/call-site review; không xem UNKNOWN là all-clear | Coordinator trước commit |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator review Task 6 diff/log/report cùng Task 7 reference adapter contract.
2. Task 16/17 có thể thay closed readiness gates bằng provider thật sau khi có contract và integration tests; giữ transaction/locking contract hiện tại.
3. Trước bất kỳ commit nào, chạy GitNexus detect-changes theo quy trình root; Task 6 worker không stage/commit/push.

### Cần quyết định / quyền truy cập từ người khác

- Không có blocker kỹ thuật đang chờ. Coordinator review/acceptance vẫn pending.
- Live Workspace + Compose integration vẫn là work còn lại ở service/runtime gate, không được xem là đã hoàn tất chỉ vì fixture/Testcontainers suite xanh.

### Hướng dẫn cho AI agent tiếp theo

- Đọc file này, Task 6 report, Workflow Service spec/plan và Task 7 log trước khi đổi publication/trigger code.
- Giữ fail-closed provider gate cho đến khi provider readiness/secret provisioning được implement và test.
- Bảo đảm `WorkflowVersion` insert/flush và `ConnectionReferencePort.appendVersion` còn chung transaction; không tạo production no-op reference adapter.
- Không log, serialize hoặc đưa credential/secret vào errors.

## 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Task 6
- `docs/work_logs/K/2026-09-21-workflow-service-task-5.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21` (`Asia/Saigon`) |
| Trạng thái worktree | Có thay đổi chưa commit; gồm nhiều Task 1–7/9 worker changes, được giữ nguyên |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 6 worker |
| Cần đọc trước khi tiếp tục | Mục 6 quyết định kỹ thuật; Task 6 report; Task 7 reference adapter contract |

---

## Checklist trước khi đóng log

- [x] Tóm tắt phân biệt Task 6 complete với runtime gates còn lại.
- [x] Nêu quyết định, file, tests và lệnh tái lập.
- [x] Ghi GitNexus UNKNOWN/staleness, provider gates và chưa có live Compose verification.
- [x] Không stage/commit/push; không ghi secret hoặc connection string chứa credential.
