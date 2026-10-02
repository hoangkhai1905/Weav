# Workflow Service V1 detailed record — authoring and connections

> Historical task notes recovered from commit 18b6dfa. The source records below retain their original decisions, file inventories, test commands, and handoff details. Their test counts are milestone snapshots; the final integrated release evidence is in workflow-service-v1.md.

Source notes are grouped here to keep the K folder navigable while retaining implementation detail.

---

### Source record: 2026-09-21-workflow-service-task-5.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` (`T:\Weav`) |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex Task 5 worker |
| Người review / nhận bàn giao | Coordinator `/root` |
| Trạng thái cuối session | `Hoàn thành phần triển khai; chờ review` |
| Phạm vi session | Workspace-scoped workflow draft create/save/get/list, persistence và boundary regressions |
| Liên kết liên quan | Workflow Service V1 spec, plan Task 5 và Task 4 report |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Triển khai `POST`, `GET`, `PUT draft` dưới `/workspaces/{workspaceId}/workflows`; actor lấy từ JWT principal và các thao tác kiểm tra capability với Workspace.
- Bổ sung truy vấn JPA có workspace scope, lọc soft-delete, phân trang có giới hạn và thứ tự ổn định; draft save thay toàn bộ snapshot trong transaction có khóa hàng.
- Bảo toàn ID, timestamp khởi tạo, JSONB null lồng nhau và editor state tách biệt. Draft tạo mới được seed schema `1.0`, một manual trigger, không có edge và variables rỗng.
- Giới hạn request thô ở 1 MiB, bao gồm trường hợp không có Content-Length; nội dung vượt giới hạn trả lỗi 413 đã chuẩn hóa.
- Thêm hook `ConnectionReferencePort` để Task 7 có thể cập nhật projection trong cùng transaction. Khi adapter sản xuất chưa được cài, thao tác thêm hoặc gỡ connection reference bị từ chối fail-closed bằng 503.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Compile/build | `PASS` | Compile qua full Maven `test` |
| Unit / integration test | `PASS` | Focused 53/53; toàn Workflow module 153/153 |
| Migration / database | `PASS` | Flyway V1 và PostgreSQL 18.6 Testcontainers; Task 5 không thêm migration |
| Health check | `Chưa kiểm tra` | Không chạy service stack |
| Review thay đổi | `Đã kiểm tra` | Final `git diff --check` sạch; đã rà các file Task 5 |
| Commit / PR | `Chưa tạo` | Không stage, commit hoặc push; root review còn pending |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Triển khai create/save/get/list draft theo hợp đồng Workspace và Workflow Service V1.
2. Bảo đảm persistence, validation, authorization, phân trang và cập nhật snapshot an toàn.
3. Thêm kiểm tra HTTP/JWT/PostgreSQL, regressions về giới hạn request và khóa hàng; ghi nhận giới hạn tích hợp Task 7.

##### Trong phạm vi

- Use case/command, application service và ports cần thiết cho draft operations.
- Aggregate/repository port/entity/mapper/adapter cho workflow draft.
- Request/response/controller cho các route create/get/list/save draft.
- Giới hạn byte của request create/save và các test Task 5 tương ứng.
- Work log K và Task 5 report.

##### Ngoài phạm vi / chủ động chưa làm

- Không triển khai publish/state transitions của Task 6.
- Không triển khai connection-reference persistence hoặc Workflow usage API của Task 7. Chỉ định nghĩa port tối thiểu và chặn fail-closed khi thiếu adapter.
- Không sửa parser/DefinitionValidator, OpenAPI, Compose, Workspace hoặc Identity.
- Không sửa kế hoạch/ledger, không staging/commit/push.

##### Tiêu chí hoàn thành

- [x] Create seed một manual trigger và không yêu cầu client gửi schema/definition/editorState.
- [x] Get/list/save được scope theo workspace, tôn trọng soft-delete và capability.
- [x] Save kiểm tra draft và từng connection ID literal trước khi thay snapshot.
- [x] Persistence giữ ID/null semantics; concurrent save không trộn metadata/definition.
- [x] Raw request size bounded; credential-bearing definition không được persist hoặc echo.
- [x] Focused suite, full Workflow suite, diff check và handoff log/report hoàn tất.

