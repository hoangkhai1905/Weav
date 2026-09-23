# Nhật ký ngày `2026-09-23` — Workflow Service Task 18

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / chưa commit |
| Người thực hiện | Codex GPT-6 worker |
| Người review / nhận bàn giao | `/root` |
| Trạng thái cuối session | `OCR constructor/config regressions covered; focused OCR tests pass; Task 17 context test now reaches a separate webhook bean error` |
| Phạm vi session | Workflow OCR JWT, bounded private client, executor/config/tests và OCR contract docs. |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 18 |

## 2. Tóm tắt điều hành

### Kết quả chính

- Thêm `ocr.extract`, RS256 service JWT signer và private `POST /v1/extractions` client. Request chỉ chứa một source, mặc định `vi+en`/`detectTables=true`, UUID `X-Request-ID`, cùng `traceparent` hợp lệ nếu có.
- Giới hạn response ở 1 MiB, thời gian kết nối/đọc tối đa 5/30 giây, redirects bị tắt; kiểm tra response theo fixtures v1; lỗi không giữ provider body/cause; output đi qua `OutputSanitizer` với token và URL hiện hành.
- URL và artifact execution đều mặc định tắt và cần từng cờ xác minh riêng. Tài liệu ghi rõ OCR runtime hiện chưa xác minh JWT claims, còn tin `X-Workspace-ID`, tự sinh request ID thiếu, và khởi tạo `artifact_resolver=None`; không có production activation trong thay đổi này.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Compile | `PASS` | Latest focused Maven run biên dịch 152 production và 56 test source. |
| Unit / contract test | `PASS trong phạm vi OCR` | Latest run passed all 12 OCR tests; earlier representative `WorkflowPublicationTest` passed 13/13. Task 17 context selector exposed a separate webhook bean constructor error. |
| Migration / database | `Không áp dụng` | Không đổi schema hay migration. |
| Runtime OCR | `Chưa kiểm tra` | Không gọi OCR service; service-side verifier/allowlist/resolver còn là prerequisite. |
| Review thay đổi | `Đã kiểm tra` | OCR diff và `git diff --check`; GitNexus impact trên registry hiện hữu là `UNKNOWN`, được corroborate bằng source. |
| Commit / PR | `Chưa tạo` | Không stage/commit/push. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Tạo signer ngắn hạn với `iss=weav-workflow`, `aud=weav-ocr`, `scope=ocr:extract`, workspace, execution, node execution, `kid`, `iat`, `exp`, và `jti`.
2. Gọi đúng private extraction route với request/response được giới hạn và lỗi/credentials được xử lý an toàn.
3. Giữ URL/artifact gate đóng cho tới khi prerequisite phía OCR được xác minh độc lập; không phát minh artifact descriptor API.

### Trong phạm vi

- Workflow OCR infrastructure/client/executor/config và tests.
- OCR README/OpenAPI mô tả các claim và prerequisite runtime.
- Work log K và scratch handoff bị ignore.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa OCR runtime, `WorkflowPublicationService`, `ScheduleTriggerProcessor`, `SpringScheduleValidation`, Workflow OpenAPI, hay Task 17 files.
- Không thêm descriptor/download contract, OCR artifact resolver, `X-Workspace-ID` workaround, dependency, migration, hay production enablement.

### Tiêu chí hoàn thành

- [x] JWT signer và executor/client có contract tests.
- [x] Explicit Spring constructor selection; disabled OCR bean context and registry smoke test.
- [x] URL/artifact gates mặc định đóng; errors/output không tiết lộ token hay signed URL.
- [x] OCR docs nói rõ claim, request ID và prerequisite runtime còn thiếu.
- [x] `git diff --check` sạch, work log và ignored handoff sẵn sàng.
- [ ] Production OCR acceptance sau khi OCR verifier, URL allowlist và artifact resolver/contract được hoàn thành độc lập.

## 4. Bối cảnh và ràng buộc

- **Bối cảnh hệ thống:** Workflow `NodeExecutorRegistry` tự nhận `List<NodeExecutor>`; source xác nhận `ocr.extract` component được phát hiện mà không cần sửa registry. Node execution context cung cấp workspace/execution/node execution IDs nhưng không mang user token.
- **Nguồn sự thật:** Workflow V1 plan Task 18 và OCR contract README/OpenAPI; source trong OCR service được kiểm tra để phân biệt yêu cầu contract với khả năng runtime hiện tại.
- **Ràng buộc bảo mật:** Chỉ đọc khóa RSA PKCS#8 từ file local được mount, RSA tối thiểu 2048 bit; không log body/cause có thể chứa URL hoặc bearer token. Mọi gate mặc định `false`.
- **GitNexus:** Impact upstream cho `NodeExecutorRegistry` trả `UNKNOWN` do stored DB version 43 không khớp runtime 42. Source search/inspection xác nhận list injection, registry caller path và component registration; không coi empty graph là an toàn tuyệt đối.

