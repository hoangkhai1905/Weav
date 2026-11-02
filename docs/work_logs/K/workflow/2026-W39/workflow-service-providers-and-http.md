# Workflow Service V1 detailed record — providers and http

> Historical task notes recovered from commit 18b6dfa. The source records below retain their original decisions, file inventories, test commands, and handoff details. Their test counts are milestone snapshots; the final integrated release evidence is in workflow-service-v1.md.

Source notes are grouped here to keep the K folder navigable while retaining implementation detail.

---

### Source record: 2026-09-23-workflow-service-task-13.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | `Task 13 HTTP adapter recovery` |
| Người review / nhận bàn giao | `Coordinator / runtime peer` |
| Trạng thái cuối ngày | `Hoàn thành phần HTTP; chờ coordinator review/commit` |
| Phạm vi session | Khôi phục HTTP request executor, SSRF policy, pinned transport, sanitizer và test seam của Workflow Service |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 13 |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Khôi phục đầy đủ adapter `http.request` với URL/method/header/query/body validation, Workspace connection resolution ngay trước lần gọi, auth header chỉ nằm trong transport scope, phân loại 401/403/429/5xx và đóng credential holder sau request.
- Bổ sung policy SSRF fail-closed: chỉ HTTP(S), cấm userinfo/fragment/control/metadata, kiểm tra toàn bộ DNS answers gồm IPv4/IPv6/mapped addresses, và truyền tập địa chỉ đã kiểm tra vào Apache in-memory resolver.
- Bổ sung transport Apache HttpClient 5 có pinned DNS, redirect/retry/compression disablement, timeout/header/request/response bounds; output sanitizer đệ quy loại credential fields, scrub exact active secrets và signed URL query values.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Maven focused run compiled 137 main / 47 test sources |
| Unit / integration test | `PASS` | 38 tests: 26 policy, 3 sanitizer, 5 executor, 4 real transport |
| Migration / database | `Chưa áp dụng` | Task 13 HTTP lane không sửa schema |
| Health check | `Chưa kiểm tra` | Không khởi động service |
| Review thay đổi | `Đã kiểm tra` | GitNexus impact trước edit; source/manual caller corroboration; owned-file whitespace check PASS |
| Commit / PR | `Chưa tạo` | Coordinator owns detect-changes and commit decision |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Hoàn thiện các file HTTP còn thiếu của Task 13 từ phần partial source hiện có.
2. Giữ ranh giới Workspace credentials/runtime wiring; không sửa registry, application properties, ledger hoặc Task 14.
3. Có test deterministic DNS seam và real local HTTP server chứng minh socket dùng approved address.

##### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/**`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/**`
- Apache HttpClient 5 dependency trong Workflow POM do dependency này vắng mặt ở Workflow nhưng có ở Workspace.
- Task 13 K work log và scratch report.

##### Ngoài phạm vi / chủ động chưa làm

- Không sửa `NodeExecutorRegistry`, runtime worker, `application.properties`, test properties, Workspace contract, progress ledger hoặc plan.
- Không gọi provider thật, không tạo refresh protocol/provider mới, không sửa database/migration, không stage/commit/push.
- Không claim TLS certificate/pinning verification; real test dùng HTTP local với public original host và loopback approved address để chứng minh socket pinning.

##### Tiêu chí hoàn thành

- [x] Executor, policy, transport, sanitizer và bounded properties có implementation.
- [x] SSRF, redirect, timeout, size-bound, status classification, auth lifecycle và secret hygiene có test.
- [x] Focused Maven suite xanh và source-ready cho runtime peer.
- [ ] Coordinator chạy GitNexus `detect_changes` và quyết định commit sau khi ghép toàn bộ Task 10/11/13.

#### 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** HTTP test classes đã tồn tại nhưng production `OutputSanitizer`, executor, transport và properties còn thiếu. `WorkspaceConnectionPort` chỉ trả provider/authType/auth secrets trong `ResolvedConnection`, nên Workflow không tự đọc Workspace tables.
- **Quyết định:** `HttpRequestNodeExecutor` là Spring component có điều kiện `weav.workflow.http.executor.enabled` (mặc định bật), để runtime integration test có thể tắt adapter khi đăng ký deterministic test executor.
- **Quyết định:** auth hỗ trợ các mode HTTP đã có trong Workspace (`NONE`, `TOKEN`, `BASIC`, `API_KEY`); API key dùng header `X-Api-Key`, là header mặc định được dùng trong HTTP provider tests vì resolved V1 response không mang non-secret `apiKeyHeaderName`.
- **Ràng buộc:** Không đưa credential vào `NodeExecutor.Context`, output, exception message, log hoặc DTO; `ResolvedConnection` được đóng trước khi phân loại response/auth failure.
- **Nguồn sự thật:** Workflow Service V1 spec và Task 13 plan; Workspace HTTP pinned transport và connection provider hiện có.

#### 5. Nhật ký theo session / thời gian

##### Session `1` - `2026-09-23`

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Buổi sáng | Kiểm tra partial HTTP source, Workspace transport/auth contract, POM và test hiện có | Chỉ `OutboundTargetPolicy`/2 test tồn tại; Workflow thiếu Apache HttpClient 5 dependency | Xong |
| Buổi sáng | Chạy GitNexus upstream impact trước edit | New/partial Task 13 symbols target-not-found hoặc `UNKNOWN` trên index cũ; caller usage được corroborate bằng source search; fresh analyze kết thúc với EPERM ghi registry và vector/process truncation | Xong |
| Buổi sáng | Thêm bounded properties, sanitizer, pinned transport, executor; hoàn thiện policy component | Source Task 13 HTTP lane đầy đủ; executor conditional property không đụng runtime files | Xong |
| Buổi chiều | Mở rộng policy cases và thêm executor/real transport tests | Test cover private/loopback/link-local/metadata IPv4+IPv6/mapped, mixed DNS, auth status, redirect, oversize, timeout, host/pinned socket | Xong |
| `19:51 UTC` | Chạy focused Maven suite với UTC và local Maven repository sau encoded-control check | `BUILD SUCCESS`, 38 tests, 0 failures/errors | Xong |

##### Diễn giải quan trọng