#### 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Task 4 cung cấp JWT resource-server, `WorkspaceAuthorization`, `WorkspaceConnectionPort`, `WorkspaceClient` và structured errors. Task 2/3 cung cấp immutable `WorkflowDefinition`, draft validator và JSON codec.
- **Nguồn sự thật:** `docs/superpowers/specs/workflow-service-spec.md`, Task 5 trong `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 4 report và Workspace API/source đã được đọc trong lane trước.
- **Authorization:** create=`WORKFLOW_CREATE`; get/list=`WORKSPACE_VIEW`; draft save=`WORKFLOW_EDIT`. User ID chỉ lấy từ subject của JWT đã xác minh.
- **Save semantics:** PUT thay snapshot name/description/definition/editorState; editorState lưu riêng. `null` giữ là JSON null / SQL NULL theo đúng vị trí.
- **Connection references:** projection là điều kiện để Task 7 trả usage chính xác. Không dùng production no-op; thiếu port sẽ chặn thay đổi làm thêm hoặc gỡ literal connection IDs.
- **Giới hạn tích hợp:** HTTP tests dùng JWT HMAC ký thật và PostgreSQL Testcontainers; Workspace boundary trong test là test double. Không chạy Compose hoặc Workspace service thật.

#### 5. Nhật ký theo session / thời gian

##### Session 1 - triển khai và verification

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 2026-09-21 | Đọc spec, Task 5 plan, progress ledger, Task 4 docs và kiểm tra worktree | Task 5 ownership tách khỏi Task 2/3/4/9; giữ nguyên các thay đổi có sẵn | Xong |
| 2026-09-21 | Viết Task 5 HTTP/persistence regressions trước production implementation | Ban đầu thiếu-symbol compile RED; sau đó test mới bắt được endpoint 500/unsupported save trước khi implementation | Xong |
| 2026-09-21 | Thêm routes, service, DTO, mapper/entity/repository và body-size filter | Draft create/save/get/list, validation, capabilities, connection authorization, paging và soft-delete filtering hoạt động | Xong |
| 2026-09-21 | Thử row-lock refresh regression | RED tái hiện entity trong persistence context vẫn `DRAFT` sau SQL cập nhật thành `PAUSED` | Xong |
| 2026-09-21 | Refresh entity sau khi lấy pessimistic row lock | Regression đổi sang PASS; khóa đọc state mới trước khi lưu snapshot | Xong |
| 2026-09-21 | Focused suite và full Workflow module | 53/53 focused; 153/153 module, PostgreSQL 18.6 Testcontainers | Xong |
| 2026-09-21 17:51 | Final diff/whitespace check; viết log/report | `git diff --check` PASS; không stage/commit | Xong |

##### Diễn giải quan trọng

- Row-lock query ban đầu có thể trả entity đã được load ở lần lookup trước, dù DB row đã đổi trong lúc Workspace authorization chạy. Regression kiểm tra trực tiếp trạng thái stale này. Adapter giờ gọi `EntityManager.refresh(..., PESSIMISTIC_WRITE)` trước khi chuyển entity về domain.
- Request-size filter kiểm tra Content-Length trước khi parse; nếu length không biết, giới hạn input stream, chấp nhận chính xác 1 MiB và thay structured response bằng 413 khi byte thứ 1 MiB + 1 được đọc.
- TDD evidence không bao gồm các lỗi compile do typo khi thêm test/import; các lỗi đó đã sửa trước các lần chạy xanh cuối cùng.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Tách `ConnectionReferencePort.replaceDraft` khỏi repository workflow | Task 7 sẽ sở hữu projection riêng; cần hook cùng transaction nhưng không bịa storage/usage adapter | Không dùng no-op production adapter vì nó không ngăn connection bị xóa khi draft còn tham chiếu | Task 7 phải cài adapter transaction-aware; hiện thêm/gỡ refs trả 503 nếu thiếu adapter |
| Làm mới entity sau khóa pessimistic | Test PostgreSQL chứng minh persistence context có thể giữ status cũ sau lần lookup đầu | Chỉ dựa vào `SELECT FOR UPDATE` query; regression cho thấy chưa đủ | Refresh lấy snapshot mới trước mapper/save, giữ nguyên state publication mới hơn |
| Giới hạn request byte tại filter và vẫn kiểm tra serialized request trong controller | Content-Length có thể vắng mặt; controller-only check xảy ra sau parse | Chỉ dựa vào `@Size`/kiểm tra sau parse | Filter raw stream ngăn parser tiêu thụ body quá giới hạn; controller là lớp kiểm tra phụ |
| Lưu editorState riêng khỏi execution definition | Spec định nghĩa editor state là UI-only | Gộp layout vào definition | API trả cả hai phần riêng và null semantics được giữ |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `WorkflowDraftService` điều phối create/get/list/save, ủy quyền theo capability, gọi `DefinitionValidator.validateDraft`, giới hạn độ sâu editorState, trích các literal `config.connectionId` và gọi Workspace attachment authorization.
- `WorkflowController` thêm create, list, get và PUT draft; lấy actor từ JWT principal; trả 201 khi tạo mới, structured validation/dependency errors và chỉ đưa chi tiết an toàn.
- Create draft khởi tạo `schemaVersion=1.0`, node `manual` / `trigger.manual`, empty edges/variables. Save là thay snapshot nguyên tử, không thay status/currentVersionId/publishedAt.
- `WorkflowRepositoryAdapter` thêm lookup workspace-scoped, count/page, lọc deleted, thứ tự `createdAt DESC, id DESC`, offset có giới hạn và `PESSIMISTIC_WRITE` kèm refresh.
- Mapper/entity có restore path dùng ID/timestamps có sẵn và đổi JSONB hai chiều mà không làm mất null lồng nhau.
- `WorkflowRequestBodyLimitFilter` áp dụng ở create/save, trả 413 an toàn khi body vượt 1 MiB; test bao gồm chunked-style stream, đúng giới hạn và route ngoài phạm vi filter.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** PostgreSQL `workflow`.
- **Migration:** Không thêm migration; dùng schema V1 có sẵn.
- **Dữ liệu seed/test:** PostgreSQL/RabbitMQ Testcontainers. Không dùng dữ liệu người dùng.
- **Tính tương thích:** Không thay đổi schema/API Workspace; create request bám theo public spec `{name, description}`.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm cấu hình/runtime secret. Giới hạn body là hằng số 1 MiB.
- Test configuration cung cấp Workspace test double và projection in-memory chỉ trong test context; không phải production deletion protection.
- Không thêm dependency.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** `POST /workspaces/{workspaceId}/workflows`, `GET` list/detail, `PUT /workspaces/{workspaceId}/workflows/{workflowId}/draft`.
- **Security:** Public routes cần access JWT; actor chỉ lấy từ JWT. Capability là phản hồi authoritative từ Workspace; save attachment được Workspace xác minh theo từng connection ID literal.
- **Validation/error response:** Create name 1–255 ký tự; page default 0/20, size tối đa 100; definition qua draft validator; editorState JSON depth giới hạn; body tối đa 1 MiB. Lỗi body lớn trả `413 REQUEST_TOO_LARGE`; lỗi validation không trả rejected values.
- **Connection-reference gate:** Nếu draft hiện tại hoặc mới có connection reference mà production projection port không có, save trả `503 DEPENDENCY_UNAVAILABLE`. Task 7 phải lắp adapter trước khi cho phép thêm/gỡ connection refs ở runtime.
- **Health/metrics/logging:** Không thay đổi; error body giữ correlation ID theo Task 4.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/dto/CreateWorkflowCommand.java` | Command create theo workspace/actor/name/description | DTO Task 5 |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/application/usecase/CreateWorkflowUseCase.java` | Tạo aggregate draft có manual trigger và persist | Được gọi sau capability check |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowDraftService.java` | Use case create/save/get/list và validation/auth | Chứa fail-closed Task 7 hook |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkflowDraftValidationException.java` | Lỗi draft có diagnostics an toàn | Controller giới hạn details |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ConnectionReferencePort.java` | Hook thay draft refs cùng transaction | Task 7 cần implementation thật |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ConnectionReferenceUnavailableException.java` | Lỗi fail-closed khi projection thiếu | Mapped sang 503 generic |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/workflow/Workflow.java` | Seed/create và atomic update draft; giữ editorState riêng | File chia sẻ với Task 1 |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/port/out/WorkflowRepository.java` | Workspace-scoped lookup/page/count/lock signatures | No HTTP/JPA type |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/entity/WorkflowJpaEntity.java` | Explicit restore constructor/setters cho mapper | File persistence chia sẻ với Task 1 |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/mapper/WorkflowPersistenceMapper.java` | Domain/JPA conversion; nested null/ID/timestamp preservation | No direct entity in API |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/persistence/repository/WorkflowRepositoryAdapter.java` | Scoped queries, stable page, row lock + refresh | Test stale state và concurrent save |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/WorkflowRequestBodyLimitFilter.java` | Bounded 1 MiB raw request stream | POST create / PUT draft only |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/WorkflowRequestBodyLimitConfiguration.java` | Servlet filter registration | Gateway strips `/api/v1` per spec |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/WorkflowController.java` | Draft API routes | Actor derives from verified JWT |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/request/CreateWorkflowRequest.java` | Align request to `{name, description}` | Existing validation test updated |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/request/SaveWorkflowDraftRequest.java` | Draft replacement request | `editorState` optional JSON map |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/presentation/http/response/WorkflowResponse.java` | Detail/create/list response DTOs | List summary excludes full JSON |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/WorkflowDraftTestConfiguration.java` | Test-only DB containers, Workspace boundary and ref port | Not production implementation |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/application/service/WorkflowDraftServiceTest.java` | Capability/dependency/depth fail-closed tests | Unit tests |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/persistence/WorkflowDraftPersistenceTest.java` | JSONB, scope, deleted, pagination, concurrency and stale-lock tests | PostgreSQL Testcontainers |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/web/WorkflowRequestBodyLimitFilterTest.java` | Exact request boundary and chunked stream tests | Servlet filter unit tests |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowDraftHttpTest.java` | Signed JWT, endpoint/auth/validation/credential tests | MockMvc + real PostgreSQL |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/request/CreateWorkflowRequestValidationTest.java` | Validate the actual create contract | No client-supplied schema fields |
| `Thêm` | `docs/work_logs/K/2026-09-21-workflow-service-task-5.md` | Task 5 detailed handoff log | K folder per owner instruction |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-5-report.md` | Concise Task 5 implementation/verification report | Root review pending |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| TDD RED | `WorkflowDraftPersistenceTest#rowLockRefreshesAnEntityAlreadyLoadedBeforeTheLockWasTaken` trước fix | RED: expected `PAUSED`, got stale `DRAFT` | Reproduced in PostgreSQL Testcontainers |
| Row-lock regression | `-Dtest=WorkflowDraftPersistenceTest#rowLockRefreshesAnEntityAlreadyLoadedBeforeTheLockWasTaken test` | PASS: 1/1 | Verifies refresh after lock |
| Focused final | Selector `WorkflowDraftHttpTest,WorkflowDraftPersistenceTest,WorkflowDraftServiceTest,CreateWorkflowRequestValidationTest,WorkflowRequestBodyLimitFilterTest,WorkflowSecurityTest,WorkspaceClientTest,WorkflowPersistenceTest` | PASS: 53 tests, zero failures/errors/skips | HTTP/security use Task 5 test boundary; no live Workspace service |
| Full Workflow module | `mvnw.cmd ... test` | PASS: 153 tests, zero failures/errors/skips; BUILD SUCCESS | PostgreSQL 18.6 and RabbitMQ Testcontainers; includes Task 1–4 and graph lane tests |
| Database | Full suite Testcontainers | PASS: Flyway V1 applied; JSONB mappings, paging and row-lock tests passed | No production DB changed |
| Static/diff | `git diff --check` | PASS | Git printed line-ending normalization notices for shared Task 4 property files; no whitespace error |
| Task 5 whitespace | PowerShell `Select-String '[\t ]+$'` over owned Task 5 source/test paths | PASS: no trailing whitespace | Untracked and modified Task 5 files included |

