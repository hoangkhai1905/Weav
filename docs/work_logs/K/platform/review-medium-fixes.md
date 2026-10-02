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

## Kiểm tra

Xem báo cáo coordinator; gateway unit 93, e2e 82 (thêm 1 test `/ready` còn 200 khi upstream down).

Kiểm tra lại (coordinator, 2026-10-02): workflow 472/472; workspace 393/393; identity 349 test, 3 error (Avatar minio đã biết), 1 skipped; gateway unit 93/93, e2e 82/82, build OK; notification unit 100/100, e2e 14/14, build OK; compose config OK.
