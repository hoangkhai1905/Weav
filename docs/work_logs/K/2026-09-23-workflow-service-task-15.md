# Nhật ký ngày `2026-09-23` — Workflow Service Task 15 và API_KEY fail-closed

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex Task 15 worker |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | `Sẵn sàng coordinator review`; focused tests xanh, full suite chờ coordinator chạy sau khi mọi lane ổn định |
| Phạm vi session | Fail-closed executor/readiness cho integration chưa có hợp đồng và ngừng giả định header API_KEY cố định |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 15; `docs/superpowers/specs/workflow-service-spec.md` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Đăng ký adapter không retryable cho `email.send`, `telegram.send_message`, `ai.extract`, `ai.classify`, và `ai.summarize`. Các node giữ cấu hình/kiểu output trong catalog, nhưng không tạo kết quả giả hoặc gọi provider chưa được duyệt.
- Thêm readiness server-owned cho các action trên và `trigger.telegram`; thêm `TelegramTriggerIngress` ở application port, không định nghĩa endpoint hay normalized payload contract.
- Chặn `API_KEY` của HTTP node bằng `DEPENDENCY_NOT_CONFIGURED` cho đến khi Workspace response có header name được cấu hình. Không thêm default `X-Api-Key` và không sửa Workspace contract.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Maven biên dịch Workflow module trong focused run. |
| Unit / integration test | `PASS` | 50/50 focused tests; gồm PostgreSQL/Rabbit thật cho unsupported nodes và scanner. |
| Migration / database | Không áp dụng | Lane này không sửa schema hoặc migration. |
| External provider | Chưa chạy | Không có provider/credential call; các adapter bị chặn trước external call. |
| Review thay đổi | Đã kiểm tra | Source caller đã đối chiếu thủ công do GitNexus `UNKNOWN`; `git diff --check` không có lỗi. |
| Commit / PR | Chưa tạo | Không stage, commit, push hoặc merge. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Làm rõ trạng thái unavailable của các action Email, Telegram và AI mà không bịa provider/auth/endpoint contract.
2. Đảm bảo chạy các node đó tạo một failed attempt không retry, không external call và không fake output; manual admission vẫn khả dụng.
3. Chặn HTTP `API_KEY` cho đến khi Workspace cung cấp `apiKeyHeaderName` trong resolved response; không tự suy đoán header.

### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/application/node/UnavailableNodeExecutor.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/node/IntegrationReadiness.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/node/NodeExecutorRegistry.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/port/in/TelegramTriggerIngress.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutor.java`
- Task 15, API_KEY và real-runtime regression tests; K work log và scratch report.

### Ngoài phạm vi / chủ động chưa làm

- Không thêm Gmail send scope/provider, Telegram Bot API, AI endpoint, credential/auth protocol, hoặc webhook HTTP route/DTO.
- Không thêm Workspace response field `apiKeyHeaderName`; chưa có hợp đồng additive được chấp thuận.
- Không sửa Workflow OpenAPI, schedule/publication source thuộc peer, plan/progress ledger thuộc coordinator, migration, hoặc deployment config.
- Không stage, commit, push, tạo worktree, hay gọi provider thật.

### Tiêu chí hoàn thành

- [x] Năm action integration báo `DEPENDENCY_NOT_CONFIGURED`, non-retryable và không tạo output giả.
- [x] Telegram trigger có readiness unavailable và application-only ingress đóng fail-closed; persisted registration hiển thị disabled cùng reason code qua Task 16 detail path.
- [x] HTTP `API_KEY` bị chặn trước outbound transport; không lộ secret; `TOKEN` bearer path vẫn hoạt động.
- [x] Focused Task 15/API_KEY + Task 16 selectors xanh và log/scratch report được cập nhật.
- [ ] Coordinator chạy full combined Workflow suite và GitNexus change analysis trước milestone/commit decision.

## 4. Bối cảnh và quyết định

