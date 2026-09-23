# Nhật ký: Workflow Service V1 — Task 4

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex Task 4 worker |
| Người nhận bàn giao | Coordinator `/root` |
| Trạng thái Task 4 | Hoàn thành implementation và kiểm tra; coordinator review pending |
| Phạm vi | JWT/security boundary, Workspace client/authorization ports, correlation ID và error handling |
| Commit/PR | Chưa tạo |

## 2. Kết quả

- Workflow xác thực access JWT theo claim contract của Identity; public routes không còn dùng HTTP Basic hoặc miễn xác thực `/auth/**`.
- Internal connection-usage route yêu cầu `X-Internal-Service-Key` riêng; key không thay thế JWT cho public routes. Webhook exemption chỉ áp dụng đúng `POST /webhooks/*` để Task 17 xác thực secret.
- Workspace access/connection operations dùng đúng contract hiện có, giới hạn timeout, kiểm tra response IDs và credential shape, không cache quyền/credential, và trả lỗi đã khử dữ liệu nhạy cảm.
- Correlation ID được chuẩn hóa hoặc sinh UUID, truyền xuống Workspace và trả lại cùng structured error response.

| Hạng mục | Trạng thái | Bằng chứng |
| --- | --- | --- |
| Focused security/client/error tests | PASS | 38 tests, 0 failures/errors/skips |
| Toàn bộ Workflow module | PASS | 118 tests, 0 failures/errors/skips; PostgreSQL Testcontainers round-trip pass |
| Diff/trailing whitespace | PASS | `git diff --check`; PowerShell scan không tìm thấy trailing whitespace trong file Task 4 |
| Runtime với Workspace service đang chạy | Chưa chạy | Workspace client được kiểm tra bằng HTTP contract stub; không khởi động toàn bộ Compose stack |
| Commit/PR | Chưa tạo | Đang chờ coordinator review; không stage/commit/push |

## 3. Phạm vi và tiêu chí

### Trong phạm vi

- Sửa `SecurityConfig`, `JwtProperties`, `GlobalExceptionHandler`, `application.properties` và test config.
- Thêm Workspace access/connection ports, authorization service, HTTP client/configuration, closeable resolved credential holder, internal-key filter và correlation filter.
- Thêm/update security, client và exception-handler regressions; cập nhật work log và Task 4 report.

### Ngoài phạm vi

- Không sửa Compose, `.env.example`, Task 1–3 domain/mapping/schema, kế hoạch/ledger hoặc API của Workspace/Identity.
- Không triển khai webhook secret verification (Task 17), public authoring routes hoặc connection usage controller.
- Không staging, commit hay push.

### Tiêu chí hoàn thành

- [x] JWT actor lấy từ token đã verify, với Identity issuer/audience/claims contract và không tin actor do client gửi.
- [x] Internal key và public bearer JWT được tách biệt theo route/method chính xác.
- [x] Workspace quyền/capabilities là authoritative; kiểm tra workspace/user IDs; failure/timeout/malformed response fail closed.
- [x] Credential holder không serializable, `toString` được redaction, đóng holder sẽ bỏ references; không hứa zeroize Java `String`.
- [x] Error/log/correlation không làm lộ token, key, body hoặc response gốc.
- [x] Focused tests, module suite, diff check và tài liệu bàn giao hoàn tất.

## 4. Bối cảnh và quyết định