Full/focused runs used `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`, existing Maven-home junction `C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home` and local repo `C:\Users\nhoan\.m2\repository`.

```powershell
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
$env:MAVEN_USER_HOME = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=WorkflowDraftHttpTest,WorkflowDraftPersistenceTest,WorkflowDraftServiceTest,CreateWorkflowRequestValidationTest,WorkflowRequestBodyLimitFilterTest,WorkflowSecurityTest,WorkspaceClientTest,WorkflowPersistenceTest' test
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' test
```

##### Điều chưa được kiểm tra

- Không chạy Compose hoặc request tới Workspace service thật. Task 5 HTTP tests xác minh signed JWT thật và PostgreSQL; Workspace authorization/attachment dùng test double. WorkspaceClient có local HTTP contract tests từ Task 4.
- Chưa chạy runtime Gateway flow; route contract được triển khai theo spec sau Gateway prefix stripping.
- Chưa xác minh Task 7 usage API/delete behavior vì adapter và usage endpoint nằm ngoài phạm vi.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| `Trung bình` | Projection connection refs chưa có adapter production | Task 7 chưa triển khai | Save có refs hiện tại hoặc mới trả 503, không ghi workflow/projection dở dang | Task 7 owner cài adapter transactional, sau đó test draft/usage/delete cùng nhau |
| `Trung bình` | Workspace thật / Compose chưa chạy | Test 5 dùng Workspace boundary giả lập | Hợp đồng Workspace client được kiểm bởi local HTTP tests Task 4; không tuyên bố end-to-end liên service | Task 21/Coordinator nối cấu hình, chạy integration stack |
| `Thấp` | GitNexus stale/UNKNOWN | Index hiện tại không giải được một số repository/new symbols | Dựa vào impact trước sửa và targeted source search; không coi UNKNOWN là an toàn | Root xem lại graph/source và chạy detect-changes trước commit |

