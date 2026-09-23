# Nhật ký ngày `2026-09-23`

## 1. Metadata

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

## 2. Tóm tắt điều hành

### Kết quả chính

- Bổ sung HTTPS integration fixture dùng CA test được tin cậy riêng, xác nhận SNI, `Host`, xác thực certificate và từ chối certificate có SAN không khớp hostname gốc. Production vẫn dùng trust store và hostname verification mặc định; SSL context tùy chỉnh chỉ có ở constructor package-private dùng trong test.
- Bảo đảm deadline tuyệt đối bằng cách hủy request sau `callTimeout`, ngoài response idle timeout; thêm regression với response nhỏ giọt liên tục. Request JSON được serialize vào buffer có giới hạn; parser response có giới hạn số header/dòng và tổng header, body không tự giải nén, redirect/retry tiếp tục bị tắt.
- Mở API vận chuyển Google Sheets với Bearer token nội bộ: chỉ HTTPS `sheets.googleapis.com:443` trên đường dẫn Sheets, tự approve/pin DNS và tự thêm `Authorization`; không nhận headers của user. Basic auth-derived value được thêm vào bộ secret scrub.
- Test suite tập trung kết hợp HTTP + Sheets: `62` tests, `0` failures/errors/skips, `BUILD SUCCESS`.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Maven compiled 139 main / 49 test sources |
| Unit / integration test | `PASS` | 62 focused HTTP/policy/sanitizer/executor/Sheets tests |
| Migration / database | `Chưa áp dụng` | Không thay đổi schema |
| Health check | `Chưa kiểm tra` | Không khởi động service |
| Review thay đổi | `Đã kiểm tra` | GitNexus UNKNOWN được corroborate bằng source search; `git diff --check` và whitespace scan sạch |
| Commit / PR | `Chưa tạo` | Coordinator quyết định detect-changes/commit |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Đưa HTTP transport assurance từ fixture HTTP sang HTTPS có certificate và hostname proof thực tế.
2. Kiểm tra deadline toàn cuộc gọi và resource bounds của DNS, request/response bodies, headers, decompression và redirects.
3. Cung cấp entrypoint xác thực an toàn tối thiểu cho Sheets peer mà không bỏ qua DNS policy hoặc nhận user headers.

### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/**`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/**`
- `services/workflow-service/src/test/resources/http-transport-tls/**`
- Task 13 assurance work log và scratch report.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa Workspace API/config, runtime registry/config, entity, plan, ledger hoặc Task 14 source/tests.
- Không gọi provider thật, không thêm auth/refresh protocol, không stage/commit/push.
- Không tuyên bố custom API key header được hỗ trợ: Workspace resolve contract vẫn chỉ trả `provider`, `authType`, `auth`; tên `apiKeyHeaderName` không được resolve.

### Tiêu chí hoàn thành

- [x] Có HTTPS fixture tin CA riêng, xác nhận SNI/Host và từ chối sai hostname.
- [x] Có regression test deadline tuyệt đối, DNS timeout, request/response/body/header bounds, không giải nén, không follow redirect và secret redaction.
- [x] Có safe Sheets OAuth transport entrypoint; không nhận user headers và tự approve/pin DNS.
- [x] Chạy suite HTTP + Sheets và ghi số test thực tế.
- [ ] Coordinator xác nhận hướng xử lý API key custom-header gap và chạy GitNexus `detect_changes` trước commit.

## 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** Task 13 trước đây có 38 tests và local HTTP pinning fixture, nhưng chưa có bằng chứng HTTPS trust/SNI/hostname validation. Task 14 cần dùng chung transport với Workspace OAuth access token.
- **Quyết định:** Không cho test SSLContext lọt qua Spring constructor hoặc production config. Chỉ constructor package-private trong test nhận trust context tạo từ CA fixture.
- **Quyết định:** Entry point Sheets nhận `URI`, method, query, body và access token; giới hạn host/path/port rồi approve DNS qua `OutboundTargetPolicy`, pin tất cả địa chỉ, sau đó thêm `Authorization: Bearer ...` nội bộ.
- **Quyết định:** `callTimeout` điều khiển cả response idle timeout và scheduled absolute deadline; timer cancel request. Body serialization có cap trước khi hình thành request byte array.
- **Ràng buộc:** TLS key/certificate chỉ là fixture test được sinh riêng cho SAN `sheets.googleapis.com`; không phải credential/prod key. TLS test tin đúng test CA, dùng hostname verifier mặc định và không cài trust-all.
- **Nguồn sự thật:** Workflow V1 spec/plan, Task 13 recovery report, Workspace connection resolver source và các test HTTP provider hiện có.