Real transport test tạo URI host `public.example.test` nhưng approved address là loopback của local `HttpServer`; request đến đúng server và Host header vẫn giữ original hostname. Đây là bằng chứng socket pinning/DNS no-relookup ở HTTP test seam. TLS certificate verification/SNI chưa được chạy vì fixture không có certificate test.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Cài `InMemoryDnsResolver` mới cho từng request | Địa chỉ được policy kiểm tra được dùng trực tiếp bởi socket; Apache không tự lookup lần hai | Dùng default resolver sau policy sẽ mở lại DNS rebinding | Giữ original URI host cho Host/TLS; cần runtime smoke/HTTPS review riêng |
| Chặn credential-bearing inline headers và nhận auth từ connection | Definition/Task 13 yêu cầu Workspace-owned credentials | Cho caller tự gửi `Authorization`/cookie/token header sẽ phá boundary | API key header default là `X-Api-Key`; custom header name chưa thể truyền qua resolved V1 response |
| Tắt redirects/retries/compression | Redirect hop không thể bypass SSRF; response không bị unbounded decompression | Tự follow redirect sẽ phải re-approve mỗi hop, ngoài Task 13 V1 | 3xx trả lỗi non-retryable |
| Sanitize response data trước `NodeExecutor.Result` | Output là dữ liệu có thể được persistence layer ghi lại | Chỉ sanitize logs sẽ vẫn lưu secret trong node output | Headers không nằm trong canonical output `{status,data}` |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `HttpRequestNodeExecutor.java`: parse/validate resolved config, approve target trước credential resolve, runtime auth injection, Workspace error mapping, provider status classification, canonical output và holder close.
- `OutboundTargetPolicy.java`: Spring component/URI shape entrypoint; preserved DNS-address validation and added complete test matrix.
- `PinnedHttpTransport.java`: Apache HttpClient 5 method/body/query support, pinned resolver, bounds/timeouts, response decoding, disabled redirect/retry/compression and internal auth scope.
- `OutputSanitizer.java`: detached recursive JSON sanitizer with case-insensitive sensitive keys, exact active secret replacement, signed URL query redaction and bounded/cyclic values.
- `OutboundHttpProperties.java`: validated `weav.workflow.http` duration/body/header settings with bounded safe defaults.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không áp dụng.

##### 7.3. Cấu hình, hạ tầng và dependency

- Added `org.apache.httpcomponents.client5:httpclient5:5.6.1` to Workflow POM after verifying Workspace dependency exists and Workflow dependency was absent.
- Runtime peer should provide `weav.workflow.http.*` values through its owned application/test configuration; no secret values are required by this adapter.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Security:** SSRF policy rejects blocked literal/DNS destinations and all DNS answers are checked; user-controlled Host/content-length/connection framing and credential headers are rejected.
- **Validation/error response:** Stable `NodeExecutor.Failure` codes/messages only; 401 is `AUTHENTICATION_REJECTED`, 403 business response is `HTTP_BUSINESS_REJECTED`, 429 is retryable `HTTP_RATE_LIMITED`, and transport timeout/network/5xx are retryable.
- **Health/metrics/logging:** No new logging; raw downstream bodies/exceptions are not retained.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `services/workflow-service/pom.xml` | Thêm Apache HttpClient 5.6.1 | Dependency cần cho pinned transport |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/OutboundHttpProperties.java` | Bounded runtime settings | Spring `weav.workflow.http` prefix |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/OutboundTargetPolicy.java` | Component và public URI shape validation | Fail-closed DNS target policy |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/PinnedHttpTransport.java` | Real bounded Apache transport | Package auth entrypoint keeps credentials scoped |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/OutputSanitizer.java` | Recursive output sanitization | No input mutation |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutor.java` | `http.request` NodeExecutor | Conditional on executor enabled property |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/OutboundTargetPolicyTest.java` | Expanded SSRF/DNS cases | Deterministic resolver seam |
| `Giữ nguyên` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/OutputSanitizerTest.java` | Existing partial test preserved | Secret/signed URL assertions |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutorTest.java` | Executor/auth/status lifecycle tests | Fake transport and Workspace boundary |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/HttpTransportIntegrationTest.java` | Local real socket test | HTTP pinning evidence; no TLS claim |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Compile/build | `services/workflow-service: $env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'; .\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=OutboundTargetPolicyTest,OutputSanitizerTest,HttpRequestNodeExecutorTest,HttpTransportIntegrationTest' test` | `PASS`; Maven compiled 137 main and 47 test sources | Focused Workflow module only |
| Test | Same command | `PASS`; 38 tests, 0 failures/errors | Unit + local HTTP integration; no external provider |
| Static/diff check | `git diff --check`; owned-file trailing-whitespace scan | `PASS` | Untracked files checked by explicit scan; root shared worktree remains dirty by other lanes |
| GitNexus | Upstream impact before edits; direct fresh analyze attempt | Impact for new/stale symbols `UNKNOWN`/target-not-found; fresh analyze ended EPERM writing `C:\Users\nhoan\.gitnexus\registry.json.tmp...` and reported truncation/vector fallback | Coordinator must refresh/corroborate and run detect-changes before commit |

##### Điều chưa được kiểm tra

- Full combined Workflow suite and runtime integration after the final HTTP source change are coordinator/runtime-peer responsibilities and must run serialized.
- No HTTPS certificate/SNI test; transport preserves original URI hostname, but TLS evidence is not claimed.
- No live Workspace/provider call; tests use the documented port seam and synthetic credentials only.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus fresh index unavailable | Direct analyzer completed graph work but failed EPERM writing global registry; index remains stale/partial | Preserved UNKNOWN warning and manually corroborated source callers | Coordinator refreshes index and runs detect-changes before commit |
| Thấp | Custom API key header name unavailable in Workflow resolve response | Workspace resolved V1 response returns provider/authType/auth only | Uses existing HTTP provider default `X-Api-Key`; do not infer other header names | Future additive Workspace contract if custom header execution is required |
| Thấp | TLS evidence absent | Local fixture is HTTP-only | Report explicitly limits claim to approved-address socket pinning | Add controlled HTTPS fixture before production TLS claim |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Runtime peer/coordinator reviews the owned HTTP files and keeps `weav.workflow.http.executor.enabled=false` in deterministic runtime integration properties.
2. Coordinator runs serialized runtime/full Workflow suites, reviews combined diff, refreshes GitNexus, runs `detect_changes`, and decides commit.

##### Cần quyết định / quyền truy cập từ người khác

- Decide whether the current Workspace V1 resolve contract should later carry non-secret `apiKeyHeaderName`; Task 13 does not invent or modify that contract.

##### Hướng dẫn cho AI agent tiếp theo

- Read this log, Task 13 plan/spec and `git status` before editing.
- Do not alter runtime/config/ledger files in this lane; do not stage or commit these shared changes.
- Treat GitNexus UNKNOWN/stale output as unresolved until coordinator corroborates it.
- Do not add secrets or raw provider diagnostics to tests/logs.

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 02:52 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; HTTP source/tests/POM và shared changes từ các lane khác |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | `Task 13 HTTP adapter recovery` |
| Cần đọc trước khi tiếp tục | Task 13 plan/spec, phần 11 bàn giao, runtime completion log |
---

### Source record: 2026-09-23-workflow-service-task-14.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex Task 14 Google Sheets worker |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | `Sẵn sàng bàn giao` — triển khai và kiểm thử trọng tâm đã hoàn tất; provider smoke không chạy vì thiếu fixture được xác nhận |
| Phạm vi session | Google Sheets read, append, update adapter và kiểm thử wire contract |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 14 |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Đã thêm executor `google.sheets` dùng connection UUID literal và credential OAuth do Workspace resolve.
- Đã thêm client cho Sheets values `get`, `append`, và `update`, với host cố định và mã hóa path segment.
- Đã thêm test executor và wire contract; kết quả Maven chưa có vì đang chờ HTTP assurance worker bàn giao transport source-ready và lượt kiểm tra tuần tự.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | Thành công | Biên dịch Workflow module qua focused Maven run. |
| Unit / integration test | Thành công | Sheets 15/15 và HTTP transport 11/11; tổng 26 test, không failure/error/skip. |
| Migration / database | Không áp dụng | Task 14 không thay đổi schema. |
| Provider smoke | Chưa kiểm tra | Chưa có test spreadsheet/credential được xác nhận trong cấu hình an toàn. |
| Review thay đổi | Sẵn sàng review | Thêm hai lớp Sheets, hai test; không sửa registry hiện có. |
| Commit / PR | Chưa tạo | Không stage, commit, push hoặc merge. |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Thực thi Google Sheets `read`, `append`, và `update` qua Workspace credential resolution.
2. Bảo toàn kiểu JSON của cell values, mã hóa spreadsheet ID/range thành các path segment, và trả về JSON đã khử secret.
3. Phân loại lỗi provider theo Task 11 và bàn giao bằng chứng kiểm tra không chứa credential.

##### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsClient.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutor.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsContractTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutorTest.java`
- Work log K và scratch report Task 14.