##### Lỗi có thể tái lập

```text
Trước fix, lấy entity qua findByWorkspaceAndId, cập nhật status DB thành PAUSED trong cùng test transaction, rồi gọi lockByWorkspaceAndId.
Kết quả mapper nhận lại entity đã có trong persistence context: expected PAUSED, got DRAFT.
Sau EntityManager.refresh(entity, PESSIMISTIC_WRITE): test PASS.
```

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Root review Task 5 diff, đặc biệt fail-closed `ConnectionReferencePort` contract và transaction boundary.
2. Task 7 bổ sung adapter thật trong cùng transaction; không bật save connection refs trong runtime trước khi có adapter và usage contract được kiểm chứng.
3. Khi Task 6 bổ sung publish, giữ status/currentVersion mới nhất qua save; repository lock hiện refresh snapshot trước khi mapper update.
4. Trước commit, review toàn bộ shared branch, chạy GitNexus change detection và test suite cuối.

##### Cần quyết định / quyền truy cập từ người khác

- Không còn blocker cần input để hoàn tất Task 5. Root review/acceptance vẫn là gate kế tiếp.

##### Hướng dẫn cho AI agent tiếp theo

- Chỉ Task 5 files và hai handoff artifacts của Task 5 thuộc lane này; shared worktree còn các thay đổi Tasks 1–4 và Tasks 2/3/9 của worker khác.
- Đọc spec, plan/progress, log này và `git status` trước khi sửa. Không ghi log Task 5 sang `docs/work_logs/T`.
- Không thay parser; Task 2/3 sở hữu validator/mapping.
- Không dùng no-op reference projection; thiếu adapter hiện phải tiếp tục fail-closed.
- Không stage, commit, push hoặc sửa plan/ledger trong lane này.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md` — routes, capabilities, draft vs immutable published version, connection safety.
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Task 4–7 interfaces/ownership.
- `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md` — coordinator milestones and shared-file ownership.
- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-4-report.md` — JWT/Workspace client/error contract.
- `docs/work_logs/log_template.md` — worklog structure.

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 17:54 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit trong Tasks 1–5 và Tasks 2/3/9; giữ nguyên mọi lane |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 5 worker |
| Cần đọc trước khi tiếp tục | Task 5 report, Task 7 plan, final shared diff review |