- **Workspace API_KEY contract:** `WorkspaceClient` chỉ chấp nhận resolved response gồm `provider`, `authType`, `auth`; `AUTH_FIELDS` cho `API_KEY` chỉ chứa `apiKey`. `ResolveConnectionUseCase` cũng trả đúng map `{apiKey}`. `apiKeyHeaderName` tồn tại trong cấu hình/provider nội bộ của Workspace, nhưng không có trong resolved API response Workflow nhận được.
- **Quyết định API_KEY:** Trả `DEPENDENCY_NOT_CONFIGURED`, `retryable=false`, trước `PinnedHttpTransport.executeWithAuthentication`. Không phát header mặc định. Sau này chỉ hỗ trợ khi resolved contract additive cung cấp header name đã được Workspace xác thực.
- **Unavailable actions:** Giữ node catalog/config và output docs hiện tại; adapter là fail-closed, không tạo message ID, AI result hoặc output giả. `NodeExecutorRegistry` thêm fallback cho năm type nhưng cho phép adapter bean cụ thể đã đăng ký thay thế.
- **Telegram trigger:** `IntegrationReadiness.forType` báo dependency chưa cấu hình. `TelegramTriggerIngress` nhận normalized value như application boundary, nhưng unconfigured implementation luôn ném exception an toàn; không có HTTP ingress hay normalization DTO.
- **GitNexus:** Impact walk trả `UNKNOWN` do index database storage v43, runtime v42, index cũ ba commits. CLI fallback không chạy được do `EPERM` khi resolve `C:\Users\nhoan`. Theo quy định, không coi đây là all-clear; nguồn gọi được xác minh bằng source search và coordinator giữ trách nhiệm refresh/change analysis.

## 5. Nhật ký theo session / thời gian

### Session 1 — `2026-09-23`

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Khảo sát | Đọc `AGENTS.md`, workflow spec/plan, Task 13/14 handoff và trạng thái làm việc | Ranh giới Task 15, quyết định Workspace API_KEY và quyền sở hữu được xác nhận | Xong |
| Impact | Chạy GitNexus upstream impact cho registry/HTTP và trigger seams | `UNKNOWN` do index/runtime mismatch; CLI fallback gặp `EPERM` | Xong |
| Corroborate | Tìm caller registry, HTTP executor và Workspace resolve contract trong source | `NodeAttemptRunner` gọi `registry.require`; Spring inject `List<NodeExecutor>`; API_KEY resolve chỉ có `apiKey` | Xong |
| RED | Viết regression tests rồi chạy focused selector trước implementation | 18 tests, 12 failures, 0 errors; registry thiếu adapter, ingress thiếu và API_KEY còn đi qua transport | Xong |
| Implementation | Thêm unavailable adapter/readiness/Telegram ingress; sửa HTTP API_KEY path | Unsupported actions thất bại non-retryable; API_KEY không tạo outbound auth header | Xong |
| TDD refinement | Chạy combined selector, thấy DB no-output representation là `{}` | Sửa SQL assertion để kiểm chứng empty JSON object theo `JsonValues.freezeMap(null)` thay vì giả định SQL NULL | Xong |
| Verification | Chạy focused Task 15/API_KEY + Task 16 selectors sau source-stable handoff | 50 tests, 0 failures/errors/skips; `BUILD SUCCESS`; có real PostgreSQL/Rabbit tests | Xong |
| Diff check | Chạy `git diff --check` | Không có whitespace error; có warning line-ending ở hai shared `application.properties` peer sửa | Xong |
| Handoff docs | Tạo work log và scratch report | Không chứa credentials; không stage/commit | Xong |

### Diễn giải quan trọng

