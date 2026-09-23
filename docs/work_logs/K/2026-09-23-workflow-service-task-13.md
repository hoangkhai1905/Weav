# Nhật ký ngày `2026-09-23`

## 1. Metadata

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

## 2. Tóm tắt điều hành

### Kết quả chính

- Khôi phục đầy đủ adapter `http.request` với URL/method/header/query/body validation, Workspace connection resolution ngay trước lần gọi, auth header chỉ nằm trong transport scope, phân loại 401/403/429/5xx và đóng credential holder sau request.
- Bổ sung policy SSRF fail-closed: chỉ HTTP(S), cấm userinfo/fragment/control/metadata, kiểm tra toàn bộ DNS answers gồm IPv4/IPv6/mapped addresses, và truyền tập địa chỉ đã kiểm tra vào Apache in-memory resolver.
- Bổ sung transport Apache HttpClient 5 có pinned DNS, redirect/retry/compression disablement, timeout/header/request/response bounds; output sanitizer đệ quy loại credential fields, scrub exact active secrets và signed URL query values.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Maven focused run compiled 137 main / 47 test sources |
| Unit / integration test | `PASS` | 38 tests: 26 policy, 3 sanitizer, 5 executor, 4 real transport |
| Migration / database | `Chưa áp dụng` | Task 13 HTTP lane không sửa schema |
| Health check | `Chưa kiểm tra` | Không khởi động service |
| Review thay đổi | `Đã kiểm tra` | GitNexus impact trước edit; source/manual caller corroboration; owned-file whitespace check PASS |
| Commit / PR | `Chưa tạo` | Coordinator owns detect-changes and commit decision |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Hoàn thiện các file HTTP còn thiếu của Task 13 từ phần partial source hiện có.
2. Giữ ranh giới Workspace credentials/runtime wiring; không sửa registry, application properties, ledger hoặc Task 14.
3. Có test deterministic DNS seam và real local HTTP server chứng minh socket dùng approved address.

### Trong phạm vi

- `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/**`
- `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/http/**`
- Apache HttpClient 5 dependency trong Workflow POM do dependency này vắng mặt ở Workflow nhưng có ở Workspace.
- Task 13 K work log và scratch report.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa `NodeExecutorRegistry`, runtime worker, `application.properties`, test properties, Workspace contract, progress ledger hoặc plan.
- Không gọi provider thật, không tạo refresh protocol/provider mới, không sửa database/migration, không stage/commit/push.
- Không claim TLS certificate/pinning verification; real test dùng HTTP local với public original host và loopback approved address để chứng minh socket pinning.

### Tiêu chí hoàn thành

- [x] Executor, policy, transport, sanitizer và bounded properties có implementation.
- [x] SSRF, redirect, timeout, size-bound, status classification, auth lifecycle và secret hygiene có test.
- [x] Focused Maven suite xanh và source-ready cho runtime peer.
- [ ] Coordinator chạy GitNexus `detect_changes` và quyết định commit sau khi ghép toàn bộ Task 10/11/13.

## 4. Bối cảnh và quyết định

- **Bối cảnh hệ thống:** HTTP test classes đã tồn tại nhưng production `OutputSanitizer`, executor, transport và properties còn thiếu. `WorkspaceConnectionPort` chỉ trả provider/authType/auth secrets trong `ResolvedConnection`, nên Workflow không tự đọc Workspace tables.
- **Quyết định:** `HttpRequestNodeExecutor` là Spring component có điều kiện `weav.workflow.http.executor.enabled` (mặc định bật), để runtime integration test có thể tắt adapter khi đăng ký deterministic test executor.
- **Quyết định:** auth hỗ trợ các mode HTTP đã có trong Workspace (`NONE`, `TOKEN`, `BASIC`, `API_KEY`); API key dùng header `X-Api-Key`, là header mặc định được dùng trong HTTP provider tests vì resolved V1 response không mang non-secret `apiKeyHeaderName`.
- **Ràng buộc:** Không đưa credential vào `NodeExecutor.Context`, output, exception message, log hoặc DTO; `ResolvedConnection` được đóng trước khi phân loại response/auth failure.
- **Nguồn sự thật:** Workflow Service V1 spec và Task 13 plan; Workspace HTTP pinned transport và connection provider hiện có.