---

#### Checklist trước khi đóng log

- [x] Tóm tắt kết quả và phần chưa hoàn thành.
- [x] Ghi quyết định reference hook và khóa hàng.
- [x] Liệt kê file Task 5, không kể build output.
- [x] Có lệnh tái lập focused/full tests.
- [x] Rủi ro/next step có owner rõ ràng.
- [x] Không ghi secret/token/PII.
- [x] Trạng thái commit/worktree chính xác.
---

### Source record: 2026-09-21-workflow-service-task-6.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thêm luồng publish dùng snapshot draft đã validate, kiểm tra Workspace capability và connection attachment trước khi lấy row lock; nếu snapshot đổi trong lúc gọi Workspace thì trả `409 DRAFT_CHANGED`.
- Lưu version bất biến, cập nhật current version, trạng thái workflow, trigger registrations và Task 7 connection-reference projection trong cùng transaction. Publish khi workflow đang `PAUSED` tiếp tục giữ trạng thái paused.
- Thêm pause/resume có capability riêng, từ chối draft chưa publish và cho phép gọi lặp idempotent; schedule, webhook và Telegram tiếp tục fail-closed cho tới khi readiness/provisioning tương ứng được triển khai.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Compile/build | `PASS` | Workflow Maven module compile trong focused và full test |
| Unit / integration test | `PASS` | Task 6 selectors 17/17; full Workflow module 184/184 |
| Migration / database | `PASS` | PostgreSQL 18.6 Testcontainers; Flyway V1/V2 chạy trong suite; Task 6 không thêm migration |
| Health check | `Chưa kiểm tra` | Không triển khai môi trường Compose/live service trong Task 6 |
| Review thay đổi | `Đã kiểm tra` | Task 6 source/tests và `git diff --check`; coordinator review vẫn chờ |
| Commit / PR | `Chưa tạo` | Không stage, commit hoặc push theo phạm vi được giao |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Publish version bất biến từ đúng snapshot đã validate và authorized.
2. Ghi version, current pointer, trigger state và connection references atomically.
3. Quản lý pause/resume và chứng minh state/version behavior bằng HTTP, unit và PostgreSQL concurrency tests.

##### Trong phạm vi

- `WorkflowPublicationService`, version/trigger ports và persistence adapters.
- Aggregate/entity/mapper/controller/response cần cho publication và workflow state.
- Unit, signed-JWT HTTP, PostgreSQL publication/concurrency regressions.
- Worklog dưới `docs/work_logs/K/` và report Task 6.

##### Ngoài phạm vi / chủ động chưa làm

- Không cài scheduler, webhook secret provisioning hoặc Telegram integration. Các luồng này bị từ chối công khai an toàn cho tới Task 16/17 hoặc integration tương ứng.
- Không sửa `ConnectionReferencePort`, Task 7 adapter/migration/controller hay các file Task 7 khác; publication chỉ gọi `appendVersion(...)` qua port do graph worker sở hữu.
- Không sửa plan/progress ledger, không triển khai execution engine và không thay đổi Compose/live-service wiring.

##### Tiêu chí hoàn thành

- [x] Validate và authorize frozen snapshot trước lock; reject conflict nếu draft đổi.
- [x] Persist version/current pointer/trigger/reference projection trong transaction; rollback và concurrency có PostgreSQL coverage.
- [x] Giữ `PAUSED` khi republish; pause/resume có state validation và idempotence.
- [x] Chặn readiness/provisioning chưa tồn tại bằng lỗi dependency an toàn.
- [x] Focused selectors, full Workflow suite, diff check và handoff report.

#### 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** Task 5 đã thêm draft API và row-lock save. Task 7 đang thêm version-aware connection-reference projection; publication cần gọi projection cùng transaction, không tạo no-op adapter.
- **GitNexus:** Index cũ hơn checkout vài docs-only commits. Impact cho `Workflow`, `WorkflowVersion`, `WorkflowTrigger` báo LOW; các symbol mới hoặc method chưa được index trả UNKNOWN/không tìm thấy, nên đã corroborate bằng source search và call-site inspection. UNKNOWN không được xem là all-clear.
- **Capability:** `WORKFLOW_PUBLISH` được kiểm tra trước workflow lookup; pause/resume dùng `WORKFLOW_MANAGE_STATE`. Actor lấy từ verified JWT principal tại controller.
- **Snapshot ordering:** Đọc và freeze draft, validate, kiểm tra connection authorization với Workspace, rồi mới lấy workflow row lock. So sánh `schemaVersion` và `draftDefinition` sau refresh/lock; mismatch trả `DRAFT_CHANGED` trước khi cấp số version hoặc ghi dữ liệu.
- **Readiness gates:** Mọi `trigger.schedule`, `trigger.webhook` và `trigger.telegram` publish đều fail closed với `503 DEPENDENCY_UNAVAILABLE` đến khi provider tương ứng có readiness/provisioning contract. Không tạo trigger ready giả hoặc trả credential chưa provision.
- **Reference consistency:** Version được flush trước khi gọi `appendVersion(workflowId, versionId, connections)` vì adapter Task 7 kiểm tra FK bằng JDBC; hai thao tác vẫn dùng chung transaction/datasource. Draft có connection nhưng thiếu production reference adapter thì fail closed.