## 5. Nhật ký theo session / thời gian

### Session 1 — 2026-09-23

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước 15:00 | Đọc Task 18, OCR contract/runtime, work log K và registry path | Xác nhận JWT/runtime gaps và artifact resolver chưa có; không sửa service OCR. | Xong |
| Trước 15:00 | Tạo JWT issuer, typed config, OCR RestClient và node executor | Executor yêu cầu `fileUrl` hoặc UUID `artifactId`; ký token mới cho mỗi lần thử. | Xong |
| Trước 15:00 | Thêm contract/JWT/executor tests và OCR docs | Tests bao gồm request headers/body, gates, response fixtures, lỗi, claim và key-source checks. | Xong |
| 15:03 | Chạy focused OCR Maven selectors | 11 tests passed; compile 152 source + 55 test source. | Xong |
| 15:04 | Chạy peer publication selector và static diff check | Peer báo 13 publication tests passed; `git diff --check` sạch, chỉ có cảnh báo line ending ở properties. | Xong |
| 15:26 | Sửa Spring bean constructor selection và thêm context smoke test | GitNexus impact của `OcrClient` là `UNKNOWN` do DB 43/runtime 42; source search xác nhận hai constructors và `@Component`, không có `@Autowired`. Annotated production constructor explicitly. | Xong |
| 15:27 | Chạy OCR, Spring smoke và representative Spring Boot selectors | `OcrClientSpringContextTest` và `WorkflowPublicationTest` cùng OCR selectors passed: 25 tests, 0 failures/errors/skips; compile 152 source + 56 test source. | Xong |
| 16:18 | Điền các OCR binding bắt buộc vào test properties và chạy Task 17 context selectors | OCR selectors passed 12/12. App contexts tiếp tục tới `WebhookIngressRateLimiter` rồi lỗi `No default constructor found`; không còn `OcrClientProperties.baseUrl` failure trong báo cáo hiện tại. | OCR xong; bàn giao blocker riêng |

### Diễn giải quan trọng

Workflow feature flags `WORKFLOW_OCR_SERVICE_CLAIMS_VERIFIED`, `WORKFLOW_OCR_URL_ALLOWLIST_VERIFIED`, và `WORKFLOW_OCR_ARTIFACT_RESOLVER_VERIFIED` là operator attestations, không phải phát hiện trạng thái OCR runtime. Hiện OCR runtime không đáp ứng các xác minh đó, vì vậy không được bật ở production. URL execution cần claim verification và allowlist; artifact execution còn cần contract descriptor/download đã duyệt, adapter resolver thực tế, ownership/expiry/download verification.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Tách gate theo OCR, URL source, artifact source và từng prerequisite | Một cờ global không chứng minh URL SSRF controls, claim verification hay resolver. | Một `enabled` flag duy nhất. | Tất cả giá trị mặc định `false`; cờ `verified` cần bằng chứng độc lập trước khi cấu hình. |
| Chỉ chấp nhận RSA PKCS#8 qua `file:` local URI, khóa >=2048 bit | Signing credential không được tải từ URL tùy ý; yếu tố khóa phải tương thích RS256 an toàn. | Cho Spring `ResourceLoader` chấp nhận mọi scheme. | Khóa production cần được mount; location sai trả `DEPENDENCY_NOT_CONFIGURED` an toàn. |
| Giữ artifact request shape nhưng khóa execution khi resolver chưa được chứng minh | OCR contract chưa có descriptor/download API; không được suy diễn một route từ `artifactId`. | Gọi thử bằng legacy workspace header hoặc tự định nghĩa endpoint. | Cấu hình vẫn kiểm tra được nhưng production activation chờ contract/resolver đã duyệt. |
| Giới hạn private response và chuyển lỗi sang failure code/safe message | OCR output và lỗi có thể chứa signed URL hoặc dữ liệu nhạy cảm. | Trả raw provider payload/body/cause cho execution log. | Response cap 1 MiB; JSON/schema bounds; không kèm cause hoặc body; output qua sanitizer. |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `OcrClientProperties` kiểm tra origin, timeout, TTL <=120s và max response <=1 MiB; `toString()` không lộ key reference.
- `WorkflowServiceJwtIssuer` ký RS256 mới cho mỗi lần gọi với `kid`, claims cố định, `iat`, TTL cấu hình mặc định 60s và unique `jti`. Khóa chỉ đọc từ file local PKCS#8; không cho network resource hoặc RSA <2048 bit.
- `OcrClientConfiguration` tắt redirects và giới hạn connect/read timeout. `OcrClient` gửi đúng `/v1/extractions`, Bearer service JWT, UUID `X-Request-ID`, optional valid `traceparent`, và JSON request contract. Không gửi `X-Workspace-ID`.
- Client kiểm tra input/source, response JSON/schemaVersion/requestId, document/text/blocks/tables/metadata bounds; phân loại retry chỉ cho lỗi transient và không đưa provider body/message vào failure.
- `OcrNodeExecutor` map `ocr.extract` config với đúng source discriminator, language và table option; token không thể lấy từ user input.

