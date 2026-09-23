# Nhật ký làm việc - Workflow Service Task 7

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-09-21 |
| Múi giờ ghi log | Asia/Saigon |
| Dự án / repository | Weav / T:\Weav |
| Nhánh / commit đầu ngày | feature/workflow-service / c836de2 |
| Người thực hiện | Codex graph worker, Task 7 |
| Người review / nhận bàn giao | Coordinator /root |
| Trạng thái cuối session | Task 7 hoàn thành; combined tests sau cập nhật regression Task 6 đã xanh; chờ coordinator review |
| Phạm vi session | Theo dõi connection usage, migration và bảo vệ lệnh xóa ở Workspace |
| Liên kết liên quan | Workflow Service V1 spec và plan Task 7 |

## 2. Tóm tắt điều hành

### Kết quả chính

- Thay port tham chiếu trong bộ nhớ bằng projection PostgreSQL dùng chung transaction với draft save và immutable publication.
- Triển khai endpoint nội bộ connection-usage: nó trả false khi không có tham chiếu kể cả cặp ID chưa từng xuất hiện, và không gọi Workspace.
- Mở rộng Workspace test để xác nhận caller thật cho phép xóa khi Workflow trả 200 false và từ chối xóa khi downstream lỗi.
- Migration V2 backfill đúng nodes[*].config.connectionId; config thiếu/hỏng được bỏ qua an toàn, references của immutable version vẫn được giữ khi workflow bị soft-delete.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | PASS | Final full Workflow Maven module BUILD SUCCESS sau Task 6 rollback regression update |
| Unit / integration test | PASS | Final Workflow 184/184; Workspace boundary 20/20 |
| Migration / database | PASS | V1→V2 từ schema V1 có dữ liệu; PostgreSQL 18.6/Testcontainers |
| Review thay đổi | Đã kiểm tra | git diff --check được chạy sau khi tạo log/report |
| Commit / PR | Chưa tạo | Không stage/commit/push theo ownership của coordinator |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Thêm persistent tracking cho draft và published-version connection references.
2. Phục vụ contract Workspace usage bằng dữ liệu Workflow local, scoped theo workspace.
3. Xác minh publication/draft transaction, migration từ V1 và caller fail-closed của Workspace.

### Trong phạm vi

- ConnectionReferencePort, PostgreSQL adapter, Flyway V2.
- Usage service, bounded fixed-window limiter, internal controller, 429 mapping, OpenAPI và README.
- Task 7 integration/unit tests và các Workspace contract/deletion regressions.
- Điều chỉnh test harness security để loại duplicate fake route sau khi controller production được thêm.

### Ngoài phạm vi

- Không triển khai workflow execution engine/admission/persistence Tasks 8 trở đi.
- Không gọi Workspace database trực tiếp; không thêm foreign keys sang service khác.
- Không chạy Compose hoặc kết nối Workspace/Workflow service production.
- Không cập nhật plan/ledger, không staging, commit hoặc push.

### Tiêu chí hoàn thành

- [x] Draft projection thay thế nguyên tử; version projection append-only và cùng transaction với publish.
- [x] Usage lookup đúng workspace; mọi version được tính, draft đã xóa không được tính.
- [x] 200 false cho ID chưa biết; usage lookup không gọi Workspace.
- [x] 401, 429, 500 dùng envelope an toàn; migration chịu được JSON draft/version thiếu hoặc chưa hoàn chỉnh.
- [x] Workspace caller tiếp tục xóa khi Workflow trả 200 false và fail closed trên lỗi downstream.
- [x] Focused/full tests, diff check và handoff artifacts hoàn tất.

## 4. Bối cảnh và quyết định

- **Nguồn sự thật:** docs/superpowers/specs/workflow-service-spec.md, Task 7 trong docs/superpowers/plans/2026-09-21-workflow-service-v1.md, cùng progress ledger hiện hành.
- **Phạm vi trả lời:** Workflow chỉ trả lời liệu tham chiếu có trong workspace đã hỏi hay không. Workspace sở hữu xác minh connection tồn tại và thuộc workspace.
- **Quy tắc soft-delete:** giữ reference của mọi workflow_version đã lưu, bao gồm version thuộc workflow soft-deleted; loại chỉ draft reference của workflow soft-deleted.
- **Tính bất biến:** sửa draft chỉ thay projection draft; không xóa tham chiếu version cũ.
- **Transaction:** replaceDraft và appendVersion đi qua JdbcTemplate trên datasource dùng chung; publication flush version row trước khi adapter thêm references. Rollback của caller hoàn tác cả snapshot/version và projection.
- **Migration:** đọc riêng nodes[*].config.connectionId; chỉ cast khi chuỗi khớp UUID canonical có dấu gạch nối. Không quét description, variables hoặc field khác.
- **Không gọi service ngoài:** UsageService chỉ phụ thuộc limiter và ConnectionReferencePort; Workspace thực hiện kiểm tra existence/ownership của nó.
- **Rate limit:** một fixed window process-wide, constant memory, mặc định 600 request mỗi 1 phút; có thể cấu hình qua workflow.connection-usage.requests-per-window và workflow.connection-usage.window.
- **Test harness:** WorkflowSecurityTest có fake GET trùng route với production controller mới. Bỏ riêng fake để auth tests đi qua controller thật; không sửa security production code.
- **GitNexus:** index còn stale và impact cho test symbol trả target-not-found/risk UNKNOWN. Đã đối chiếu trực tiếp source và Surefire report trước thay đổi test harness; không coi UNKNOWN là all-clear.