#### 5. Nhật ký theo session

##### Session 1 - 2026-09-21

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

##### Diễn giải quan trọng

- Lần chạy trước khi sửa test HTTP đã fail tại assertion `response.contains("config")`: response chứa generic, cố định `Workflow trigger configuration is not available`, không phải dữ liệu cấu hình. Đã đổi sang kiểm tra chính xác public message, `details=[]` và không trả tên/draft identifiers. Focused signed-JWT test sau sửa pass.
- Một lần full-suite giữa chừng có 17 errors vì `WorkflowSecurityTest` đăng ký test-only `GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage` trùng route production do Task 7 thêm. Graph worker đã bỏ duplicate test-only mapping; focused security verification và full Workflow suite cuối cùng đều pass. Không thay đổi production Task 4 security code.
- TDD/verification evidence không xem assertion test sai hoặc lỗi harness là lỗi production; các lỗi harness được cô lập, sửa đúng file và xác minh lại trước full-suite pass.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Validate/authorize bên ngoài row lock rồi so sánh snapshot bên trong lock | Tránh giữ workflow lock trong Workspace round trip, không publish draft mới chưa được authorize/validate | Validate lại phiên bản mới sau lock sẽ thay đổi đối tượng đã được Workspace cho phép | Snapshot đổi thì trả 409; caller cần fetch/save rồi publish lại |
| Version, pointer, trigger replacement và reference projection cùng transaction | Rollback test chứng minh version/pointer/triggers không sót nếu lỗi giữa chuỗi write; Task 7 adapter cùng datasource | Ghi references ở transaction riêng hoặc no-op adapter | Projection thiếu với connection-bearing publish thì 503; version insert flush trước FK projection |
| Giữ status PAUSED khi publish version mới | Người dùng không kỳ vọng republish tự bật workflow/trigger | Luôn đặt PUBLISHED sau publish | Trigger mới khi paused được lưu DISABLED; resume mới có thể bật trigger đủ điều kiện |
| Giữ gates đóng cho schedule/webhook/Telegram | Readiness implementation thuộc Task 16/17 hoặc provider task; chưa có endpoint/secret thật | Tạo trigger ACTIVE theo hình thức hoặc sinh secret placeholder | Không có đường execution giả; route publish phản hồi 503 rõ ràng |
| `WebhookProvisioning.toString()` redact credential fields | Ngăn secret lộ qua debug/log/string rendering nếu DTO được mở rộng sau này | Dựa hoàn toàn vào serializer không gọi `toString()` | DTO hiện không phát sinh provisioning; review serialization khi Task 17 thêm secret thật |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

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

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** PostgreSQL `workflow`.
- **Migration:** Task 6 không thêm migration. Dùng bảng workflow/version/trigger hiện có; Task 7 V2 thêm reference projection được gọi qua port trong publication transaction.
- **Tương thích:** Không thay schema/API của Workspace. Version snapshots được giữ bất biến; executions đã queue vẫn trỏ version UUID cũ.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm production config hoặc dependency.
- PostgreSQL, RabbitMQ Testcontainers dùng bởi integration tests; không sửa hạ tầng runtime.
- Provider schedule/webhook/Telegram vẫn đóng; không tạo secret hoặc readiness state giả.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Ba POST route publish/pause/resume dưới workspace-scoped workflow resource.
- **Security:** JWT actor được xác thực bởi Task 4; publication cần capability `WORKFLOW_PUBLISH`, state changes cần `WORKFLOW_MANAGE_STATE`. Workspace authorize connection attachment trước lock.
- **Validation/error response:** Draft không hợp lệ trả 400 `VALIDATION_ERROR`; snapshot đổi trả 409 `DRAFT_CHANGED`; trigger/reference dependency unavailable trả 503 `DEPENDENCY_UNAVAILABLE` với message an toàn và details rỗng.
- **Logging/metrics:** Không thêm log hoặc metric mới; không log connection credential/config. Error envelope giữ request path/correlation theo hạ tầng hiện có.

#### 8. Danh sách file ảnh hưởng

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

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Focused Task 6 | `mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=WorkflowPublicationTest,WorkflowPublicationConcurrencyTest,WorkflowPublicationHttpTest test` với `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` | PASS: 17 tests, zero failures/errors/skips; BUILD SUCCESS | Unit, PostgreSQL/RabbitMQ Testcontainers và signed-JWT MockMvc |
| Focused rollback regression | `-Dtest=WorkflowPublicationConcurrencyTest#failureAfterVersionAndTriggerWritesRollsBackTheWholePublication` với UTC timezone | PASS: 1/1 | Verifies trigger row is DISABLED before injected failure and restored ACTIVE after rollback |
| Full Workflow module | `mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository test` với UTC timezone | PASS: 184 tests, zero failures/errors/skips; BUILD SUCCESS | Reran after final Task 6 test edit; includes Tasks 5/6/7, PostgreSQL 18.6/RabbitMQ Testcontainers |
| Workspace boundary selectors | `WorkflowContractValidationTest,ConnectionUsageProtectionTest` | PASS: 20/20 theo Graph worker | HTTP contract fixtures; không phải live Compose deployment |
| Database integration | Task 6 full suite | PASS: Flyway V1/V2, publication transaction/concurrency/rollback, queued version pinning | Testcontainers; production database không bị thay đổi |
| Static/diff | `git diff --check` | PASS, exit 0 | Git cảnh báo line ending LF→CRLF trong `application.properties` files ngoài Task 6 |

