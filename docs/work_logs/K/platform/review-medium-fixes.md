# Platform - review-medium-fixes (X-10, X-13)

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

## Kiểm tra

Xem báo cáo coordinator; gateway unit 93, e2e 82 (thêm 1 test `/ready` còn 200 khi upstream down).

Kiểm tra lại (coordinator, 2026-10-02): workflow 472/472; workspace 393/393; identity 349 test, 3 error (Avatar minio đã biết), 1 skipped; gateway unit 93/93, e2e 82/82, build OK; notification unit 100/100, e2e 14/14, build OK; compose config OK.