- Nguồn contract là Workflow spec/plan, Workspace usage API và Workspace source, cùng Identity JWT issuer/validator conventions. Không tạo role-to-capability policy cục bộ: `WorkspaceAuthorization` kiểm tra đúng capability được truyền vào.
- JWT chỉ cấu hình access secret/issuer/audience/clock skew. Decoder chấp nhận HS256, yêu cầu Identity access-token claims và từ chối refresh tokens, malformed UUIDs, sai signature hoặc token hết hạn.
- Internal-key filter chỉ bảo vệ `GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage`. Thiếu key cấu hình hoặc key sai đều từ chối; một key hợp lệ không cấp quyền vào route public.
- Correlation ID chấp nhận tối đa 128 ký tự theo `[A-Za-z0-9._:-]`; giá trị sai/mất được thay bằng UUID và MDC luôn được dọn sau request.
- Workspace client giữ exact Workspace paths/payloads; resolve không có request body và yêu cầu `Cache-Control: no-store`. Redirect bị cấm; connect/read timeouts được giới hạn tối đa 60 giây; JSON được parse strict. Quyền sai/không tìm thấy được map sang lỗi generic; transport/malformed responses fail closed thành dependency-unavailable, không giữ downstream cause.
- Secret/config được đọc qua environment placeholders; không ghi giá trị secret vào log/tài liệu. Không sửa `.env.example` hoặc Compose ngoài phạm vi.

## 5. Thay đổi đã thực hiện

### Code và hành vi

- `SecurityConfig` thiết lập stateless JWT resource server, structured 401/403, tắt Basic, giữ public health probes, internal-key boundary và exact webhook method/path exemption.
- `WorkspaceAccessPort`/`WorkspaceConnectionPort` xác định các application boundary; `WorkspaceAuthorization` kiểm tra capability từ Workspace và khớp workspace/user IDs.
- `WorkspaceClient` gọi bốn Workspace operations có trong contract: đọc access, authorize attachment, resolve connection và report authentication rejection. Request mang service key và correlation ID nếu hợp lệ; response kiểm tra status, shape, ID, cache policy và các trường credential.
- `ResolvedConnection` là holder không phải record/không serializable, redacted `toString`, closeable và không giữ references sau khi đóng. Không cache access hoặc credentials.
- `GlobalExceptionHandler` thêm lỗi Workspace dependency 503, giữ nguyên `ApiErrorResponse`, trả `X-Correlation-ID` trên structured errors, và chỉ log event/request ID/error type thay vì stack trace, URI hay downstream response.
- `application.properties` khai báo JWT, inbound key, Workspace URL/timeouts và outbound key qua placeholders. Test properties dùng giá trị tổng hợp.

### Cấu hình và tích hợp theo dõi

- Giá trị dự kiến: `JWT_ACCESS_SECRET`, `WORKFLOW_INTERNAL_SERVICE_KEY`, `WORKSPACE_SERVICE_URL`, `WEAV_INTERNAL_SERVICE_KEY`; secret chỉ cần được cung cấp ở runtime.
- Compose chưa truyền đủ Workspace URL và hai service-key variables vào container Workflow. Với cấu hình thiếu, outbound/internal authorization fail closed; Task 21 cần nối environment/config hiện có trước khi bật cross-service path trong Compose. Không sửa Compose trong lane này.
- Webhook path hiện chỉ bypass JWT tại boundary theo Task 4; xác thực webhook secret vẫn là Task 17.