## 5. Nhật ký session

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 2026-09-21 | Đọc spec, Task 7 plan, progress ledger, Task 2 report và worktree status | Xác nhận semantics version/draft, ownership và Maven serialization | Xong |
| 2026-09-21 | Chạy mixed focused Workflow selectors | 31/31; zero failures/errors/skips | Xong |
| 2026-09-21 | Chạy full Workflow trước khi sửa test fake | 184 chạy; 0 failures, 17 errors do duy nhất Spring ambiguous mapping | Xong |
| 2026-09-21 | Kiểm tra GitNexus impact và source/Surefire cho WorkflowSecurityTest | GitNexus target-not-found/UNKNOWN; report chỉ đúng hai handler cùng GET route | Xong |
| 2026-09-21 | Xóa test-only mapping trùng và chạy WorkflowSecurityTest riêng | 17/17, Testcontainers context lên thành công | Xong |
| 2026-09-21 | Chạy Workspace usage contract/deletion selectors | 20/20; actual client dùng HTTP fixture; fail-closed test chặn delete | Xong |
| 2026-09-21 | Rerun toàn Workflow module | 184/184, zero failures/errors/skips; BUILD SUCCESS | Xong |
| 2026-09-21 | Security worker bổ sung trigger-row rollback assertion không còn vacuous; chạy lại full suite | 184/184, zero failures/errors/skips; xác nhận qua Surefire XML timestamps mới nhất | Xong |
| 2026-09-21 | Kiểm diff/whitespace và ghi handoff | Không staging/commit/push | Xong |

### Diễn giải quan trọng

- Full suite ban đầu không phát hiện lỗi production usage logic; test context không thể khởi tạo vì TestSecurityController và InternalConnectionUsageController cùng khai báo một GET mapping. Sau khi bỏ fake route, 17 security tests chạy và full suite 184 tests đều xanh. Test security cho key-alone nay đánh vào endpoint thật, trả false cho cặp ID chưa thấy.
- Lần Workspace build đầu không có quyền đọc ổn định JAR trong shared Maven cache và dừng ở compile trước test. Chạy lại với elevated exec cùng local repository hoàn tất compile và 20 tests đều xanh; không có source compile failure.
- Workspace boundary test dùng chính WorkflowConnectionUsageClient và DeleteConnectionUseCase trên HTTP fixture trong test process. Nó kiểm tra consumer, header/path/response và fail-closed delete; không phải live Workflow↔Workspace deployment E2E.
- Task 6 publication worker báo focused suite 17/17 trước lượt full run. Lượt full Workflow của session này độc lập chạy lại toàn bộ publication tests trong suite 184/184.

## 6. Thay đổi đã thực hiện

| Nhóm | File | Thay đổi |
| --- | --- | --- |
| Port / persistence | services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ConnectionReferencePort.java | Thêm replaceDraft, appendVersion và workspace-scoped inUse |
| Persistence | services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/repository/ConnectionReferenceAdapter.java | Projection PostgreSQL, partial-conflict-safe inserts và usage query |
| Migration | services/workflow-service/src/main/resources/db/migration/V2__connection_reference_tracking.sql | Bảng/local FKs/indexes và safe backfill draft/version từ V1 |
| Service / limiter | services/workflow-service/src/main/java/com/weav/workflow/application/service/ConnectionUsageService.java; ConnectionUsageRateLimiter.java | Query bounded, không gọi Workspace |
| HTTP / errors | services/workflow-service/src/main/java/com/weav/workflow/presentation/http/InternalConnectionUsageController.java; services/workflow-service/src/main/java/com/weav/workflow/domain/exception/RateLimitExceededException.java; services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/GlobalExceptionHandler.java | GET internal route, 429 error mapping; không trả DB detail |
| Contracts | packages/contracts/http/workflow/openapi.yaml; packages/contracts/http/workflow/README.md | 200 false semantics, soft-delete/version, auth, rate limit và sanitized errors |
| Workflow tests | services/workflow-service/src/test/java/com/weav/workflow/application/service/ConnectionUsageRateLimiterTest.java; ConnectionUsageServiceTest.java; services/workflow-service/src/test/java/com/weav/workflow/infrastructure/persistence/ConnectionReferenceMigrationTest.java; services/workflow-service/src/test/java/com/weav/workflow/presentation/http/ConnectionUsageControllerHttpTest.java; ConnectionUsageHttpTest.java | Bounds, auth/status, migration backfill, transaction and actual publication behavior |
| Test wiring | services/workflow-service/src/test/java/com/weav/workflow/WorkflowDraftTestConfiguration.java; services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowSecurityTest.java | Dùng adapter thật trong tests; bỏ test-only duplicate GET mapping |
| Workspace regressions | services/workspace-service/src/test/java/com/weav/workspace/WorkflowContractValidationTest.java; services/workspace-service/src/test/java/com/weav/workspace/application/usecase/ConnectionUsageProtectionTest.java | Require usage 200 contract and exercise actual client/delete use case over isolated HTTP fixture |

