# Nhật ký ngày `2026-09-23` — Workflow Service Task 14 Google Sheets

## 1. Metadata

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

## 2. Tóm tắt điều hành

### Kết quả chính

- Đã thêm executor `google.sheets` dùng connection UUID literal và credential OAuth do Workspace resolve.
- Đã thêm client cho Sheets values `get`, `append`, và `update`, với host cố định và mã hóa path segment.
- Đã thêm test executor và wire contract; kết quả Maven chưa có vì đang chờ HTTP assurance worker bàn giao transport source-ready và lượt kiểm tra tuần tự.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | Thành công | Biên dịch Workflow module qua focused Maven run. |
| Unit / integration test | Thành công | Sheets 15/15 và HTTP transport 11/11; tổng 26 test, không failure/error/skip. |
| Migration / database | Không áp dụng | Task 14 không thay đổi schema. |
| Provider smoke | Chưa kiểm tra | Chưa có test spreadsheet/credential được xác nhận trong cấu hình an toàn. |
| Review thay đổi | Sẵn sàng review | Thêm hai lớp Sheets, hai test; không sửa registry hiện có. |
| Commit / PR | Chưa tạo | Không stage, commit, push hoặc merge. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Thực thi Google Sheets `read`, `append`, và `update` qua Workspace credential resolution.
2. Bảo toàn kiểu JSON của cell values, mã hóa spreadsheet ID/range thành các path segment, và trả về JSON đã khử secret.
3. Phân loại lỗi provider theo Task 11 và bàn giao bằng chứng kiểm tra không chứa credential.

### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsClient.java`
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutor.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsContractTest.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutorTest.java`
- Work log K và scratch report Task 14.

### Ngoài phạm vi / chủ động chưa làm

- HTTP transport/policy/sanitizer dùng chung thuộc quyền sở hữu của HTTP assurance worker.
- README provider smoke procedure thuộc Task 21.
- Workspace OAuth refresh, scope mới, provider SDK, endpoint mới, idempotency header, migration, và mọi Task sau 14.
- Plan/progress ledger, commit, push, worktree, hoặc external agent.

### Tiêu chí hoàn thành

- [x] Chạy `GoogleSheetsNodeExecutorTest` và `GoogleSheetsContractTest` sau khi shared transport source-ready.
- [x] Xác nhận fixed Google host, đúng phương thức/path/query/body, bearer auth chỉ từ Workspace, sanitizer và status policy.
- [x] Ghi rõ giới hạn provider smoke khi chưa có test spreadsheet được cấu hình.
- [x] `git diff --check` sạch và cập nhật scratch report trước khi bàn giao.

## 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** `NodeExecutorRegistry` nhận danh sách bean `NodeExecutor`; Task 14 đăng ký adapter bằng Spring `@Component`, không sửa registry.
- **Hợp đồng Workspace:** `WorkspaceClient` chỉ trả provider/authType/auth đã xác thực; test hiện có ghi nhận `GOOGLE_SHEETS`, `OAUTH2`, và duy nhất `accessToken`. Executor resolve lại mỗi lần được gọi và đóng `ResolvedConnection` sau request.
- **Giao thức Google:** Đã làm mới kiểm tra các trang chính thức `spreadsheets.values.get`, `append`, `update`, và `ValueInputOption`. Đọc dùng GET; append POST với hậu tố `:append`; update PUT; ghi dùng `valueInputOption=RAW`, `majorDimension=ROWS`.
- **Quyết định:** `GoogleSheetsClient` gọi API shared transport chỉ với URI được tạo từ host cố định, method, query/body có kiểu, và access token. Shared transport sở hữu phê duyệt target/DNS pin và thêm Bearer header; caller không thể chuyển header tuỳ ý.
- **Quyết định:** Chỉ báo `AUTHENTICATION_REJECTED` cho Workspace khi provider trả 401 đã xác nhận. 403 là business rejection; 429 và timeout/5xx retryable theo Task 11.
- **Rủi ro:** Append có thể tạo dòng trùng khi provider đã xử lý request nhưng response bị mất trước retry; không tuyên bố exactly-once và không thêm idempotency header không có trong Google API.

## 5. Nhật ký theo session / thời gian

### Session 1 — 2026-09-23

| Mốc | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Khảo sát | Đọc AGENTS, Task 14 plan/spec, progress và Task 13 handoff | Giới hạn Task 14 và quyền sở hữu shared transport được xác định | Xong |
| Impact | Chạy GitNexus impact cho `NodeExecutorRegistry` | `risk: UNKNOWN`; truy vấn lỗi vì storage version mismatch (index version 43, runtime version 42) | Xong |
| Corroborate | Đọc source caller/wiring | Registry nhận `List<NodeExecutor>`; `NodeAttemptRunner` dispatch bằng `registry.require(nodeType)`; Google node type đã được catalog hóa | Xong |
| Contract | Xác minh Google REST contract qua tài liệu chính thức | Đã xác nhận GET/POST/PUT, path, `RAW`, scope spreadsheets | Xong |
| Implementation | Tạo executor/client và test trong package sở hữu | 4 file Task 14 mới; Spring component scan test xác nhận registry bean nhận `google.sheets` | Xong |
| Verification | Chạy focused HTTP + Sheets tests sau handoff transport | 26 test, 0 failure/error/skip; `BUILD SUCCESS` | Xong |
| Handoff docs | Cập nhật work log và scratch report sau `git diff --check` | Provider smoke được đánh dấu chưa chạy do thiếu fixture được xác nhận | Xong |

### Diễn giải quan trọng

`NodeExecutorRegistry` và `NodeAttemptRunner` không bị sửa. GitNexus index cũ hơn checkout và impact walk thất bại do không tương thích storage; caller chain được đọc trực tiếp trong source. Coordinator sở hữu refresh index và graph review trước commit.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Workspace giữ credential; mỗi node attempt resolve mới | Port hiện có cung cấp `ResolvedConnection` closeable; Google resolver contract là `GOOGLE_SHEETS/OAUTH2/accessToken` | Lưu token hoặc tự refresh trong Workflow | Không lưu/refresh token; kiểm tra resolve mới giữa các lần gọi |
| Ghi dùng RAW và rows | Google API xác nhận RAW giữ cell data nguyên dạng; Task 14 yêu cầu giữ kiểu cell JSON | USER_ENTERED hoặc SDK | Không diễn giải chuỗi như công thức/ngày; không thêm SDK |
| Endpoint host bị cố định | Sheets client tạo đúng `sheets.googleapis.com`; shared transport kiểm tra host, DNS và pin địa chỉ | Dùng URL cấu hình từ node | Không cho node điều khiển host hoặc header |
| Output là JSON API map sau sanitizer | Interface Task 14 trả về map thực từ provider và node result phải sanitized | Bọc status/data như HTTP node | Error body không đi vào failure/output; result giữ dữ liệu API hợp lệ |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- Thêm `GoogleSheetsNodeExecutor`: parse operation, ID, range, UUID literal và write rows; resolve Workspace connection mỗi invocation; gọi read/append/update; đóng holder trong `finally`; sanitizer trước `NodeExecutor.Result`; chỉ báo auth-failure với provider 401.
- Thêm `GoogleSheetsClient`: mã hóa UTF-8 path segments, tạo URI trên host Google cố định, dùng contract read/append/update; xác nhận Workspace provider/auth type và đúng `accessToken`; ghi `ValueRange` theo ROWS với scalar JSON cell values; phân loại 401/403/429/408/5xx/redirect và invalid response mà không giữ body lỗi.
- Không sửa domain/application/Workspace API hoặc shared HTTP transport trong lane này.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không có.
- **Dữ liệu seed/test:** Chỉ giá trị tổng hợp trong unit test; không có provider data.
- **Tính tương thích:** Node type `google.sheets` và cấu hình connection/operation/spreadsheetId/range/values đã có trong catalog/validator.

### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm biến môi trường hay dependency.
- Không nhận OAuth refresh token; không mở scope mới.
- Shared transport API mới do HTTP assurance worker sở hữu; signature được phối hợp trực tiếp.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Gọi Google Sheets values REST API hiện có; không thay đổi API public/internal của Weav.
- **Security:** Chỉ dùng Workspace `GOOGLE_SHEETS/OAUTH2` credential; Bearer header được shared transport thêm; destination cố định và transport kiểm soát DNS/pinning.
- **Validation/error response:** 401 authentication rejected; 403 business rejected; 429 retryable rate limit; 408/5xx retryable dependency; 3xx không follow và non-retryable; thông điệp lỗi không giữ body provider.
- **Health/metrics/logging:** Không thêm logging.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsClient.java` | Gọi Google values API bằng controlled transport | Credential chỉ được đọc từ `ResolvedConnection` |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutor.java` | Đăng ký `google.sheets` executor | Cần review sanitizer/error mapping |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsContractTest.java` | Wire method/path/query/body/error tests | Dùng transport double, không gọi provider thật |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/sheets/GoogleSheetsNodeExecutorTest.java` | Config/resolve/close/retry/sanitize/registry tests | Chỉ dùng synthetic credentials |
| Thêm | `docs/work_logs/K/2026-09-23-workflow-service-task-14.md` | Work log Task 14 | Ghi rõ bằng chứng/giới hạn |
| Thêm | `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-14-report.md` | Worker handoff evidence | Coordinator sở hữu plan/progress ledger |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus impact | `mcp__gitnexus__impact(repo="Weav", target="NodeExecutorRegistry", direction="upstream")` | `UNKNOWN`; store version mismatch `43` vs `42` | Registry không bị sửa; source callers được corroborate thủ công; index refresh/deep graph check thuộc coordinator |
| Google protocol | Mở tài liệu chính thức values.get/append/update/ValueInputOption | Xác nhận method, path, RAW và scope | Chỉ xác nhận protocol contract; không gọi Google thật |
| Focused Maven tests | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`; `MAVEN_USER_HOME=C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home`; `.\mvnw.cmd -B -Dstyle.color=never -Dmaven.repo.local=C:\Users\nhoan\.m2\repository -Dtest=HttpTransportIntegrationTest,GoogleSheetsNodeExecutorTest,GoogleSheetsContractTest test` | 26 test; 0 failures/errors/skips; `BUILD SUCCESS` | Chạy tuần tự sau shared transport source-ready; có cả HTTP transport integration và hai Task 14 suites |
| Static/diff check | `git diff --check` và whitespace scan file sở hữu | Sạch | Chỉ xác nhận diff/whitespace, không thay thế Maven test |
| Provider smoke | Chưa chạy | Chưa có test spreadsheet/credential được cấp xác nhận | Không đọc `.env`/secret store và không dùng spreadsheet không rõ quyền |