## 5. Nhật ký theo session / thời gian

### Session `1` - `2026-09-23`

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Buổi sáng | Kiểm tra partial HTTP source, Workspace transport/auth contract, POM và test hiện có | Chỉ `OutboundTargetPolicy`/2 test tồn tại; Workflow thiếu Apache HttpClient 5 dependency | Xong |
| Buổi sáng | Chạy GitNexus upstream impact trước edit | New/partial Task 13 symbols target-not-found hoặc `UNKNOWN` trên index cũ; caller usage được corroborate bằng source search; fresh analyze kết thúc với EPERM ghi registry và vector/process truncation | Xong |
| Buổi sáng | Thêm bounded properties, sanitizer, pinned transport, executor; hoàn thiện policy component | Source Task 13 HTTP lane đầy đủ; executor conditional property không đụng runtime files | Xong |
| Buổi chiều | Mở rộng policy cases và thêm executor/real transport tests | Test cover private/loopback/link-local/metadata IPv4+IPv6/mapped, mixed DNS, auth status, redirect, oversize, timeout, host/pinned socket | Xong |
| `19:51 UTC` | Chạy focused Maven suite với UTC và local Maven repository sau encoded-control check | `BUILD SUCCESS`, 38 tests, 0 failures/errors | Xong |

### Diễn giải quan trọng

Real transport test tạo URI host `public.example.test` nhưng approved address là loopback của local `HttpServer`; request đến đúng server và Host header vẫn giữ original hostname. Đây là bằng chứng socket pinning/DNS no-relookup ở HTTP test seam. TLS certificate verification/SNI chưa được chạy vì fixture không có certificate test.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Cài `InMemoryDnsResolver` mới cho từng request | Địa chỉ được policy kiểm tra được dùng trực tiếp bởi socket; Apache không tự lookup lần hai | Dùng default resolver sau policy sẽ mở lại DNS rebinding | Giữ original URI host cho Host/TLS; cần runtime smoke/HTTPS review riêng |
| Chặn credential-bearing inline headers và nhận auth từ connection | Definition/Task 13 yêu cầu Workspace-owned credentials | Cho caller tự gửi `Authorization`/cookie/token header sẽ phá boundary | API key header default là `X-Api-Key`; custom header name chưa thể truyền qua resolved V1 response |
| Tắt redirects/retries/compression | Redirect hop không thể bypass SSRF; response không bị unbounded decompression | Tự follow redirect sẽ phải re-approve mỗi hop, ngoài Task 13 V1 | 3xx trả lỗi non-retryable |
| Sanitize response data trước `NodeExecutor.Result` | Output là dữ liệu có thể được persistence layer ghi lại | Chỉ sanitize logs sẽ vẫn lưu secret trong node output | Headers không nằm trong canonical output `{status,data}` |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `HttpRequestNodeExecutor.java`: parse/validate resolved config, approve target trước credential resolve, runtime auth injection, Workspace error mapping, provider status classification, canonical output và holder close.
- `OutboundTargetPolicy.java`: Spring component/URI shape entrypoint; preserved DNS-address validation and added complete test matrix.
- `PinnedHttpTransport.java`: Apache HttpClient 5 method/body/query support, pinned resolver, bounds/timeouts, response decoding, disabled redirect/retry/compression and internal auth scope.
- `OutputSanitizer.java`: detached recursive JSON sanitizer with case-insensitive sensitive keys, exact active secret replacement, signed URL query redaction and bounded/cyclic values.
- `OutboundHttpProperties.java`: validated `weav.workflow.http` duration/body/header settings with bounded safe defaults.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration:** Không áp dụng.

### 7.3. Cấu hình, hạ tầng và dependency