## 6. Danh sách file Task 4

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/JwtProperties.java` | Access-only JWT configuration |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/SecurityConfig.java` | JWT resource server và route/filter boundary |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/InternalServiceKeyFilter.java` | Exact internal route key validation |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/CorrelationIdFilter.java` | Safe request correlation ID lifecycle |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/GlobalExceptionHandler.java` | Structured safe error responses và Workspace 503 mapping |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkspaceAccessPort.java` | Authoritative access DTO/port |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkspaceConnectionPort.java` | Connection authorization/resolution port |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/ResolvedConnection.java` | Closeable redacted credential holder |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/port/out/WorkspaceDependencyUnavailableException.java` | Sanitized upstream dependency failure |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/application/service/WorkspaceAuthorization.java` | Capability and response-ID checks |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java` | Contract-aligned HTTP adapter |
| Thêm | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClientProperties.java` | Base URL, bounded timeouts, redacted key config |
| Sửa | `services/workflow-service/src/main/resources/application.properties` | Runtime property placeholders/defaults |
| Thêm/sửa | `services/workflow-service/src/test/java/com/weav/workflow/presentation/http/WorkflowSecurityTest.java` | JWT, internal-key, actor, capability and correlation regressions |
| Thêm | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/workspace/WorkspaceClientTest.java` | Contract, malformed/timeout, ID and credential handling |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/SecurityConfigTest.java` | `/auth/**` no longer treated as public; Basic rejected |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/web/GlobalExceptionHandlerTest.java` | Correlated/sanitized structured error regressions |
| Sửa | `services/workflow-service/src/test/resources/application.properties` | Synthetic test-only security/client configuration |

## 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| TDD RED | Test compile trước khi Task 4 production symbols có mặt | Test compile dừng vì các Workspace client/security symbols chưa được định nghĩa | Lỗi compile mong đợi; không phải production failure |
| Focused Task 4 | `-Dtest=WorkflowSecurityTest,WorkspaceClientTest,SecurityConfigTest,GlobalExceptionHandlerTest test` | PASS: 38 tests; 0 failures/errors/skips | Client dùng local HTTP contract stub, chưa chạy Workspace thật |
| Full Workflow module | `mvnw.cmd ... test` | PASS: 118 tests; 0 failures/errors/skips | Gồm ArchUnit, persistence và Docker-backed PostgreSQL JSONB round-trip |
| Containers | Testcontainers trong full suite | Docker Desktop 29.8.0; PostgreSQL 18.6 fixture khởi chạy thành công | Không khởi chạy application Compose stack |
| Static/diff | `git diff --check` và PowerShell trailing-whitespace scan trên file Task 4 | PASS | Graph worker thay đổi file thuộc Tasks 2–3 độc lập trên cùng checkout |

Các lệnh Maven được chạy trong `services/workflow-service` với Maven-home junction đã xác minh trỏ tới `C:\Users\nhoan\.m2`, `-Dmaven.repo.local=C:\Users\nhoan\.m2\repository`, và `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` để Testcontainers dùng timezone ổn định. Focused command:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' '-Dtest=WorkflowSecurityTest,WorkspaceClientTest,SecurityConfigTest,GlobalExceptionHandlerTest' test
```

Full-suite command:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dmaven.repo.local=C:\Users\nhoan\.m2\repository' test
```

Full suite emitted existing Mockito inline/dynamic-agent warnings under JDK 25; compilation had no source warnings. No standalone live-service/Compose test was run.

## 8. GitNexus, risks and blockers

- GitNexus index was stale. `SecurityConfig`/`JwtProperties` impact returned `UNKNOWN`; targeted source search and inspection were used to corroborate affected references. `UNKNOWN` remains unresolved graph coverage, not an all-clear.
- `GlobalExceptionHandler.respond` reported HIGH risk with 9 direct callers and 3 indexed flows. The change preserves the standard error envelope/status and has dedicated regression tests; coordinator review remains important.
- Cross-service deployment wiring for the three environment values above remains outside Task 4 (Task 21). Workspace routes have a local HTTP contract test, but no live Workspace service integration test was run.
- No blocker remained for code completion. `git diff --check` was run, but GitNexus `detect_changes` was not run because no commit is being created; it remains required before a future commit.

## 9. Trạng thái bàn giao

1. Coordinator review Task 4 diff and combine with Tasks 1–3 after their independent review.
2. Ensure Task 21 wires Workspace service URL and internal keys into runtime configuration without exposing secret values.
3. Keep webhook verification owned by Task 17; current exact POST exemption does not mean webhook auth is implemented.
4. Before any commit, review the complete shared worktree and run GitNexus change detection per `AGENTS.md`.

Không stage, commit hoặc push. Shared worktree also contains Task 1–3 files owned by other workers; this report covers Task 4 only.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 16:21 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit ở Tasks 1–4 và planning artifacts |
| Người cập nhật log | Codex Task 4 worker |
| Cần đọc tiếp | Spec, Workflow plan Task 5+; Task 4 report; Compose config wiring tracked for Task 21 |