##### Ngoài phạm vi / chủ động chưa làm

- HTTP transport/policy/sanitizer dùng chung thuộc quyền sở hữu của HTTP assurance worker.
- README provider smoke procedure thuộc Task 21.
- Workspace OAuth refresh, scope mới, provider SDK, endpoint mới, idempotency header, migration, và mọi Task sau 14.
- Plan/progress ledger, commit, push, worktree, hoặc external agent.

##### Tiêu chí hoàn thành

- [x] Chạy `GoogleSheetsNodeExecutorTest` và `GoogleSheetsContractTest` sau khi shared transport source-ready.
- [x] Xác nhận fixed Google host, đúng phương thức/path/query/body, bearer auth chỉ từ Workspace, sanitizer và status policy.
- [x] Ghi rõ giới hạn provider smoke khi chưa có test spreadsheet được cấu hình.
- [x] `git diff --check` sạch và cập nhật scratch report trước khi bàn giao.

#### 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** `NodeExecutorRegistry` nhận danh sách bean `NodeExecutor`; Task 14 đăng ký adapter bằng Spring `@Component`, không sửa registry.
- **Hợp đồng Workspace:** `WorkspaceClient` chỉ trả provider/authType/auth đã xác thực; test hiện có ghi nhận `GOOGLE_SHEETS`, `OAUTH2`, và duy nhất `accessToken`. Executor resolve lại mỗi lần được gọi và đóng `ResolvedConnection` sau request.
- **Giao thức Google:** Đã làm mới kiểm tra các trang chính thức `spreadsheets.values.get`, `append`, `update`, và `ValueInputOption`. Đọc dùng GET; append POST với hậu tố `:append`; update PUT; ghi dùng `valueInputOption=RAW`, `majorDimension=ROWS`.
- **Quyết định:** `GoogleSheetsClient` gọi API shared transport chỉ với URI được tạo từ host cố định, method, query/body có kiểu, và access token. Shared transport sở hữu phê duyệt target/DNS pin và thêm Bearer header; caller không thể chuyển header tuỳ ý.
- **Quyết định:** Chỉ báo `AUTHENTICATION_REJECTED` cho Workspace khi provider trả 401 đã xác nhận. 403 là business rejection; 429 và timeout/5xx retryable theo Task 11.
- **Rủi ro:** Append có thể tạo dòng trùng khi provider đã xử lý request nhưng response bị mất trước retry; không tuyên bố exactly-once và không thêm idempotency header không có trong Google API.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — 2026-09-23

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Khảo sát | Đọc AGENTS, Task 14 plan/spec, progress và Task 13 handoff | Giới hạn Task 14 và quyền sở hữu shared transport được xác định | Xong |
| Impact | Chạy GitNexus impact cho `NodeExecutorRegistry` | `risk: UNKNOWN`; truy vấn lỗi vì storage version mismatch (index version 43, runtime version 42) | Xong |
| Corroborate | Đọc source caller/wiring | Registry nhận `List<NodeExecutor>`; `NodeAttemptRunner` dispatch bằng `registry.require(nodeType)`; Google node type đã được catalog hóa | Xong |
| Contract | Xác minh Google REST contract qua tài liệu chính thức | Đã xác nhận GET/POST/PUT, path, `RAW`, scope spreadsheets | Xong |
| Implementation | Tạo executor/client và test trong package sở hữu | 4 file Task 14 mới; Spring component scan test xác nhận registry bean nhận `google.sheets` | Xong |
| Verification | Chạy focused HTTP + Sheets tests sau handoff transport | 26 test, 0 failure/error/skip; `BUILD SUCCESS` | Xong |
| Handoff docs | Cập nhật work log và scratch report sau `git diff --check` | Provider smoke được đánh dấu chưa chạy do thiếu fixture được xác nhận | Xong |

##### Diễn giải quan trọng