## 7. Kiểm tra và bằng chứng

Các lệnh dưới đây chạy từ thư mục service tương ứng, với MAVEN_USER_HOME trỏ tới junction được xác minh là C:\Users\nhoan\.m2 và JAVA_TOOL_OPTIONS=-Duser.timezone=UTC.

| Phạm vi | Lệnh chọn test | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| Workflow focused | services/workflow-service/mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=ConnectionUsage*,ConnectionReferenceMigrationTest,WorkflowPublication* test | 31/31, PASS | Gồm test Task 6 publication và Task 7 usage/migration |
| Security test context regression | services/workflow-service/mvnw.cmd ... -Dtest=WorkflowSecurityTest test | 17/17, PASS | MockMvc + Testcontainers; controller usage thật |
| Workflow full module | services/workflow-service/mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository test | 184/184, PASS | PostgreSQL 18.6 và RabbitMQ Testcontainers |
| Workspace consumer/deletion contract | services/workspace-service/mvnw.cmd -e -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WorkflowContractValidationTest,ConnectionUsageProtectionTest test | 20/20, PASS | Client thật với HTTP fixture cục bộ; không boot Workspace service thật |
| Migration | ConnectionReferenceMigrationTest trong Workflow focused/full run | V1 populated→V2 PASS | Bao gồm valid/malformed/missing configs, duplicate, deleted draft và version của deleted workflow |
| Static/diff | git diff --check | PASS | Không staging hoặc tạo commit |

Test usage HTTP dùng PostgreSQL thật trong Testcontainers để kiểm active draft, workspace exclusion, draft soft-delete, draft rollback, real WorkflowPublicationService transaction và reference lưu qua draft edit/workflow soft-delete. Test cũng xác nhận cặp ID chưa thấy trả 200 false và lookup không phát sinh HTTP request sang Workspace.

### Điều chưa được kiểm tra

- Không chạy service thật qua Docker Compose hoặc gọi một deployment Workspace↔Workflow; cross-service behavior được kiểm trên actual Workspace client và HTTP contract fixture cô lập.
- Không áp dụng migration lên production/shared database; V1→V2 chỉ chạy trong disposable Testcontainers.
- Không triển khai hoặc xác minh Workflow execution runtime; Task 7 chỉ quản lý reference usage.

## 8. Sự cố, rủi ro và next step

| Mức độ | Vấn đề | Bằng chứng / xử lý | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- |
| Thấp | GitNexus không resolve một số Task 7/test symbols do index stale | Impact trả target-not-found/UNKNOWN; xác minh bằng source, route search và test runtime | Root review; chạy change detection trước commit |
| Thấp | Workspace tests không phải live service-to-service E2E | Actual client/use case chạy qua local HTTP fixture; Workflow controller có integration test riêng trong cùng module | Coordinator nối real stack trong milestone integration nếu cần |
| N/A | Không còn test blocker Task 7 | Focused, Workspace boundary, security regression và full Workflow đều PASS | Coordinator review và quyết định milestone |

## 9. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Root review migration, adapter transaction boundary và 200-false ownership contract.
2. Root kiểm tra combined diff với Task 5/6, sau đó cập nhật progress ledger/plan theo quyền sở hữu coordinator.
3. Trước bất kỳ commit nào, thực hiện GitNexus change detection và independent diff/security review.

### Chưa làm

- Không làm Task 8 trở đi trong lane này; Task 7 không phải execution engine.
- Không stage/commit/push; root giữ acceptance và milestone gate.

## 10. Tham chiếu

- docs/superpowers/specs/workflow-service-spec.md
- docs/superpowers/plans/2026-09-21-workflow-service-v1.md
- .superpowers/sdd/2026-09-21-workflow-service-v1/progress.md
- docs/work_logs/log_template.md

## 11. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm cập nhật | 2026-09-21 19:28 Asia/Saigon |
| Trạng thái worktree | Có nhiều thay đổi chưa commit từ các lane Tasks 1–7/9; giữ nguyên thay đổi ngoài ownership |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 7 graph worker |
| Cần đọc trước khi tiếp tục | Task 7 report và coordinator ledger |