### 7.2. Dữ liệu, schema và migration

- Không đổi database, schema hoặc migration.

### 7.3. Cấu hình, hạ tầng và dependency

- `services/workflow-service/src/main/resources/application.properties`: thêm gates OCR false, private URL mặc định theo service discovery `http://ocr-service:8000`, key ID/location rỗng, timeout, TTL và response bound.
- `services/workflow-service/src/test/resources/application.properties`: tắt mọi OCR gate cho tests.
- Bổ sung test-only base URL, key placeholders, timeout, TTL và response cap vào test `application.properties`; file test thay thế/overlay cấu hình main khi chạy một số context.
- Không thêm Maven dependency; focused compile sử dụng JOSE/Jackson/Spring hiện có.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Private `POST /v1/extractions`, `application/json`; không đổi public Workflow API.
- **Security:** RS256 claims theo contract; không thay bằng Identity HMAC/user access token. OCR docs yêu cầu verifier lấy tenant từ claim đã xác minh và không tin `X-Workspace-ID`.
- **Lỗi:** Gate đóng trả `DEPENDENCY_NOT_CONFIGURED`, không retry; provider errors chỉ dùng allowlisted code, message tĩnh và retry status/classification.
- **Quan sát:** Không thêm log chứa request/response, token, key reference hoặc URL.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClient.java` | Bounded client, validation, error/output sanitation. | Private route only. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClientConfiguration.java` | HTTP client timeout, redirects disabled. | Dedicated bean. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrClientProperties.java` | Typed, bounded flags and settings. | All gate primitives default false. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/WorkflowServiceJwtIssuer.java` | RS256 service JWT. | Local PKCS#8 only. |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/ocr/OcrNodeExecutor.java` | `ocr.extract` adapter. | No descriptor API invented. |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/ocr/` | JWT, request/response and node config tests. | 11 focused tests. |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/ocr/OcrClientSpringContextTest.java` | Real Spring context resolves disabled OCR beans and registers `ocr.extract` in `NodeExecutorRegistry`. | Guards against constructor ambiguity. |
| `Sửa` | `services/workflow-service/src/main/resources/application.properties` | Append disabled OCR settings. | Shared file also contains other lanes' settings. |
| `Sửa` | `services/workflow-service/src/test/resources/application.properties` | Append OCR gate defaults. | Shared file also contains other lanes' settings. |
| `Sửa` | `packages/contracts/http/ocr/README.md` | Required claims and unresolved verifier/resolver prerequisites. | Does not claim runtime acceptance. |
| `Sửa` | `packages/contracts/http/ocr/openapi.yaml` | Auth and request ID descriptions. | No OCR runtime implementation change. |
| `Thêm` | `docs/work_logs/K/2026-09-23-workflow-service-task-18.md` | Session handoff. | This file. |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-18-report.md` | Short coordinator handoff. | Ignored by `.superpowers/sdd/.gitignore`. |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| OCR + context + publication | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC; mvn -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=OcrServiceJwtTest,OcrClientContractTest,OcrNodeExecutorTest,OcrClientSpringContextTest,WorkflowPublicationTest test` from `services/workflow-service` | `PASS`, 25 tests, 0 failures/errors/skips. | Includes actual `AnnotationConfigApplicationContext` bean/registry smoke and representative `@SpringBootTest`; compile 152 production + 56 test sources. OCR HTTP calls remain mocked. |
| OCR + Task 17 context rerun | `-Dtest=WebhookIngressTest,WorkflowPublicationHttpTest,OcrServiceJwtTest,OcrClientContractTest,OcrNodeExecutorTest,OcrClientSpringContextTest` | OCR selectors `PASS`, 12 tests; overall `FAIL` at `WebhookIngressRateLimiter` (`No default constructor found`) and subsequent `WorkflowPublicationHttpTest` context-failure threshold. | Test-property binding now supplies all required OCR fields; no OCR property error in this rerun. Task 17 worker owns the separate bean. |
| Static/diff | `git diff --check` | `PASS`; only LF-to-CRLF notices for the two shared properties files. | No stage/commit. |
| OCR OpenAPI parse | Python `yaml.safe_load` | Not available: PyYAML is not installed in the runner. | Description-only YAML edits inspected in diff; no parser claimed. |

