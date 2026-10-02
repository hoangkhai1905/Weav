# Platform - review-medium-fixes (X-10, X-12, X-13)

Nhánh `refactor/optimize-backend`. Nguồn: `docs/reviews/2026-10-01-backend-review.md`.

## X-10 - readiness chỉ kiểm tra phụ thuộc của chính service

| Service | Trước | Sau |
| --- | --- | --- |
| api-gateway | `/ready` gọi identity + workspace, 503 nếu một upstream down | `/ready` chỉ trạng thái gateway (200). `GET /ready/upstreams` là chẩn đoán (503 nếu upstream down, vẫn bị throttle, không dùng cho healthcheck) |
| workflow-service | readiness = `readinessState,db,rabbit` | `readinessState,db` (rabbit vẫn bật trong health tổng; outbox retry khi broker lỗi) |
| identity / workspace | `readinessState,db` | giữ nguyên |
| notification-service | `/ready` = rabbit + repo + inbox | giữ nguyên (broker là phụ thuộc cứng của consumer) |
| ai-service | provider + verifier (cấu hình nội bộ) | giữ nguyên |

Compose: chỉ identity (`/actuator/health/readiness`) và ai-service (`/health/live`) có healthcheck; không healthcheck nào trỏ tới `/ready` của gateway.

## X-13 - tên biến RabbitMQ thống nhất

Chuẩn: `RABBITMQ_HOST/PORT/USERNAME/PASSWORD/VHOST/TLS_ENABLED`. Alias cũ vẫn chạy: `RABBITMQ_SSL_ENABLED` (identity, workspace, workflow, notification) và `RABBITMQ_TLS` (notification). `RABBITMQ_VHOST` mặc định `/` ở mọi service (workflow trước đó chưa hỗ trợ vhost/TLS). `compose.dev.yml` truyền tên chuẩn cho identity, workspace, workflow, notification; `.env.example` ghi chú alias.

## X-12 - circuit breaker + cache cho lời gọi workspace <-> workflow

Phụ thuộc mới: `io.github.resilience4j:resilience4j-circuitbreaker:2.3.0` (core, không starter/AOP; property `resilience4j.version`) ở workflow và workspace; `com.github.ben-manes.caffeine:caffeine` (version do Spring Boot BOM quản lý) chỉ ở workflow.

- workflow -> workspace (`WorkspaceClient`): breaker theo count, cửa sổ 20, ngưỡng lỗi 50%, tối thiểu 10 lời gọi, mở 10 s, 3 lời gọi half-open. Chỉ lỗi transport, timeout và 5xx tính là lỗi; 4xx (kể cả 403/404) không tính. Khi mở: ném `WorkspaceDependencyUnavailableException` như hiện tại (caller trả 503), không gọi HTTP. Chuyển trạng thái log WARN một lần (`workspace_circuit_breaker_transition`).
- Cache chỉ cho `getAccess(workspaceId, userId)` (trả về role + capabilities, dùng cho `WorkspaceAuthorization.require` và outbox publisher): TTL 30 s, tối đa 10 000 mục, lưu cả kết quả dương và từ chối (403/404). Không cache lỗi/unavailable. Không cache `resolve` (có credential), `authorizeAttachment`, `reportAuthenticationRejected`.
- workspace -> workflow (`WorkflowConnectionUsageClient.isInUse`): cùng cấu hình breaker; khi mở ném `DependencyUnavailableException` (delete/disable vẫn fail-closed). Không cache.
- Cấu hình (có mặc định, không cần env): `weav.workflow.workspace-client.circuit-breaker.{window-size,failure-rate-percent,minimum-calls,open-duration,half-open-permits}`, `weav.workflow.workspace-client.access-cache-ttl` (workflow); `weav.workflow.circuit-breaker.*` (workspace).
- Hành vi người dùng thấy: đổi quyền/thành viên có thể mất tối đa 30 s để áp dụng ở workflow-service.
- Test: breaker mở sau 5xx/timeout rồi fail-fast không gọi HTTP, half-open -> closed; 4xx không mở; cache hit/miss theo workspace/user, hết hạn theo ticker, từ chối được cache, lỗi không cache, resolve không cache; workspace: breaker mở -> delete fail-closed, 4xx không mở.
- Kiểm tra: workflow 478/478 (472 + 6 mới), workspace 395/395 (393 + 2 mới).

## X-7 / WS-14 - service JWT có scope thay cho khóa nội bộ tĩnh

Workflow ký JWT RS256 sống 60 s (cùng cặp khóa với lời gọi sang ai-service, `ServiceJwtSigner`); workspace xác thực bằng JWKS của workflow. Khóa tĩnh `WEAV_INTERNAL_SERVICE_KEY` vẫn dùng được trong giai đoạn chuyển tiếp.

| Endpoint workspace | scope | claim phải khớp path |
| --- | --- | --- |
| `GET /internal/workspaces/{ws}/users/{uid}/access` | `workspace:access` | `workspace_id` |
| `POST .../connections/{cid}/resolve` | `connection:resolve` | `workspace_id`, `connection_id` |
| `POST .../connections/{cid}/auth-failure` | `connection:report-auth-failure` | `workspace_id`, `connection_id` |
| `POST .../connections/{cid}/authorize-attachment` | `connection:authorize-attachment` | `workspace_id`, `connection_id` |