##### Điều chưa được kiểm tra

- Chưa chạy end-to-end qua Workspace/Workflow services trong Compose; Workspace boundary được kiểm bằng contract HTTP fixtures và Workflow integration bằng Testcontainers.
- Chưa có evidence production readiness của scheduler/webhook/Telegram; publish cho các trigger đó chủ đích fail closed tới Tasks 16/17/provider work.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Thấp | HTTP test tìm substring `config` trong toàn body | Generic sanitized message có từ “configuration” | Assert exact message, empty details, không lộ draft identifiers; focused test pass | Đã xử lý |
| Thấp | Full suite trước đó có 17 test-context errors | Test-only route trùng production route sau Task 7 controller được đăng ký | Graph worker bỏ test-only route; focused security và full 184/184 pass | Đã xử lý trong graph lane |
| Trung bình | Scheduler/webhook/Telegram chưa provision | Các task/provider tương ứng chưa triển khai | Publish fail-closed 503; không đánh dấu trigger ACTIVE | Task 16/17 và provider owner |
| Trung bình | GitNexus index không hoàn toàn hiện hành | Index cũ hơn checkout; một số target UNKNOWN | Dùng targeted source/call-site review; không xem UNKNOWN là all-clear | Coordinator trước commit |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator review Task 6 diff/log/report cùng Task 7 reference adapter contract.
2. Task 16/17 có thể thay closed readiness gates bằng provider thật sau khi có contract và integration tests; giữ transaction/locking contract hiện tại.
3. Trước bất kỳ commit nào, chạy GitNexus detect-changes theo quy trình root; Task 6 worker không stage/commit/push.

##### Cần quyết định / quyền truy cập từ người khác

- Không có blocker kỹ thuật đang chờ. Coordinator review/acceptance vẫn pending.
- Live Workspace + Compose integration vẫn là work còn lại ở service/runtime gate, không được xem là đã hoàn tất chỉ vì fixture/Testcontainers suite xanh.

##### Hướng dẫn cho AI agent tiếp theo