### Điều chưa được kiểm tra

- Chưa kiểm tra live OCR request: current OCR source still lacks signature/claim validation and request-ID rejection, and trusts `X-Workspace-ID`.
- Chưa chạy allowed/disallowed URL end-to-end; current deployment-side allowlist prerequisite is not independently verified.
- Chưa chạy artifact extraction; OCR dependency wiring has no concrete resolver and the descriptor/download contract is intentionally undefined.
- Full Workflow suite and final integration acceptance remain root-owned.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Cao | OCR service verifier does not validate Workflow JWT claims. | Source inspection finds bearer presence check, trusted `X-Workspace-ID` context and generated ID when absent. | Keep `WORKFLOW_OCR_SERVICE_CLAIMS_VERIFIED=false`; no production activation. | OCR service owner hardens verifier and required request ID; root obtains independent evidence. |
| Cao | URL allowlist and artifact resolver prerequisites are not proven. | OCR dependency wiring uses `artifact_resolver=None`; service safe-fetch configuration has no verified configured allowed domains. | URL/artifact flags default false; docs explicitly prohibit inferred API/workaround. | OCR/service owners implement and verify allowlist, resolver, descriptor/download and ownership/expiry checks. |
| Trung bình | GitNexus upstream impact is `UNKNOWN`. | Index DB/runtime storage version mismatch. | Targeted source inspection confirmed registry discovery/call path; UNKNOWN retained as unresolved. | Root owns index refresh/change detection. |
| Thấp | Python YAML validation unavailable. | `yaml` module is not installed. | Manually reviewed the description-only YAML diff. | Run the repository contract parser/linter if available during root acceptance. |
| Resolved | Spring could not instantiate `OcrClient` in Boot contexts. | Root combined suite reported 106 Spring context errors across 342 tests; the reported cause was multiple unannotated constructors and no default constructor. | Marked the 4-argument production constructor `@Autowired`; the new context smoke and representative `WorkflowPublicationTest` passed. | Root reruns the full Workflow suite. |
| Resolved in OCR scope | Test context initially lacked required `OcrClientProperties` URI/duration/size fields. | `src/test/resources/application.properties` had OCR gate overrides but no full property set. | Added test-only URL, key placeholders, durations and max response size; OCR selectors passed. | None for OCR; Task 17 peer owns the next distinct `WebhookIngressRateLimiter` constructor error. |
| Trung bình / cross-lane | Task 17 HTTP context startup fails at webhook ingress limiter. | Latest Surefire cause is `WebhookIngressRateLimiter: No default constructor found`; this appears after OCR selectors pass. | Not changed by OCR worker; reported to Task 17 owner. | Task 17 worker to select its Spring constructor and rerun its acceptance tests. |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Root reviews OCR source and tests, then runs the full combined Workflow suite.
2. Keep all OCR gates false in production until OCR verifier, URL allowlist, and artifact resolver prerequisites are independently satisfied.
3. After OCR runtime changes land, run end-to-end accepted/rejected JWT, allowed/disallowed URL, and artifact ownership/expiry/download tests before considering activation.

### Cần quyết định / quyền truy cập từ người khác

- OCR runtime changes, allowlist setup and artifact descriptor/download contract remain outside this worker's scope and require their own review/acceptance.

### Hướng dẫn cho AI agent tiếp theo

- Read this log, Task 18 and current `git status` before editing; shared Workflow files include other workers' changes.
- Do not interpret the `*_VERIFIED` flags as automatic runtime checks or activate them without external evidence.
- Do not add a descriptor API or `X-Workspace-ID` workaround.

## 12. Tham chiếu

- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 18.
- `packages/contracts/http/ocr/README.md` and `packages/contracts/http/ocr/openapi.yaml`.
- `services/ocr-service/src/api/routes.py` and dependency wiring.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 16:19 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; có shared Workflow changes từ các lane khác. |
| Commit/PR đã tạo | Chưa tạo. |
| Người cập nhật log | Codex GPT-6 worker |
| Cần đọc trước khi tiếp tục | Mục 10–11; Task 18 production gates. |