`NodeExecutorRegistry` và `NodeAttemptRunner` không bị sửa. GitNexus index cũ hơn checkout và impact walk thất bại do không tương thích storage; caller chain được đọc trực tiếp trong source. Coordinator sở hữu refresh index và graph review trước commit.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Workspace giữ credential; mỗi node attempt resolve mới | Port hiện có cung cấp `ResolvedConnection` closeable; Google resolver contract là `GOOGLE_SHEETS/OAUTH2/accessToken` | Lưu token hoặc tự refresh trong Workflow | Không lưu/refresh token; kiểm tra resolve mới giữa các lần gọi |
| Ghi dùng RAW và rows | Google API xác nhận RAW giữ cell data nguyên dạng; Task 14 yêu cầu giữ kiểu cell JSON | USER_ENTERED hoặc SDK | Không diễn giải chuỗi như công thức/ngày; không thêm SDK |
| Endpoint host bị cố định | Sheets client tạo đúng `sheets.googleapis.com`; shared transport kiểm tra host, DNS và pin địa chỉ | Dùng URL cấu hình từ node | Không cho node điều khiển host hoặc header |
| Output là JSON API map sau sanitizer | Interface Task 14 trả về map thực từ provider và node result phải sanitized | Bọc status/data như HTTP node | Error body không đi vào failure/output; result giữ dữ liệu API hợp lệ |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- Thêm `GoogleSheetsNodeExecutor`: parse operation, ID, range, UUID literal và write rows; resolve Workspace connection mỗi invocation; gọi read/append/update; đóng holder trong `finally`; sanitizer trước `NodeExecutor.Result`; chỉ báo auth-failure với provider 401.
- Thêm `GoogleSheetsClient`: mã hóa UTF-8 path segments, tạo URI trên host Google cố định, dùng contract read/append/update; xác nhận Workspace provider/auth type và đúng `accessToken`; ghi `ValueRange` theo ROWS với scalar JSON cell values; phân loại 401/403/429/408/5xx/redirect và invalid response mà không giữ body lỗi.
- Không sửa domain/application/Workspace API hoặc shared HTTP transport trong lane này.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không có.
- **Dữ liệu seed/test:** Chỉ giá trị tổng hợp trong unit test; không có provider data.
- **Tính tương thích:** Node type `google.sheets` và cấu hình connection/operation/spreadsheetId/range/values đã có trong catalog/validator.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm biến môi trường hay dependency.
- Không nhận OAuth refresh token; không mở scope mới.
- Shared transport API mới do HTTP assurance worker sở hữu; signature được phối hợp trực tiếp.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Gọi Google Sheets values REST API hiện có; không thay đổi API public/internal của Weav.
- **Security:** Chỉ dùng Workspace `GOOGLE_SHEETS/OAUTH2` credential; Bearer header được shared transport thêm; destination cố định và transport kiểm soát DNS/pinning.
- **Validation/error response:** 401 authentication rejected; 403 business rejected; 429 retryable rate limit; 408/5xx retryable dependency; 3xx không follow và non-retryable; thông điệp lỗi không giữ body provider.
- **Health/metrics/logging:** Không thêm logging.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsClient.java` | Gọi Google values API bằng controlled transport | Credential chỉ được đọc từ `ResolvedConnection` |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutor.java` | Đăng ký `google.sheets` executor | Cần review sanitizer/error mapping |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsContractTest.java` | Wire method/path/query/body/error tests | Dùng transport double, không gọi provider thật |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutorTest.java` | Config/resolve/close/retry/sanitize/registry tests | Chỉ dùng synthetic credentials |
| Thêm | `docs/work_logs/K/2026-09-23-workflow-service-task-14.md` | Work log Task 14 | Ghi rõ bằng chứng/giới hạn |
| Thêm | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-14-report.md` | Worker handoff evidence | Coordinator sở hữu plan/progress ledger |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus impact | `mcp__gitnexus__impact(repo="Weav", target="NodeExecutorRegistry", direction="upstream")` | `UNKNOWN`; store version mismatch `43` vs `42` | Registry không bị sửa; source callers được corroborate thủ công; index refresh/deep graph check thuộc coordinator |
| Google protocol | Mở tài liệu chính thức values.get/append/update/ValueInputOption | Xác nhận method, path, RAW và scope | Chỉ xác nhận protocol contract; không gọi Google thật |
| Focused Maven tests | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`; `MAVEN_USER_HOME=C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home`; `.\mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=HttpTransportIntegrationTest,GoogleSheetsNodeExecutorTest,GoogleSheetsContractTest test` | 26 test; 0 failures/errors/skips; `BUILD SUCCESS` | Chạy tuần tự sau shared transport source-ready; có cả HTTP transport integration và hai Task 14 suites |
| Static/diff check | `git diff --check` và whitespace scan file sở hữu | Sạch | Chỉ xác nhận diff/whitespace, không thay thế Maven test |
| Provider smoke | Chưa chạy | Chưa có test spreadsheet/credential được cấp xác nhận | Không đọc `.env`/secret store và không dùng spreadsheet không rõ quyền |

##### Điều chưa được kiểm tra

- Không còn kiểm tra deterministic nào đang chờ trong lane Task 14.
- Live provider smoke read/append/update/readback chưa chạy; không có spreadsheet test resource/credential được xác nhận trong task context.
- Append at-least-once uncertainty remains; no exactly-once guarantee.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact UNKNOWN | Index storage version 43 không đọc được bởi runtime version 42; index 3 commits behind | Không coi UNKNOWN là low; source-search caller chain được xác nhận | Coordinator rebuild/corroborate và chạy detect-changes trước commit |
| Thấp | Real Sheets provider chưa xác minh | Chưa có test spreadsheet/Workspace credentials được xác nhận | Không gọi provider; chỉ tuyên bố protocol/unit evidence | Coordinator ghi provider-smoke blocked nếu vẫn thiếu cấu hình |
| Thấp | Append có thể lặp sau request ambiguity | Provider có thể đã ghi row trước khi response mất | Không thêm retry logic/idempotency header; không claim exactly-once | Nêu rõ trong acceptance/handoff |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator review code, work log, scratch report và kết quả focused Maven run.
2. Nếu coordinator xác nhận có test spreadsheet/connection được cấp rõ ràng, chạy provider smoke theo Task 14; nếu không, giữ trạng thái smoke blocked.
3. Coordinator sở hữu graph refresh/change detection và quyết định milestone tiếp theo.

##### Cần quyết định / quyền truy cập từ người khác

- Live provider smoke cần spreadsheet thử nghiệm riêng và Workspace connection test credentials được xác nhận; nếu không có, không thực hiện.

##### Hướng dẫn cho AI agent tiếp theo

- Chỉ sửa các file Task 14 thuộc sở hữu lane này; shared HTTP transport/policy/sanitizer thuộc HTTP assurance worker.
- Dùng Maven theo lượt đã điều phối; không chạy song song với runtime/HTTP worker.
- Không đọc `.env`/secret stores; không stage, commit, push, tạo worktree hoặc chạy task kế tiếp.
- Coordinator giữ quyền cập nhật plan/progress ledger, GitNexus re-index/change detection và quyết định commit.

#### 12. Tham chiếu