## 5. Nhật ký theo session / thời gian

### Session `1` - `2026-09-23`

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Buổi sáng | Đối chiếu API Workspace API_KEY resolve và ảnh hưởng `PinnedHttpTransport`, executor, sanitizer bằng GitNexus impact | GitNexus trả `UNKNOWN` do engine v42 không đọc được index storage v43; tìm kiếm nguồn xác nhận các caller hiện tại trong HTTP/Sheets infrastructure, không dựa vào empty graph callers | Xong |
| Buổi sáng | Tạo test CA + server cert SAN `sheets.googleapis.com`, thêm local HTTPS fixture | Cert chain tin bằng truststore test; xác nhận SNI, original `Host`, bearer redaction và hostname mismatch rejection | Xong |
| Buổi sáng | Sửa transport timeout/resource bounds | Deadline scheduler hủy request; body serialization có cap; HTTP parser giới hạn 256 headers / 8 KiB mỗi line và kiểm tra aggregate byte cap; redirects/retries/compression bị disable | Xong |
| `11:08 Asia/Saigon` | Chạy suite Maven HTTP + Sheets kết hợp | `BUILD SUCCESS`, 62 tests, 0 failures/errors/skips | Xong |
| `11:09 Asia/Saigon` | Chạy `git diff --check`, explicit whitespace scan và xác minh cert SAN/issuer/validity | Không có whitespace lỗi; CA là CA test, server SAN là `sheets.googleapis.com` | Xong |

### Diễn giải quan trọng

HTTPS live fixture gắn test CA vào truststore test, còn transport giữ hostname gốc trong TLS và HTTP dù socket resolver dùng loopback address đã pin riêng cho fixture. Request qua generic package-scoped pinned entrypoint để giữ port ephemeral của local server; public Sheets entrypoint cố ý chỉ chấp nhận port mặc định/443 và được kiểm tra riêng với URI không hợp lệ cùng DNS-resolution failure. Mismatch test dùng CA được tin nhưng hostname `wrong.example.test`, để phân biệt kiểm tra chain với hostname verification.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng truststore và private key test-only, không trust-all | Test phải chứng minh chain được tin và SAN được kiểm tra; TLS fixture cần private key để phục vụ HTTPS | Bỏ xác minh certificate trong test sẽ không chứng minh production TLS | Giữ fixture trong `src/test/resources/http-transport-tls`; không dùng ngoài test |
| Hủy request bằng scheduled deadline ngoài response timeout | Response nhỏ giọt đều có thể tránh per-read idle timeout | Chỉ dùng socket read timeout không giới hạn tổng thời gian | Timer được cancel sau request; timeout map về `HTTP_TIMEOUT` |
| Giới hạn parser trước khi tính tổng header | Aggregate cap sau parse không đủ giới hạn allocations ban đầu | Chỉ kiểm tra sau `getHeaders()` | Parser cứng ở 256 headers/8 KiB dòng, rồi vẫn áp cap cấu hình chính xác |
| Giữ Workspace API_KEY behavior hiện có trong khi nêu rõ giới hạn | Contract trả `apiKey` nhưng không trả tên header; `X-Api-Key` chỉ là convention hiện thấy trong tests | Tự suy ra custom header từ cấu hình/giá trị hoặc ngầm sửa Workspace contract | Cần coordinator/user quyết định contract additive hoặc fail-closed; không thêm cross-service contract trong lane này |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `PinnedHttpTransport.java`: Sheets fixed-endpoint Bearer entrypoint; DNS approve/pinning; internal auth header; absolute call deadline; bounded request serialization; header parser + aggregate bounds; explicit test-context hostname verifier; sanitized response headers.
- `HttpRequestNodeExecutor.java`: scrub derived `Basic` authorization header value; comment ghi rõ Workspace resolved API_KEY không mang custom header metadata.
- `OutboundTargetPolicyTest.java`: slow DNS regression.
- `HttpRequestNodeExecutorTest.java`: response echo không làm lộ Basic Authorization base64.
- `HttpTransportIntegrationTest.java`: oversized response headers, bounded request serialization, compressed response không tự inflate, drip-feed deadline, HTTPS SNI/Host/trusted chain, fixed Sheets endpoint guard và wrong-host certificate rejection.
- `src/test/resources/http-transport-tls/{ca-cert.pem,server-cert.pem,server-key.pem}`: CA/certificate/private key dành riêng cho HTTPS fixture.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không áp dụng.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi production trust store hoặc TLS property. Test-only `SSLContext` được inject qua constructor package-private.
- Không thêm dependency mới trong assurance lane; Apache HttpClient 5 dependency đã có từ Task 13 recovery.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không đổi public HTTP route hoặc Workspace contract. Thêm API nội bộ của infrastructure transport cho Sheets.
- **Security:** TLS fixture xác nhận SNI/Host giữ hostname gốc, test CA chain được trust và sai SAN bị từ chối. DNS của Sheets URI được policy approve/pin trước socket. User headers không được nhận trong OAuth entrypoint.
- **Validation/error response:** Deadline và idle timeout map về `HTTP_TIMEOUT`; response header/body bounds map về `HTTP_RESPONSE_TOO_LARGE`; hostname/TLS/connect error chỉ trả lỗi transport tổng quát.
- **Health/metrics/logging:** Không thêm log ứng dụng; token fixture chỉ dùng trong test.