- Added `org.apache.httpcomponents.client5:httpclient5:5.6.1` to Workflow POM after verifying Workspace dependency exists and Workflow dependency was absent.
- Runtime peer should provide `weav.workflow.http.*` values through its owned application/test configuration; no secret values are required by this adapter.

### 7.4. API, bảo mật và quan sát hệ thống

- **Security:** SSRF policy rejects blocked literal/DNS destinations and all DNS answers are checked; user-controlled Host/content-length/connection framing and credential headers are rejected.
- **Validation/error response:** Stable `NodeExecutor.Failure` codes/messages only; 401 is `AUTHENTICATION_REJECTED`, 403 business response is `HTTP_BUSINESS_REJECTED`, 429 is retryable `HTTP_RATE_LIMITED`, and transport timeout/network/5xx are retryable.
- **Health/metrics/logging:** No new logging; raw downstream bodies/exceptions are not retained.

## 8. Danh sách file ảnh hưởng

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

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Compile/build | `services/workflow-service: $env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'; .\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=OutboundTargetPolicyTest,OutputSanitizerTest,HttpRequestNodeExecutorTest,HttpTransportIntegrationTest' test` | `PASS`; Maven compiled 137 main and 47 test sources | Focused Workflow module only |
| Test | Same command | `PASS`; 38 tests, 0 failures/errors | Unit + local HTTP integration; no external provider |
| Static/diff check | `git diff --check`; owned-file trailing-whitespace scan | `PASS` | Untracked files checked by explicit scan; root shared worktree remains dirty by other lanes |
| GitNexus | Upstream impact before edits; direct fresh analyze attempt | Impact for new/stale symbols `UNKNOWN`/target-not-found; fresh analyze ended EPERM writing `C:\Users\nhoan\.gitnexus\registry.json.tmp...` and reported truncation/vector fallback | Coordinator must refresh/corroborate and run detect-changes before commit |

### Điều chưa được kiểm tra

- Full combined Workflow suite and runtime integration after the final HTTP source change are coordinator/runtime-peer responsibilities and must run serialized.
- No HTTPS certificate/SNI test; transport preserves original URI hostname, but TLS evidence is not claimed.
- No live Workspace/provider call; tests use the documented port seam and synthetic credentials only.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus fresh index unavailable | Direct analyzer completed graph work but failed EPERM writing global registry; index remains stale/partial | Preserved UNKNOWN warning and manually corroborated source callers | Coordinator refreshes index and runs detect-changes before commit |
| Thấp | Custom API key header name unavailable in Workflow resolve response | Workspace resolved V1 response returns provider/authType/auth only | Uses existing HTTP provider default `X-Api-Key`; do not infer other header names | Future additive Workspace contract if custom header execution is required |
| Thấp | TLS evidence absent | Local fixture is HTTP-only | Report explicitly limits claim to approved-address socket pinning | Add controlled HTTPS fixture before production TLS claim |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Runtime peer/coordinator reviews the owned HTTP files and keeps `weav.workflow.http.executor.enabled=false` in deterministic runtime integration properties.
2. Coordinator runs serialized runtime/full Workflow suites, reviews combined diff, refreshes GitNexus, runs `detect_changes`, and decides commit.

### Cần quyết định / quyền truy cập từ người khác

- Decide whether the current Workspace V1 resolve contract should later carry non-secret `apiKeyHeaderName`; Task 13 does not invent or modify that contract.

### Hướng dẫn cho AI agent tiếp theo

- Read this log, Task 13 plan/spec and `git status` before editing.
- Do not alter runtime/config/ledger files in this lane; do not stage or commit these shared changes.
- Treat GitNexus UNKNOWN/stale output as unresolved until coordinator corroborates it.
- Do not add secrets or raw provider diagnostics to tests/logs.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 02:52 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; HTTP source/tests/POM và shared changes từ các lane khác |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | `Task 13 HTTP adapter recovery` |
| Cần đọc trước khi tiếp tục | Task 13 plan/spec, phần 11 bàn giao, runtime completion log |