Runtime integration test lưu “không có output” dưới dạng empty JSON object (`{}`), vì `JsonValues.freezeMap(null)` chuẩn hóa map tùy chọn thành `Map.of()`. Test xác minh `{}` ở node và attempt, không chấp nhận provider/message/AI payload giả.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng `UnavailableNodeExecutor` rõ ràng cho từng node type | Catalog đã chấp nhận config, nhưng provider contract chưa sẵn sàng | Trả `Result` rỗng hoặc fake success sẽ gây hiểu nhầm và có thể làm downstream chạy sai | Có thể thay thế fallback khi integration thực được phê duyệt |
| Readiness do server quyết định theo type | Node config không thể tự khai báo integration đã cấu hình | Tin config của workflow sẽ cho phép giả readiness | Trigger Telegram luôn disabled cho đến khi integration được duyệt |
| API_KEY bị chặn vì resolved response thiếu header name | Workflow không thể biết header hợp lệ mà không đoán | Dùng `X-Api-Key` mặc định không được phép theo quyết định 2026-09-23 | Cần Workspace additive contract trước khi bật mode này |
| Giữ `TOKEN`/`BASIC` và denylist inline credential header | Chỉ API_KEY default mapping bị gỡ; các mode có contract vẫn giữ | Chặn mọi HTTP auth would break existing behavior | Bearer regression tiếp tục pass |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `UnavailableNodeExecutor`: chỉ nhận năm node type được liệt kê; luôn ném `DEPENDENCY_NOT_CONFIGURED`, `retryable=false`, message cố định và không có output/provider call.
- `NodeExecutorRegistry`: thêm fallback executor nếu chưa có executor cụ thể được inject.
- `IntegrationReadiness`: trả readiness false cùng `DEPENDENCY_NOT_CONFIGURED` cho năm action và `trigger.telegram`; `trigger.manual` tiếp tục ready.
- `TelegramTriggerIngress`: application port nhận trigger ID và normalized input; `unconfigured()` ném `TriggerDependencyUnavailableException`; không tạo transport contract.
- `HttpRequestNodeExecutor`: nhánh `API_KEY` dừng fail-closed trước transport, không sinh default header; existing `finally` đóng `ResolvedConnection`.
- Integration tests xác minh một attempt duy nhất, dependency error code, output rỗng `{}` ở node/attempt, và deterministic fake executor không được gọi. Unit tests xác minh `API_KEY` không gọi transport, không báo auth failure, không lộ secret và đóng holder.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không sửa schema.
- **Migration:** Không có.
- **Dữ liệu test:** Chỉ config/credential markers tổng hợp; không có provider data.
- **Tương thích:** Node catalog và typed config/output docs không bị đổi. Workflow runtime lỗi an toàn ở một attempt cho action chưa triển khai.

### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm dependency, biến môi trường, OAuth scope hoặc secret.
- Không sửa Workspace service/API contract.
- Focused integration tests dùng PostgreSQL/Rabbit Testcontainers; adapter tests dùng deterministic transport/Workspace seam.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không thêm route cho Telegram ingress; Task 16 bổ sung trigger detail projection như thay đổi additive ở lane riêng.
- **Security:** API key secret không vào header, error, output hoặc log; resolved credential holder đóng ngay cả nhánh fail-closed.
- **Failure:** Unsupported action/API_KEY trả `DEPENDENCY_NOT_CONFIGURED`, không retry; API_KEY không làm auth-failure report vì chưa gửi request.
- **Health/logging:** Không thêm logging.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/node/UnavailableNodeExecutor.java` | Non-retryable fallback cho năm action | Không có provider side effect/output |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/node/IntegrationReadiness.java` | Server-owned integration readiness | Telegram và năm action unavailable |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/application/node/NodeExecutorRegistry.java` | Đăng ký unavailable fallback | Specific configured adapter vẫn được ưu tiên |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/in/TelegramTriggerIngress.java` | Application-only, unconfigured ingress | Không có HTTP DTO/route |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutor.java` | Bỏ API_KEY default header path | Chờ Workspace header-name contract |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/application/node/UnavailableNodeExecutorTest.java` | Registry/readiness/ingress regression tests | Unit only |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutorTest.java` | API_KEY fail-closed; TOKEN path regression | Synthetic secret marker; no network |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/execution/ExecutionRuntimeIntegrationTest.java` | Real DB single-attempt/no-fake-output regression | PostgreSQL/Rabbit Testcontainers |
| Thêm | `docs/work_logs/K/2026-09-23-workflow-service-task-15.md` | Work log | Không chứa secrets |
| Thêm | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-15-report.md` | Task 15 handoff | Coordinator owns global ledger/plan |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus impact | Upstream impact cho `NodeExecutorRegistry`, `HttpRequestNodeExecutor` và trigger/service seams | `UNKNOWN`; index storage v43/runtime v42, index cũ ba commits; CLI fallback `EPERM` | Caller chain được đọc thủ công; coordinator phải refresh/change-analyze trước commit |
| RED test | Workflow focused selector trước implementation | 18 tests, 12 failures, 0 errors | Đã chứng minh thiếu adapters, ingress và API_KEY fail-closed behavior |
| Focused combined Maven | Từ `services/workflow-service`, set `MAVEN_USER_HOME=C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home` và `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`; chạy `mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=UnavailableNodeExecutorTest,HttpRequestNodeExecutorTest,ExecutionRuntimeIntegrationTest#unavailableIntegrationFailsOnceInRealDatabaseWithoutPersistingOutput,WorkflowPublicationTest,WorkflowPublicationHttpTest,ScheduleTriggerTest,ScheduleConcurrencyTest test` | `BUILD SUCCESS`; 50 tests, 0 failures/errors/skips | Unit + Spring/PostgreSQL/Rabbit integration; không gọi external providers |
| Diff check | `git diff --check` | PASS, không whitespace errors | Git báo line-ending warnings cho hai shared application properties peer sửa |
| Workspace contract | Source search ở `WorkspaceClient`, `ResolveConnectionUseCase`, `HttpConnectionProvider` | Resolved API_KEY auth chỉ có `apiKey`; header name không qua API response | Không sửa Workspace và không xác thực provider thật |