## 8. Danh sách file ảnh hưởng

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

## 9. Kiểm tra và bằng chứng

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

### Điều chưa được kiểm tra

- Full Workflow Maven suite/runtime/database tests chưa được chạy trong lane này; coordinator owns final combined suite after both lanes are stable.
- Không gọi Google Sheets thật hoặc Workspace thật.
- Không có dedicated stalled TCP SYN fixture; `connectTimeout` vẫn được cấu hình trong Apache request policy, và absolute deadline bọc connect/TLS/execute/body read.
- Custom API key header name không thể được kiểm chứng từ resolve contract hiện tại.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus impact unresolved | Impact tool báo UNKNOWN do engine/index database version mismatch | Caller references được corroborate bằng source search; không coi UNKNOWN là low-risk | Coordinator refreshes index and runs `detect_changes` before commit |
| Trung bình | Custom API key header metadata không có trong Workspace resolve response | Response V1 chỉ có provider/authType/auth; API_KEY auth chỉ chứa `apiKey` | Giữ implementation hiện tại nhưng ghi rõ X-Api-Key là convention, không phải default contract đã xác nhận | Coordinator/user quyết định additive non-secret metadata hay fail-closed; không tự suy diễn |
| Thấp | Transport compile/test iteration | Maven đầu tiên phát hiện scope lỗi, Jackson 3 exception type và import `HttpsParameters` sai package; hai assertions ban đầu giả định header-case cụ thể | Đã sửa, focused combined suite cuối cùng 62/62 xanh | Không cần bước tiếp theo |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator reviews HTTP + Sheets source and runs the full Workflow/runtime suite after both lanes are stable.
2. Coordinator refreshes GitNexus, runs `detect_changes`, reviews the combined diff, and makes the commit decision.

### Cần quyết định / quyền truy cập từ người khác

- Workspace API_KEY V1 does not reveal a custom header name. Decide whether supported semantics are a fixed `X-Api-Key` default or whether Workflow should fail closed until an additive non-secret `apiKeyHeaderName` is resolvable.

### Hướng dẫn cho AI agent tiếp theo

- Keep ownership boundaries: HTTP classes are owned here, Sheets classes by the Task 14 peer, runtime/plan/ledger by coordinator.
- Do not treat GitNexus UNKNOWN as an all-clear.
- Do not use the test CA/private key outside tests or add any production trust bypass.
- Preserve the unresolved API key header decision; do not silently invent a cross-service mapping.

## 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-13-report.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-13-assurance-report.md`
- Workspace `HttpConnectionProvider` and resolved-connection response source/tests for the API_KEY header limitation

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 11:12 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; shared checkout có các lane runtime/Sheets khác |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | `Task 13 HTTP assurance` |
| Cần đọc trước khi tiếp tục | Phần 10 blocker; `scratchtask-13-assurance-report.md`; plan/spec |

---

## Checklist trước khi đóng log

- [x] Tóm tắt nêu kết quả và phần chưa hoàn thành.
- [x] Quyết định và rủi ro được ghi rõ.
- [x] File, lệnh, số test và giới hạn evidence đã nêu.
- [x] Không có production secret; PEM key được ghi rõ là test fixture.
- [x] Commit/detect-changes được giữ cho coordinator.