- Claim: `iss=weav-workflow`, `aud=weav-workspace`, `scope`, `workspace_id`, `connection_id` (nếu path có), `iat`, `exp` (60 s), `jti`. Workspace kiểm: chữ ký RS256 + `kid` trong JWKS, iss/aud, `exp` chưa quá hạn quá 10 s, `iat` không ở tương lai quá 10 s, `exp - iat <= 70 s`, scope, id khớp path. Sai bất kỳ điều gì -> 401 envelope hiện có (không nói lý do); lý do ghi log WARN `event=internal_service_jwt_rejected reason=...` (không có token). JWT sai không được "cứu" bằng khóa tĩnh.
- workflow `WorkspaceClient`: có signer (khi `WORKFLOW_AI_SIGNING_KEY_ID` và `WORKFLOW_AI_SIGNING_KEY_LOCATION` đều có giá trị) -> gửi `Authorization: Bearer <jwt>` + vẫn gửi `X-Internal-Service-Key` nếu có cấu hình. Không có signer -> chỉ header cũ như trước. Ký lỗi -> log WARN, rơi về header cũ.
- workspace `InternalServiceKeyFilter`: Bearer hợp lệ -> OK; không có Bearer (hoặc không đọc được JWKS) -> khóa tĩnh, trừ khi `WORKSPACE_INTERNAL_REQUIRE_SERVICE_JWT=true` (khi đó chỉ nhận JWT, thiếu JWKS thì fail-closed). Filter đặt `Authentication` và `SecurityConfig` dùng `authenticated()` cho `/internal/workspaces/**` (thay `permitAll`); bearer resolver của resource-server bỏ qua đường dẫn internal để JWT RS256 không bị decoder HS256 từ chối.
- WS-14: `WEAV_INTERNAL_SERVICE_KEY` có giá trị thì phải >= 32 ký tự, nếu không workspace fail khi khởi động (record `InternalServiceKeyProperties`). Để trống vẫn hợp lệ (endpoint fail-closed). `.env` dev hiện tại đã >= 32. Test dùng khóa 40 ký tự.
- Env mới: `WORKSPACE_SERVICE_JWKS_FILE` (compose.dev.yml: `/run/weav-keys/workflow-service.jwks.json`, mount ro `${WEAV_SERVICE_KEYS_DIR:-./tmp/service-keys}/public`), `WORKSPACE_INTERNAL_REQUIRE_SERVICE_JWT` (mặc định `false`, có trong `.env.example` và `.env`).
- Test: workspace `InternalServiceJwtVerifierTest` (6: đúng scope/id cho 4 endpoint; sai scope/workspace_id/connection_id/thiếu connection_id; hết hạn/sai aud/sai iss/sai chữ ký; JWT sai không rơi về khóa tĩnh; cờ require; thiếu file JWKS), `InternalServiceKeyFilterTest` (+2: require chặn khóa tĩnh, khóa ngắn fail startup); workflow `WorkspaceClientTest` (+2: JWT đúng claim/scope theo từng lời gọi + vẫn gửi khóa cũ; không signer thì không có Bearer).
- Kiểm tra: workflow 480/480 (478 + 2), workspace 403/403 (395 + 8); `git diff --check` sạch; `docker compose config -q` OK (dev và dev + workflow-smoke).

Rollout:
1. `node scripts/ai-dev-keys.mjs` (tạo `tmp/service-keys/{private,public}`), đặt `WORKFLOW_AI_SIGNING_KEY_ID` (mặc định `workflow-dev-1` trong compose) cho workflow.
2. Chạy lại stack (`docker compose ... up -d --build workflow-service workspace-service`): workflow bắt đầu gửi JWT, workspace xác thực bằng JWKS đã mount; khóa tĩnh vẫn còn làm dự phòng.
3. Xác nhận không còn log `internal_service_jwt_rejected` / `internal_service_jwks_unavailable`, rồi đặt `WORKSPACE_INTERNAL_REQUIRE_SERVICE_JWT=true` cho workspace.
4. Sau một thời gian ổn định: bỏ `WEAV_INTERNAL_SERVICE_KEY` khỏi workflow và workspace (và `compose.workflow-smoke.yml`).
Lưu ý: overlay `compose.workflow-smoke.yml` không mount khóa nên vẫn dùng khóa tĩnh (cờ require phải để `false`). Production: mount JWKS vào workspace, cấp khóa riêng cho workflow, không commit khóa.

## Kiểm tra

Xem báo cáo coordinator; gateway unit 93, e2e 82 (thêm 1 test `/ready` còn 200 khi upstream down).

Kiểm tra lại (coordinator, 2026-10-02): workflow 472/472; workspace 393/393; identity 349 test, 3 error (Avatar minio đã biết), 1 skipped; gateway unit 93/93, e2e 82/82, build OK; notification unit 100/100, e2e 14/14, build OK; compose config OK.