### Điều chưa được kiểm tra

- Full combined Workflow suite sau Task 15/16 source changes do coordinator chạy kế tiếp.
- GitNexus index refresh và `detect_changes` do coordinator sở hữu.
- API_KEY execution chỉ được bật sau khi Workspace header-name contract được bổ sung và kiểm thử riêng.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact chưa giải quyết | Index/runtime version mismatch và CLI `EPERM` | Đối chiếu nguồn gọi bằng source search, giữ nguyên cảnh báo UNKNOWN | Coordinator refresh và chạy change detection |
| Thấp | API_KEY chưa thực thi được trong Workflow | Workspace resolved contract chưa gửi header name | Dừng trước outbound request với dependency code | Chỉ triển khai sau additive Workspace contract được duyệt |
| Thấp | Full suite sau ghép lanes chưa chạy ở worker này | Coordinator giữ bước suite tổng | Focused Task 15/16 50/50 đã xanh | Coordinator chạy full combined suite |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator chạy full Workflow suite sau khi xác nhận mọi lane source-stable.
2. Coordinator review diff và Task 15/16 acceptance, rồi cập nhật ledger/plan và quyết định milestone.
3. Trước commit, coordinator xử lý GitNexus refresh/change detection; worker không stage/commit.

### Cần quyết định / quyền truy cập từ người khác

- Workspace cần chấp thuận additive resolve response có non-secret `apiKeyHeaderName` trước khi HTTP `API_KEY` có thể thực thi.

### Hướng dẫn cho AI agent tiếp theo

- Giữ nguyên fail-closed default và không suy đoán `X-Api-Key` hoặc header khác.
- Không sửa Workspace contract trừ khi có quyết định mới; không biến `TelegramTriggerIngress` thành HTTP endpoint nếu chưa có Bot contract.
- Task 16 peer sở hữu schedule/publication/detail projection; Task 15 worker đã trả Maven slot.
- Coordinator owns full-suite run, global ledger/plan, GitNexus and commit decision.

## 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 15
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java`
- `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ResolveConnectionUseCase.java`
- `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/http/HttpConnectionProvider.java`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 12:37 Asia/Saigon` — sau focused verification và docs |
| Trạng thái worktree | Dirty shared checkout; Task 15/16 and earlier workflow lanes remain uncommitted |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 15 worker |
| Cần đọc trước khi tiếp tục | Mục 11 bàn giao; Task 15 scratch report; coordinator full-suite result |