### Điều chưa được kiểm tra

- Không còn kiểm tra deterministic nào đang chờ trong lane Task 14.
- Live provider smoke read/append/update/readback chưa chạy; không có spreadsheet test resource/credential được xác nhận trong task context.
- Append at-least-once uncertainty remains; no exactly-once guarantee.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact UNKNOWN | Index storage version 43 không đọc được bởi runtime version 42; index 3 commits behind | Không coi UNKNOWN là low; source-search caller chain được xác nhận | Coordinator rebuild/corroborate và chạy detect-changes trước commit |
| Thấp | Real Sheets provider chưa xác minh | Chưa có test spreadsheet/Workspace credentials được xác nhận | Không gọi provider; chỉ tuyên bố protocol/unit evidence | Coordinator ghi provider-smoke blocked nếu vẫn thiếu cấu hình |
| Thấp | Append có thể lặp sau request ambiguity | Provider có thể đã ghi row trước khi response mất | Không thêm retry logic/idempotency header; không claim exactly-once | Nêu rõ trong acceptance/handoff |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator review code, work log, scratch report và kết quả focused Maven run.
2. Nếu coordinator xác nhận có test spreadsheet/connection được cấp rõ ràng, chạy provider smoke theo Task 14; nếu không, giữ trạng thái smoke blocked.
3. Coordinator sở hữu graph refresh/change detection và quyết định milestone tiếp theo.

### Cần quyết định / quyền truy cập từ người khác

- Live provider smoke cần spreadsheet thử nghiệm riêng và Workspace connection test credentials được xác nhận; nếu không có, không thực hiện.

### Hướng dẫn cho AI agent tiếp theo

- Chỉ sửa các file Task 14 thuộc sở hữu lane này; shared HTTP transport/policy/sanitizer thuộc HTTP assurance worker.
- Dùng Maven theo lượt đã điều phối; không chạy song song với runtime/HTTP worker.
- Không đọc `.env`/secret stores; không stage, commit, push, tạo worktree hoặc chạy task kế tiếp.
- Coordinator giữ quyền cập nhật plan/progress ledger, GitNexus re-index/change detection và quyết định commit.

## 12. Tham chiếu

- [Google Sheets values.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get)
- [Google Sheets values.append](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append)
- [Google Sheets values.update](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/update)
- [Google Sheets ValueInputOption](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption)
- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/workspace/WorkspaceClientTest.java`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23` — sau focused verification và diff check |
| Trạng thái worktree | Dirty shared worktree; Task 14 files untracked cùng Tasks trước đó |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Task 14 Google Sheets worker |
| Cần đọc trước khi tiếp tục | Task 14 plan, HTTP source-ready note, phần 11 bàn giao |