- [Google Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Google Sheets values.append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- [Google Sheets values.update](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update)
- [Google Sheets ValueInputOption](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption)
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/workspace/WorkspaceClientTest.java`

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23` — sau focused verification và diff check |
| Trạng thái worktree | Dirty shared worktree; Task 14 files untracked cùng Tasks trước đó |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 14 Google Sheets worker |
| Cần đọc trước khi tiếp tục | Task 14 plan, HTTP source-ready note, phần 11 bàn giao |
---

### Source record: 2026-09-23-workflow-service-task-15.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Đăng ký adapter không retryable cho `email.send`, `telegram.send_message`, `ai.extract`, `ai.classify`, và `ai.summarize`. Các node giữ cấu hình/kiểu output trong catalog, nhưng không tạo kết quả giả hoặc gọi provider chưa được duyệt.
- Thêm readiness server-owned cho các action trên và `trigger.telegram`; thêm `TelegramTriggerIngress` ở application port, không định nghĩa endpoint hay normalized payload contract.
- Chặn `API_KEY` của HTTP node bằng `DEPENDENCY_NOT_CONFIGURED` cho đến khi Workspace response có header name được cấu hình. Không thêm default `X-Api-Key` và không sửa Workspace contract.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Maven biên dịch Workflow module trong focused run. |
| Unit / integration test | `PASS` | 50/50 focused tests; gồm PostgreSQL/Rabbit thật cho unsupported nodes và scanner. |
| Migration / database | Không áp dụng | Lane này không sửa schema hoặc migration. |
| External provider | Chưa chạy | Không có provider/credential call; các adapter bị chặn trước external call. |
| Review thay đổi | Đã kiểm tra | Source caller đã đối chiếu thủ công do GitNexus `UNKNOWN`; `git diff --check` không có lỗi. |
| Commit / PR | Chưa tạo | Không stage, commit, push hoặc merge. |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Làm rõ trạng thái unavailable của các action Email, Telegram và AI mà không bịa provider/auth/endpoint contract.
2. Đảm bảo chạy các node đó tạo một failed attempt không retry, không external call và không fake output; manual admission vẫn khả dụng.
3. Chặn HTTP `API_KEY` cho đến khi Workspace cung cấp `apiKeyHeaderName` trong resolved response; không tự suy đoán header.

##### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/application/node/UnavailableNodeExecutor.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/node/IntegrationReadiness.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/node/NodeExecutorRegistry.java`
- `services/workflow-service/src/main/java/com/weav/workflow/application/port/in/TelegramTriggerIngress.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutor.java`
- Task 15, API_KEY và real-runtime regression tests; K work log và scratch report.

##### Ngoài phạm vi / chủ động chưa làm

- Không thêm Gmail send scope/provider, Telegram Bot API, AI endpoint, credential/auth protocol, hoặc webhook HTTP route/DTO.
- Không thêm Workspace response field `apiKeyHeaderName`; chưa có hợp đồng additive được chấp thuận.
- Không sửa Workflow OpenAPI, schedule/publication source thuộc peer, plan/progress ledger thuộc coordinator, migration, hoặc deployment config.
- Không stage, commit, push, tạo worktree, hay gọi provider thật.

##### Tiêu chí hoàn thành

- [x] Năm action integration báo `DEPENDENCY_NOT_CONFIGURED`, non-retryable và không tạo output giả.
- [x] Telegram trigger có readiness unavailable và application-only ingress đóng fail-closed; persisted registration hiển thị disabled cùng reason code qua Task 16 detail path.
- [x] HTTP `API_KEY` bị chặn trước outbound transport; không lộ secret; `TOKEN` bearer path vẫn hoạt động.
- [x] Focused Task 15/API_KEY + Task 16 selectors xanh và log/scratch report được cập nhật.
- [ ] Coordinator chạy full combined Workflow suite và GitNexus change analysis trước milestone/commit decision.

#### 4. Bối cảnh và quyết định

- **Workspace API_KEY contract:** `WorkspaceClient` chỉ chấp nhận resolved response gồm `provider`, `authType`, `auth`; `AUTH_FIELDS` cho `API_KEY` chỉ chứa `apiKey`. `ResolveConnectionUseCase` cũng trả đúng map `{apiKey}`. `apiKeyHeaderName` tồn tại trong cấu hình/provider nội bộ của Workspace, nhưng không có trong resolved API response Workflow nhận được.
- **Quyết định API_KEY:** Trả `DEPENDENCY_NOT_CONFIGURED`, `retryable=false`, trước `PinnedHttpTransport.executeWithAuthentication`. Không phát header mặc định. Sau này chỉ hỗ trợ khi resolved contract additive cung cấp header name đã được Workspace xác thực.
- **Unavailable actions:** Giữ node catalog/config và output docs hiện tại; adapter là fail-closed, không tạo message ID, AI result hoặc output giả. `NodeExecutorRegistry` thêm fallback cho năm type nhưng cho phép adapter bean cụ thể đã đăng ký thay thế.
- **Telegram trigger:** `IntegrationReadiness.forType` báo dependency chưa cấu hình. `TelegramTriggerIngress` nhận normalized value như application boundary, nhưng unconfigured implementation luôn ném exception an toàn; không có HTTP ingress hay normalization DTO.
- **GitNexus:** Impact walk trả `UNKNOWN` do index database storage v43, runtime v42, index cũ ba commits. CLI fallback không chạy được do `EPERM` khi resolve `C:\Users\nhoan`. Theo quy định, không coi đây là all-clear; nguồn gọi được xác minh bằng source search và coordinator giữ trách nhiệm refresh/change analysis.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — `2026-09-23`

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

##### Diễn giải quan trọng

Runtime integration test lưu “không có output” dưới dạng empty JSON object (`{}`), vì `JsonValues.freezeMap(null)` chuẩn hóa map tùy chọn thành `Map.of()`. Test xác minh `{}` ở node và attempt, không chấp nhận provider/message/AI payload giả.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng `UnavailableNodeExecutor` rõ ràng cho từng node type | Catalog đã chấp nhận config, nhưng provider contract chưa sẵn sàng | Trả `Result` rỗng hoặc fake success sẽ gây hiểu nhầm và có thể làm downstream chạy sai | Có thể thay thế fallback khi integration thực được phê duyệt |
| Readiness do server quyết định theo type | Node config không thể tự khai báo integration đã cấu hình | Tin config của workflow sẽ cho phép giả readiness | Trigger Telegram luôn disabled cho đến khi integration được duyệt |
| API_KEY bị chặn vì resolved response thiếu header name | Workflow không thể biết header hợp lệ mà không đoán | Dùng `X-Api-Key` mặc định không được phép theo quyết định 2026-09-23 | Cần Workspace additive contract trước khi bật mode này |
| Giữ `TOKEN`/`BASIC` và denylist inline credential header | Chỉ API_KEY default mapping bị gỡ; các mode có contract vẫn giữ | Chặn mọi HTTP auth would break existing behavior | Bearer regression tiếp tục pass |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `UnavailableNodeExecutor`: chỉ nhận năm node type được liệt kê; luôn ném `DEPENDENCY_NOT_CONFIGURED`, `retryable=false`, message cố định và không có output/provider call.
- `NodeExecutorRegistry`: thêm fallback executor nếu chưa có executor cụ thể được inject.
- `IntegrationReadiness`: trả readiness false cùng `DEPENDENCY_NOT_CONFIGURED` cho năm action và `trigger.telegram`; `trigger.manual` tiếp tục ready.
- `TelegramTriggerIngress`: application port nhận trigger ID và normalized input; `unconfigured()` ném `TriggerDependencyUnavailableException`; không tạo transport contract.
- `HttpRequestNodeExecutor`: nhánh `API_KEY` dừng fail-closed trước transport, không sinh default header; existing `finally` đóng `ResolvedConnection`.
- Integration tests xác minh một attempt duy nhất, dependency error code, output rỗng `{}` ở node/attempt, và deterministic fake executor không được gọi. Unit tests xác minh `API_KEY` không gọi transport, không báo auth failure, không lộ secret và đóng holder.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không sửa schema.
- **Migration:** Không có.
- **Dữ liệu test:** Chỉ config/credential markers tổng hợp; không có provider data.
- **Tương thích:** Node catalog và typed config/output docs không bị đổi. Workflow runtime lỗi an toàn ở một attempt cho action chưa triển khai.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm dependency, biến môi trường, OAuth scope hoặc secret.
- Không sửa Workspace service/API contract.
- Focused integration tests dùng PostgreSQL/Rabbit Testcontainers; adapter tests dùng deterministic transport/Workspace seam.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không thêm route cho Telegram ingress; Task 16 bổ sung trigger detail projection như thay đổi additive ở lane riêng.
- **Security:** API key secret không vào header, error, output hoặc log; resolved credential holder đóng ngay cả nhánh fail-closed.
- **Failure:** Unsupported action/API_KEY trả `DEPENDENCY_NOT_CONFIGURED`, không retry; API_KEY không làm auth-failure report vì chưa gửi request.
- **Health/logging:** Không thêm logging.

#### 8. Danh sách file ảnh hưởng

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

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus impact | Upstream impact cho `NodeExecutorRegistry`, `HttpRequestNodeExecutor` và trigger/service seams | `UNKNOWN`; index storage v43/runtime v42, index cũ ba commits; CLI fallback `EPERM` | Caller chain được đọc thủ công; coordinator phải refresh/change-analyze trước commit |
| RED test | Workflow focused selector trước implementation | 18 tests, 12 failures, 0 errors | Đã chứng minh thiếu adapters, ingress và API_KEY fail-closed behavior |
| Focused combined Maven | Từ `services/workflow-service`, set `MAVEN_USER_HOME=C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home` và `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`; chạy `mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=UnavailableNodeExecutorTest,HttpRequestNodeExecutorTest,ExecutionRuntimeIntegrationTest#unavailableIntegrationFailsOnceInRealDatabaseWithoutPersistingOutput,WorkflowPublicationTest,WorkflowPublicationHttpTest,ScheduleTriggerTest,ScheduleConcurrencyTest test` | `BUILD SUCCESS`; 50 tests, 0 failures/errors/skips | Unit + Spring/PostgreSQL/Rabbit integration; không gọi external providers |
| Diff check | `git diff --check` | PASS, không whitespace errors | Git báo line-ending warnings cho hai shared application properties peer sửa |
| Workspace contract | Source search ở `WorkspaceClient`, `ResolveConnectionUseCase`, `HttpConnectionProvider` | Resolved API_KEY auth chỉ có `apiKey`; header name không qua API response | Không sửa Workspace và không xác thực provider thật |

##### Điều chưa được kiểm tra

- Full combined Workflow suite sau Task 15/16 source changes do coordinator chạy kế tiếp.
- GitNexus index refresh và `detect_changes` do coordinator sở hữu.
- API_KEY execution chỉ được bật sau khi Workspace header-name contract được bổ sung và kiểm thử riêng.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact chưa giải quyết | Index/runtime version mismatch và CLI `EPERM` | Đối chiếu nguồn gọi bằng source search, giữ nguyên cảnh báo UNKNOWN | Coordinator refresh và chạy change detection |
| Thấp | API_KEY chưa thực thi được trong Workflow | Workspace resolved contract chưa gửi header name | Dừng trước outbound request với dependency code | Chỉ triển khai sau additive Workspace contract được duyệt |
| Thấp | Full suite sau ghép lanes chưa chạy ở worker này | Coordinator giữ bước suite tổng | Focused Task 15/16 50/50 đã xanh | Coordinator chạy full combined suite |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator chạy full Workflow suite sau khi xác nhận mọi lane source-stable.
2. Coordinator review diff và Task 15/16 acceptance, rồi cập nhật ledger/plan và quyết định milestone.
3. Trước commit, coordinator xử lý GitNexus refresh/change detection; worker không stage/commit.

##### Cần quyết định / quyền truy cập từ người khác

- Workspace cần chấp thuận additive resolve response có non-secret `apiKeyHeaderName` trước khi HTTP `API_KEY` có thể thực thi.

##### Hướng dẫn cho AI agent tiếp theo

- Giữ nguyên fail-closed default và không suy đoán `X-Api-Key` hoặc header khác.
- Không sửa Workspace contract trừ khi có quyết định mới; không biến `TelegramTriggerIngress` thành HTTP endpoint nếu chưa có Bot contract.
- Task 16 peer sở hữu schedule/publication/detail projection; Task 15 worker đã trả Maven slot.
- Coordinator owns full-suite run, global ledger/plan, GitNexus and commit decision.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 15
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java`
- `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/ResolveConnectionUseCase.java`
- `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/provider/http/HttpConnectionProvider.java`

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 12:37 Asia/Saigon` — sau focused verification và docs |
| Trạng thái worktree | Dirty shared checkout; Task 15/16 and earlier workflow lanes remain uncommitted |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 15 worker |
| Cần đọc trước khi tiếp tục | Mục 11 bàn giao; Task 15 scratch report; coordinator full-suite result |
---

### Source record: 2026-09-23-workflow-http-assurance.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | `Task 13 HTTP assurance` |
| Người review / nhận bàn giao | `Coordinator; Task 14 Sheets peer` |
| Trạng thái cuối ngày | `Đã kiểm tra; chờ coordinator review và quyết định contract` |
| Phạm vi session | Bổ sung bằng chứng HTTPS/TLS, deadline toàn cuộc gọi, giới hạn parser headers và điểm vào OAuth tin cậy cho HTTP transport |
| Liên kết liên quan | `docs/superpowers/specs/workflow-service-spec.md`, `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 13 report |

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Bổ sung HTTPS integration fixture dùng CA test được tin cậy riêng, xác nhận SNI, `Host`, xác thực certificate và từ chối certificate có SAN không khớp hostname gốc. Production vẫn dùng trust store và hostname verification mặc định; SSL context tùy chỉnh chỉ có ở constructor package-private dùng trong test.
- Bảo đảm deadline tuyệt đối bằng cách hủy request sau `callTimeout`, ngoài response idle timeout; thêm regression với response nhỏ giọt liên tục. Request JSON được serialize vào buffer có giới hạn; parser response có giới hạn số header/dòng và tổng header, body không tự giải nén, redirect/retry tiếp tục bị tắt.
- Mở API vận chuyển Google Sheets với Bearer token nội bộ: chỉ HTTPS `sheets.googleapis.com:443` trên đường dẫn Sheets, tự approve/pin DNS và tự thêm `Authorization`; không nhận headers của user. Basic auth-derived value được thêm vào bộ secret scrub.
- Test suite tập trung kết hợp HTTP + Sheets: `62` tests, `0` failures/errors/skips, `BUILD SUCCESS`.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Maven compiled 139 main / 49 test sources |
| Unit / integration test | `PASS` | 62 focused HTTP/policy/sanitizer/executor/Sheets tests |
| Migration / database | `Chưa áp dụng` | Không thay đổi schema |
| Health check | `Chưa kiểm tra` | Không khởi động service |
| Review thay đổi | `Đã kiểm tra` | GitNexus UNKNOWN được corroborate bằng source search; `git diff --check` và whitespace scan sạch |
| Commit / PR | `Chưa tạo` | Coordinator quyết định detect-changes/commit |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Đưa HTTP transport assurance từ fixture HTTP sang HTTPS có certificate và hostname proof thực tế.
2. Kiểm tra deadline toàn cuộc gọi và resource bounds của DNS, request/response bodies, headers, decompression và redirects.
3. Cung cấp entrypoint xác thực an toàn tối thiểu cho Sheets peer mà không bỏ qua DNS policy hoặc nhận user headers.

##### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/**`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/**`
- `services/workflow-service/src/test/resources/http-transport-tls/**`
- Task 13 assurance work log và scratch report.

##### Ngoài phạm vi / chủ động chưa làm

- Không sửa Workspace API/config, runtime registry/config, entity, plan, ledger hoặc Task 14 source/tests.
- Không gọi provider thật, không thêm auth/refresh protocol, không stage/commit/push.
- Không tuyên bố custom API key header được hỗ trợ: Workspace resolve contract vẫn chỉ trả `provider`, `authType`, `auth`; tên `apiKeyHeaderName` không được resolve.

##### Tiêu chí hoàn thành

- [x] Có HTTPS fixture tin CA riêng, xác nhận SNI/Host và từ chối sai hostname.
- [x] Có regression test deadline tuyệt đối, DNS timeout, request/response/body/header bounds, không giải nén, không follow redirect và secret redaction.
- [x] Có safe Sheets OAuth transport entrypoint; không nhận user headers và tự approve/pin DNS.
- [x] Chạy suite HTTP + Sheets và ghi số test thực tế.
- [ ] Coordinator xác nhận hướng xử lý API key custom-header gap và chạy GitNexus `detect_changes` trước commit.

#### 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** Task 13 trước đây có 38 tests và local HTTP pinning fixture, nhưng chưa có bằng chứng HTTPS trust/SNI/hostname validation. Task 14 cần dùng chung transport với Workspace OAuth access token.
- **Quyết định:** Không cho test SSLContext lọt qua Spring constructor hoặc production config. Chỉ constructor package-private trong test nhận trust context tạo từ CA fixture.
- **Quyết định:** Entry point Sheets nhận `URI`, method, query, body và access token; giới hạn host/path/port rồi approve DNS qua `OutboundTargetPolicy`, pin tất cả địa chỉ, sau đó thêm `Authorization: Bearer ...` nội bộ.
- **Quyết định:** `callTimeout` điều khiển cả response idle timeout và scheduled absolute deadline; timer cancel request. Body serialization có cap trước khi hình thành request byte array.
- **Ràng buộc:** TLS key/certificate chỉ là fixture test được sinh riêng cho SAN `sheets.googleapis.com`; không phải credential/prod key. TLS test tin đúng test CA, dùng hostname verifier mặc định và không cài trust-all.
- **Nguồn sự thật:** Workflow V1 spec/plan, Task 13 recovery report, Workspace connection resolver source và các test HTTP provider hiện có.

#### 5. Nhật ký theo session / thời gian

##### Session `1` - `2026-09-23`

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Buổi sáng | Đối chiếu API Workspace API_KEY resolve và ảnh hưởng `PinnedHttpTransport`, executor, sanitizer bằng GitNexus impact | GitNexus trả `UNKNOWN` do engine v42 không đọc được index storage v43; tìm kiếm nguồn xác nhận các caller hiện tại trong HTTP/Sheets infrastructure, không dựa vào empty graph callers | Xong |
| Buổi sáng | Tạo test CA + server cert SAN `sheets.googleapis.com`, thêm local HTTPS fixture | Cert chain tin bằng truststore test; xác nhận SNI, original `Host`, bearer redaction và hostname mismatch rejection | Xong |
| Buổi sáng | Sửa transport timeout/resource bounds | Deadline scheduler hủy request; body serialization có cap; HTTP parser giới hạn 256 headers / 8 KiB mỗi line và kiểm tra aggregate byte cap; redirects/retries/compression bị disable | Xong |
| `11:08 Asia/Saigon` | Chạy suite Maven HTTP + Sheets kết hợp | `BUILD SUCCESS`, 62 tests, 0 failures/errors/skips | Xong |
| `11:09 Asia/Saigon` | Chạy `git diff --check`, explicit whitespace scan và xác minh cert SAN/issuer/validity | Không có whitespace lỗi; CA là CA test, server SAN là `sheets.googleapis.com` | Xong |

##### Diễn giải quan trọng

HTTPS live fixture gắn test CA vào truststore test, còn transport giữ hostname gốc trong TLS và HTTP dù socket resolver dùng loopback address đã pin riêng cho fixture. Request qua generic package-scoped pinned entrypoint để giữ port ephemeral của local server; public Sheets entrypoint cố ý chỉ chấp nhận port mặc định/443 và được kiểm tra riêng với URI không hợp lệ cùng DNS-resolution failure. Mismatch test dùng CA được tin nhưng hostname `wrong.example.test`, để phân biệt kiểm tra chain với hostname verification.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng truststore và private key test-only, không trust-all | Test phải chứng minh chain được tin và SAN được kiểm tra; TLS fixture cần private key để phục vụ HTTPS | Bỏ xác minh certificate trong test sẽ không chứng minh production TLS | Giữ fixture trong `src/test/resources/http-transport-tls`; không dùng ngoài test |
| Hủy request bằng scheduled deadline ngoài response timeout | Response nhỏ giọt đều có thể tránh per-read idle timeout | Chỉ dùng socket read timeout không giới hạn tổng thời gian | Timer được cancel sau request; timeout map về `HTTP_TIMEOUT` |
| Giới hạn parser trước khi tính tổng header | Aggregate cap sau parse không đủ giới hạn allocations ban đầu | Chỉ kiểm tra sau `getHeaders()` | Parser cứng ở 256 headers/8 KiB dòng, rồi vẫn áp cap cấu hình chính xác |
| Giữ Workspace API_KEY behavior hiện có trong khi nêu rõ giới hạn | Contract trả `apiKey` nhưng không trả tên header; `X-Api-Key` chỉ là convention hiện thấy trong tests | Tự suy ra custom header từ cấu hình/giá trị hoặc ngầm sửa Workspace contract | Cần coordinator/user quyết định contract additive hoặc fail-closed; không thêm cross-service contract trong lane này |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `PinnedHttpTransport.java`: Sheets fixed-endpoint Bearer entrypoint; DNS approve/pinning; internal auth header; absolute call deadline; bounded request serialization; header parser + aggregate bounds; explicit test-context hostname verifier; sanitized response headers.
- `HttpRequestNodeExecutor.java`: scrub derived `Basic` authorization header value; comment ghi rõ Workspace resolved API_KEY không mang custom header metadata.
- `OutboundTargetPolicyTest.java`: slow DNS regression.
- `HttpRequestNodeExecutorTest.java`: response echo không làm lộ Basic Authorization base64.
- `HttpTransportIntegrationTest.java`: oversized response headers, bounded request serialization, compressed response không tự inflate, drip-feed deadline, HTTPS SNI/Host/trusted chain, fixed Sheets endpoint guard và wrong-host certificate rejection.
- `src/test/resources/http-transport-tls/{ca-cert.pem,server-cert.pem,server-key.pem}`: CA/certificate/private key dành riêng cho HTTPS fixture.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không áp dụng.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi production trust store hoặc TLS property. Test-only `SSLContext` được inject qua constructor package-private.
- Không thêm dependency mới trong assurance lane; Apache HttpClient 5 dependency đã có từ Task 13 recovery.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không đổi public HTTP route hoặc Workspace contract. Thêm API nội bộ của infrastructure transport cho Sheets.
- **Security:** TLS fixture xác nhận SNI/Host giữ hostname gốc, test CA chain được trust và sai SAN bị từ chối. DNS của Sheets URI được policy approve/pin trước socket. User headers không được nhận trong OAuth entrypoint.
- **Validation/error response:** Deadline và idle timeout map về `HTTP_TIMEOUT`; response header/body bounds map về `HTTP_RESPONSE_TOO_LARGE`; hostname/TLS/connect error chỉ trả lỗi transport tổng quát.
- **Health/metrics/logging:** Không thêm log ứng dụng; token fixture chỉ dùng trong test.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/PinnedHttpTransport.java` | HTTPS/default hostname behavior, bounds, deadline và Sheets entrypoint | Production sử dụng trust store mặc định; test context package-private |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutor.java` | Basic auth derived value scrub và Workspace API_KEY caveat | Không thay Workspace contract |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/OutboundTargetPolicyTest.java` | Bounded DNS timeout regression | Resolver synthetic, không dùng DNS thật |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutorTest.java` | Basic Authorization echo redaction | Synthetic secret |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/HttpTransportIntegrationTest.java` | HTTP bounds/deadline và HTTPS certificate/SNI tests | Local server only; case-insensitive header assertions |
| `Thêm` | `services/workflow-service/src/test/resources/http-transport-tls/ca-cert.pem` | Root CA test | Không dùng production |
| `Thêm` | `services/workflow-service/src/test/resources/http-transport-tls/server-cert.pem` | Server cert SAN `sheets.googleapis.com` | Được ký bởi CA test |
| `Thêm` | `services/workflow-service/src/test/resources/http-transport-tls/server-key.pem` | Khóa private của test HTTPS server | Fixture công khai, không phải secret môi trường |

#### 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Compile/build | `cd services/workflow-service`; set `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` and `MAVEN_USER_HOME=C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home`; run the Maven command below | `PASS`; 139 main / 49 test sources compiled | Focused Workflow module |
| Test | `-Dtest=OutboundTargetPolicyTest,OutputSanitizerTest,HttpRequestNodeExecutorTest,HttpTransportIntegrationTest,GoogleSheetsContractTest,GoogleSheetsNodeExecutorTest test` | `PASS`; 62 tests, 0 failures/errors/skips; `BUILD SUCCESS` | Policy, sanitizer, executor, real local HTTP/HTTPS, Sheets unit/contract; no live Google call |
| Static/diff check | `git diff --check`; explicit PowerShell trailing-whitespace scan of owned source/test/PEM files | `PASS`; no whitespace findings | Git emits unrelated LF/CRLF notices for runtime-owned properties files |
| TLS fixture | `openssl x509 -noout -issuer -subject -ext subjectAltName` for server cert; inspect CA constraints/dates | `PASS`; issuer is test CA and SAN is `DNS:sheets.googleapis.com` | TLS trusted using test CA only |

Command run from `services/workflow-service`:

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'; $env:MAVEN_USER_HOME='C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'; .\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=OutboundTargetPolicyTest,OutputSanitizerTest,HttpRequestNodeExecutorTest,HttpTransportIntegrationTest,GoogleSheetsContractTest,GoogleSheetsNodeExecutorTest' test
```

##### Điều chưa được kiểm tra

- Full Workflow Maven suite/runtime/database tests chưa được chạy trong lane này; coordinator owns final combined suite after both lanes are stable.
- Không gọi Google Sheets thật hoặc Workspace thật.
- Không có dedicated stalled TCP SYN fixture; `connectTimeout` vẫn được cấu hình trong Apache request policy, và absolute deadline bọc connect/TLS/execute/body read.
- Custom API key header name không thể được kiểm chứng từ resolve contract hiện tại.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact unresolved | Impact tool báo UNKNOWN do engine/index database version mismatch | Caller references được corroborate bằng source search; không coi UNKNOWN là low-risk | Coordinator refreshes index and runs `detect_changes` before commit |
| Trung bình | Custom API key header metadata không có trong Workspace resolve response | Response V1 chỉ có provider/authType/auth; API_KEY auth chỉ chứa `apiKey` | Giữ implementation hiện tại nhưng ghi rõ X-Api-Key là convention, không phải default contract đã xác nhận | Coordinator/user quyết định additive non-secret metadata hay fail-closed; không tự suy diễn |
| Thấp | Transport compile/test iteration | Maven đầu tiên phát hiện scope lỗi, Jackson 3 exception type và import `HttpsParameters` sai package; hai assertions ban đầu giả định header-case cụ thể | Đã sửa, focused combined suite cuối cùng 62/62 xanh | Không cần bước tiếp theo |

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Coordinator reviews HTTP + Sheets source and runs the full Workflow/runtime suite after both lanes are stable.
2. Coordinator refreshes GitNexus, runs `detect_changes`, reviews the combined diff, and makes the commit decision.

##### Cần quyết định / quyền truy cập từ người khác

- Workspace API_KEY V1 does not reveal a custom header name. Decide whether supported semantics are a fixed `X-Api-Key` default or whether Workflow should fail closed until an additive non-secret `apiKeyHeaderName` is resolvable.

##### Hướng dẫn cho AI agent tiếp theo

- Keep ownership boundaries: HTTP classes are owned here, Sheets classes by the Task 14 peer, runtime/plan/ledger by coordinator.
- Do not treat GitNexus UNKNOWN as an all-clear.
- Do not use the test CA/private key outside tests or add any production trust bypass.
- Preserve the unresolved API key header decision; do not silently invent a cross-service mapping.

#### 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-13-report.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-13-assurance-report.md`
- Workspace `HttpConnectionProvider` and resolved-connection response source/tests for the API_KEY header limitation

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 11:12 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; shared checkout có các lane runtime/Sheets khác |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | `Task 13 HTTP assurance` |
| Cần đọc trước khi tiếp tục | Phần 10 blocker; `scratchtask-13-assurance-report.md`; plan/spec |

---

#### Checklist trước khi đóng log

- [x] Tóm tắt nêu kết quả và phần chưa hoàn thành.
- [x] Quyết định và rủi ro được ghi rõ.
- [x] File, lệnh, số test và giới hạn evidence đã nêu.
- [x] Không có production secret; PEM key được ghi rõ là test fixture.
- [x] Commit/detect-changes được giữ cho coordinator.