- Đọc file này, Task 6 report, Workflow Service spec/plan và Task 7 log trước khi đổi publication/trigger code.
- Giữ fail-closed provider gate cho đến khi provider readiness/secret provisioning được implement và test.
- Bảo đảm `WorkflowVersion` insert/flush và `ConnectionReferencePort.appendVersion` còn chung transaction; không tạo production no-op reference adapter.
- Không log, serialize hoặc đưa credential/secret vào errors.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Task 6
- `docs/work_logs/K/2026-09-21-workflow-service-task-5.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md`

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21` (`Asia/Saigon`) |
| Trạng thái worktree | Có thay đổi chưa commit; gồm nhiều Task 1–7/9 worker changes, được giữ nguyên |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 6 worker |
| Cần đọc trước khi tiếp tục | Mục 6 quyết định kỹ thuật; Task 6 report; Task 7 reference adapter contract |

---

#### Checklist trước khi đóng log

- [x] Tóm tắt phân biệt Task 6 complete với runtime gates còn lại.
- [x] Nêu quyết định, file, tests và lệnh tái lập.
- [x] Ghi GitNexus UNKNOWN/staleness, provider gates và chưa có live Compose verification.
- [x] Không stage/commit/push; không ghi secret hoặc connection string chứa credential.
---

### Source record: 2026-09-21-workflow-service-task-7.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Thay port tham chiếu trong bộ nhớ bằng projection PostgreSQL dùng chung transaction với draft save và immutable publication.
- Triển khai endpoint nội bộ connection-usage: nó trả false khi không có tham chiếu kể cả cặp ID chưa từng xuất hiện, và không gọi Workspace.
- Mở rộng Workspace test để xác nhận caller thật cho phép xóa khi Workflow trả 200 false và từ chối xóa khi downstream lỗi.
- Migration V2 backfill đúng nodes[*].config.connectionId; config thiếu/hỏng được bỏ qua an toàn, references của immutable version vẫn được giữ khi workflow bị soft-delete.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Compile / build | PASS | Final full Workflow Maven module BUILD SUCCESS sau Task 6 rollback regression update |
| Unit / integration test | PASS | Final Workflow 184/184; Workspace boundary 20/20 |
| Migration / database | PASS | V1→V2 từ schema V1 có dữ liệu; PostgreSQL 18.6/Testcontainers |
| Review thay đổi | Đã kiểm tra | git diff --check được chạy sau khi tạo log/report |
| Commit / PR | Chưa tạo | Không stage/commit/push theo ownership của coordinator |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Thêm persistent tracking cho draft và published-version connection references.
2. Phục vụ contract Workspace usage bằng dữ liệu Workflow local, scoped theo workspace.
3. Xác minh publication/draft transaction, migration từ V1 và caller fail-closed của Workspace.

##### Trong phạm vi

- ConnectionReferencePort, PostgreSQL adapter, Flyway V2.
- Usage service, bounded fixed-window limiter, internal controller, 429 mapping, OpenAPI và README.
- Task 7 integration/unit tests và các Workspace contract/deletion regressions.
- Điều chỉnh test harness security để loại duplicate fake route sau khi controller production được thêm.

##### Ngoài phạm vi

- Không triển khai workflow execution engine/admission/persistence Tasks 8 trở đi.
- Không gọi Workspace database trực tiếp; không thêm foreign keys sang service khác.
- Không chạy Compose hoặc kết nối Workspace/Workflow service production.
- Không cập nhật plan/ledger, không staging, commit hoặc push.

##### Tiêu chí hoàn thành

- [x] Draft projection thay thế nguyên tử; version projection append-only và cùng transaction với publish.
- [x] Usage lookup đúng workspace; mọi version được tính, draft đã xóa không được tính.
- [x] 200 false cho ID chưa biết; usage lookup không gọi Workspace.
- [x] 401, 429, 500 dùng envelope an toàn; migration chịu được JSON draft/version thiếu hoặc chưa hoàn chỉnh.
- [x] Workspace caller tiếp tục xóa khi Workflow trả 200 false và fail closed trên lỗi downstream.
- [x] Focused/full tests, diff check và handoff artifacts hoàn tất.

#### 4. Bối cảnh và quyết định

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

#### 5. Nhật ký session

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

##### Diễn giải quan trọng

- Full suite ban đầu không phát hiện lỗi production usage logic; test context không thể khởi tạo vì TestSecurityController và InternalConnectionUsageController cùng khai báo một GET mapping. Sau khi bỏ fake route, 17 security tests chạy và full suite 184 tests đều xanh. Test security cho key-alone nay đánh vào endpoint thật, trả false cho cặp ID chưa thấy.
- Lần Workspace build đầu không có quyền đọc ổn định JAR trong shared Maven cache và dừng ở compile trước test. Chạy lại với elevated exec cùng local repository hoàn tất compile và 20 tests đều xanh; không có source compile failure.
- Workspace boundary test dùng chính WorkflowConnectionUsageClient và DeleteConnectionUseCase trên HTTP fixture trong test process. Nó kiểm tra consumer, header/path/response và fail-closed delete; không phải live Workflow↔Workspace deployment E2E.
- Task 6 publication worker báo focused suite 17/17 trước lượt full run. Lượt full Workflow của session này độc lập chạy lại toàn bộ publication tests trong suite 184/184.

#### 6. Thay đổi đã thực hiện

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

#### 7. Kiểm tra và bằng chứng

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

##### Điều chưa được kiểm tra

- Không chạy service thật qua Docker Compose hoặc gọi một deployment Workspace↔Workflow; cross-service behavior được kiểm trên actual Workspace client và HTTP contract fixture cô lập.
- Không áp dụng migration lên production/shared database; V1→V2 chỉ chạy trong disposable Testcontainers.
- Không triển khai hoặc xác minh Workflow execution runtime; Task 7 chỉ quản lý reference usage.

#### 8. Sự cố, rủi ro và next step

| Mức độ | Vấn đề | Bằng chứng / xử lý | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- |
| Thấp | GitNexus không resolve một số Task 7/test symbols do index stale | Impact trả target-not-found/UNKNOWN; xác minh bằng source, route search và test runtime | Root review; chạy change detection trước commit |
| Thấp | Workspace tests không phải live service-to-service E2E | Actual client/use case chạy qua local HTTP fixture; Workflow controller có integration test riêng trong cùng module | Coordinator nối real stack trong milestone integration nếu cần |
| N/A | Không còn test blocker Task 7 | Focused, Workspace boundary, security regression và full Workflow đều PASS | Coordinator review và quyết định milestone |

#### 9. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Root review migration, adapter transaction boundary và 200-false ownership contract.
2. Root kiểm tra combined diff với Task 5/6, sau đó cập nhật progress ledger/plan theo quyền sở hữu coordinator.
3. Trước bất kỳ commit nào, thực hiện GitNexus change detection và independent diff/security review.

##### Chưa làm

- Không làm Task 8 trở đi trong lane này; Task 7 không phải execution engine.
- Không stage/commit/push; root giữ acceptance và milestone gate.

#### 10. Tham chiếu

- docs/superpowers/specs/workflow-service-spec.md
- docs/superpowers/plans/2026-09-21-workflow-service-v1.md
- .superpowers/sdd/2026-09-21-workflow-service-v1/progress.md
- docs/work_logs/log_template.md

#### 11. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm cập nhật | 2026-09-21 19:28 Asia/Saigon |
| Trạng thái worktree | Có nhiều thay đổi chưa commit từ các lane Tasks 1–7/9; giữ nguyên thay đổi ngoài ownership |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 7 graph worker |
| Cần đọc trước khi tiếp tục | Task 7 report và coordinator ledger |
