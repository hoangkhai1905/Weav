# Platform - review-medium-fixes (X-9, X-10, X-12, X-13)

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

## X-16 - restart, giới hạn bộ nhớ, healthcheck, image production

- `compose.dev.yml` (7 service backend, không đụng `ocr-service`): `restart: unless-stopped`, `mem_limit`, healthcheck thật.

| Service | mem_limit | Healthcheck |
| --- | --- | --- |
| identity, workspace, workflow | 1g | `curl -fsS localhost:8080/actuator/health/readiness` (image dev có curl); identity vốn đã có, thêm `start_period` 60s cho workspace/workflow |
| api-gateway | 384m | `node -e fetch(.../ready)` (`/ready` nông, không gọi upstream) |
| ai-service | 384m | giữ nguyên `/health/live` |
| bot-service | 384m | `/health` |
| notification-service | 512m | `/ready` (cần RabbitMQ + DB) |

- Java dev chạy `mvnw spring-boot:run` (JVM Maven + JVM app): thêm `MAVEN_OPTS=-Xmx192m`, `JAVA_TOOL_OPTIONS=-XX:MaxRAMPercentage=55` để hai heap không vượt `mem_limit`. Chưa đo tải thật: nếu bị OOM-kill trong dev thì tăng `mem_limit` (workflow chạy worker/executor nặng nhất).
- `depends_on` giữ nguyên (không thêm điều kiện mới); workspace và workflow gọi nhau lúc chạy, không lúc khởi động, nên không tạo vòng.
- `restart: unless-stopped` không tự restart container `unhealthy` (Compose không làm vậy); healthcheck để `docker ps`/orchestrator đọc.
- Image production (file mới `services/<svc>/Dockerfile`, `Dockerfile.dev` giữ nguyên, compose dev vẫn dùng image dev):
  - Java (identity, workspace, workflow), context = thư mục service: `docker build -f services/<svc>/Dockerfile services/<svc>`. Build `eclipse-temurin:25-jdk` (cache `~/.m2`, `-Dmaven.test.skip=true`, nên workflow không cần `packages/contracts`) -> chạy `eclipse-temurin:25-jre-alpine`, `USER 10001`, `java -XX:MaxRAMPercentage=75 -jar /app/app.jar`, HEALTHCHECK bằng busybox `wget` vào `/actuator/health/readiness`.
  - Node (api-gateway, ai-service, notification-service, bot-service), context = gốc repo: `docker build -f services/<svc>/Dockerfile .`. `node:24-alpine`, `pnpm install --filter` + `build` + `pnpm --prod --legacy deploy /out` (`--legacy` vì pnpm 10+ đòi `inject-workspace-packages`; các service không có dependency `workspace:`), chạy `USER node` (uid 1000), `NODE_ENV=production`, `node dist/main.js`, HEALTHCHECK bằng `node -e fetch`. Notification copy thêm `node_modules/.prisma` (Prisma generate ghi vào đó khi build).
  - `.dockerignore` gốc: thêm `tmp/`. Các thư mục service đã có `.dockerignore`.
- Đã build thử: api-gateway (759MB, uid 1000, có `dist/main.js`, khởi động tới bước kiểm tra cấu hình thì dừng vì thiếu `JWT_ACCESS_SECRET`, đúng kỳ vọng) và workspace-service (454MB, uid 10001, `/app/app.jar` 78MB, HEALTHCHECK có trong image). Đã xóa cả hai image. Các service còn lại dùng cùng mẫu, chưa build.
- Chưa kiểm: chạy image production với hạ tầng thật; healthcheck production của Java chưa chạy end-to-end; `mem_limit` dev chưa đo dưới tải; image gateway nặng do `prisma` nằm trong dependencies production của gateway (không thuộc X-16).
- Kiểm tra: `docker compose -f compose.yml -f compose.dev.yml --profile app config -q` OK, cùng với `compose.workflow-smoke.yml` OK.

## X-14 - metric backlog outbox, độ sâu DLQ, endpoint Prometheus

- 3 service Java thêm `io.micrometer:micrometer-registry-prometheus` (version theo Spring Boot BOM) và mở `management.endpoints.web.exposure.include=health,info,prometheus` (không mở env/beans/configprops/heapdump). `SecurityConfig` của từng service `permitAll` `GET /actuator/prometheus` giống `/actuator/health`. Port Java chỉ bind `127.0.0.1` trong `compose.dev.yml` và api-gateway không có route `/actuator/**` (chỉ gọi `/actuator/health/readiness` của upstream), nên metric không ra ngoài; production cần giữ nguyên điều này (không publish port service, hoặc tách management port).
- Gauge outbox (`infrastructure/metrics/OutboxMetrics`, mỗi service một bản; query nhẹ chạy lười khi scrape, cache 30 giây, lỗi DB thì giữ giá trị cũ, không ném):
  - `weav_outbox_pending{outbox}`: dòng chưa publish và chưa FAILED; `weav_outbox_oldest_pending_age_seconds{outbox}`: tuổi dòng pending cũ nhất (0 nếu không có); `weav_outbox_failed{outbox}`: dòng ở trạng thái FAILED.
  - identity: `notification_outbox` (chỉ pending và tuổi; bảng không có trạng thái FAILED); workspace: `notification_outbox`; workflow: `outbox_events` và `notification_outbox` (pending = PENDING/CLAIMED).
- Độ sâu queue (workflow, `RabbitQueueMetrics`): `weav_rabbit_queue_messages{queue}` cho `workflow.executions.v1` và `workflow.executions.v1.dlq`, thăm dò mỗi 30 giây trên thread daemon riêng qua `AmqpAdmin.getQueueInfo`; broker down hoặc queue không tồn tại thì NaN, không chặn scrape/khởi động.
- Hikari: `hikaricp_connections_pending` có sẵn từ registry Prometheus (test xác nhận).
- Test: `OutboxMetricsIntegrationTest` ở cả 3 service (seed dòng pending/FAILED, refresh, kiểm giá trị gauge và `/actuator/prometheus` có `weav_outbox_pending`, `hikaricp_connections_pending`); `RabbitQueueMetricsTest` (đọc DLQ = 7, broker down -> NaN, không ném). Test dùng `@AutoConfigureMetrics` vì Boot 4 tắt export metric trong `@SpringBootTest`; `src/test/resources/application.properties` của workflow/workspace phải thêm `prometheus` vào exposure (file test che file main).
- Kết quả `./mvnw verify`: identity 353 test, 3 error (Avatar minio đã biết), 1 skipped; workspace 412/412; workflow 488/488.
- Chưa làm: alert rule/dashboard Grafana, scrape config Prometheus (chưa có Prometheus trong compose); metric NestJS service.

## X-9 - mỗi service một user RabbitMQ riêng, giới hạn quyền

Mục tiêu: một service bị chiếm không thể publish event của service khác lên `weav.events`. Không đổi mã nghiệp vụ; chỉ đổi cách đọc credential + script cấp quyền.

**Inventory (từ Spring AMQP config và `rabbit.consumer.ts`)**

| Service | Exchange / routing key publish | Queue / exchange khai báo hoặc consume |
| --- | --- | --- |
| identity | `weav.events` (topic): `identity.*` (`google_linked`, `google_unlinked`, `password_changed`, `password_reset`) | không khai báo gì; chỉ publish (mandatory + confirm) |
| workspace | `weav.events`: `workspace.*` (`created`, `renamed`, `member_*`), `connection.*` | không khai báo gì; chỉ publish |
| workflow | `weav.events`: `workflow.*`; `workflow.executions` (direct, key `execute`/`retry`) | khai báo + consume `workflow.executions`, `.dlx`, `.v1`, `.v1.dlq`, `.v1.retry`; declare `weav.events`; metric đọc độ sâu queue (passive declare) |
| notification | không publish | khai báo `weav.events`, quorum queue `notification-service.execution-events.v2`, DLQ `...events.dlq` (DLX = default exchange), queue cũ `...events`; bind `identity.* workspace.* workflow.* connection.*` |

**Quyền mỗi user** (vhost `RABBITMQ_VHOST`, mặc định `/`; tag rỗng):

| User | configure | write | read | topic `weav.events` (write / read) |
| --- | --- | --- | --- | --- |
| identity | `^$` | `^(weav\.events)$` | `^$` | `^identity\.` / `^$` |
| workspace | `^$` | `^(weav\.events)$` | `^$` | `^(workspace\|connection)\.` / `^$` |
| workflow | `^(weav\.events\|workflow\.executions(\..*)?)$` | như configure | `^(workflow\.executions(\..*)?)$` | `^workflow\.` / `^$` |
| notification | `^(weav\.events\|notification-service\..*)$` | `^(notification-service\..*\|amq\.default)$` | `^(weav\.events\|notification-service\..*)$` | `^$` / `^(identity\|workspace\|workflow\|connection)\.` |

Ghi chú: workflow/notification cần `configure` trên `weav.events` vì chúng `declare` exchange này (khai báo lại exchange đã tồn tại cũng cần configure). Tên queue/exchange trong script là mặc định; nếu đổi `NOTIFICATION_QUEUE*`/`NOTIFICATION_EXCHANGE` thì sửa hằng số ở đầu `scripts/rabbitmq-provision-users.mjs`.

**Biến môi trường mới** (`.env.example`, để trống = dùng user chung): `IDENTITY_`, `WORKSPACE_`, `WORKFLOW_`, `NOTIFICATION_` + `RABBITMQ_USERNAME` / `RABBITMQ_PASSWORD`. Spring: `${IDENTITY_RABBITMQ_USERNAME:${RABBITMQ_USERNAME:guest}}`; notification: `settings.ts` lấy biến riêng rồi fallback `RABBITMQ_*` (vẫn bắt buộc có credential). `compose.dev.yml` truyền cả hai (biến riêng mặc định = user chung). Phải đặt CẢ username lẫn password cho một service.

**Script** `node scripts/rabbitmq-provision-users.mjs [--dry-run]`: dùng management API (admin = `RABBITMQ_USERNAME/PASSWORD`, URL = `RABBITMQ_MANAGEMENT_URL` hoặc `http://localhost:${RABBITMQ_MANAGEMENT_PORT:-15672}`), đọc `.env`, không in giá trị bí mật; idempotent (PUT user, permissions, topic-permissions; tạo `weav.events` nếu chưa có); bỏ qua service thiếu username/password; thoát mã khác 0 nếu API lỗi.

**Rollout**: (1) đặt `<SVC>_RABBITMQ_USERNAME/PASSWORD` trong `.env`; (2) chạy script với broker đang chạy; (3) restart service (`docker compose ... up -d`); (4) tùy chọn: sau khi mọi service đã chuyển, đổi/thu hồi user chung (không còn dùng guest). **Rollback**: xóa các biến riêng (để trống) và restart: service quay lại user chung; user riêng có thể để nguyên hoặc `DELETE /api/users/<name>`.

**Bằng chứng** (broker `rabbitmq:4-management` tạm, đã xóa): workflow publish `workflow.completed` OK, publish `identity.password_reset` bị broker đóng channel (ACCESS_REFUSED); identity publish `identity.*` OK, `workflow.failed` bị từ chối; workspace publish `connection.*` OK, `identity.*` bị từ chối; identity tạo queue bị 403 (configure); notification bind key ngoài prefix (`admin.x`) bị 403 (read topic); topology thật của notification (quorum + DLQ qua default exchange) và workflow (exchange/queue/retry/DLX) khai báo được dưới user riêng. Chạy script lần 2 vẫn thành công (idempotent).

Chưa làm (cố ý, không over-engineer): chưa kiểm tra `userId` phía consumer (topic permission của broker đủ cho giai đoạn này; có thể thêm sau để chống service được phép publish nhưng giả userId); chưa đổi user mặc định của container RabbitMQ.

## Kiểm tra

Xem báo cáo coordinator; gateway unit 93, e2e 82 (thêm 1 test `/ready` còn 200 khi upstream down).

Kiểm tra lại (coordinator, 2026-10-02): workflow 472/472; workspace 393/393; identity 349 test, 3 error (Avatar minio đã biết), 1 skipped; gateway unit 93/93, e2e 82/82, build OK; notification unit 100/100, e2e 14/14, build OK; compose config OK.

## Live smoke sau Step 2/3 (2026-10-02)

- `scripts/start-workflow-v1-live-smoke.ps1 -ValidateOnly`: PASS (không tạo schema/container).
- `scripts/start-workflow-v1-live-smoke.ps1` (HEAD `1d78856`): PASS. Auth register/verify/login, tạo workspace qua public API; workflow create 201, draft 200, get 200, list 200, publish 200, admission 202, detail 200; execution `SUCCESS`, correlation id được giữ; `outboundHttpCalls=0`.
- Dọn dẹp: compose project `weav-workflow-smoke-20261002-8504fbd0e6b1` và volume `..._rabbitmq_smoke_data` đã xoá.
- Schema thử nghiệm còn lại trên Neon (giữ để review, chỉ xoá khi người dùng duyệt): `weav_workflow_smoke_identity_20261002_8504fbd0e6b1`, `weav_workflow_smoke_workspace_20261002_8504fbd0e6b1`, `weav_workflow_smoke_workflow_20261002_8504fbd0e6b1`.
- Đã xoá (2026-10-02, người dùng duyệt "Delete all smoke schemas"): trước khi xoá đã liệt kê schema ở cả 4 database, kiểm tra `pg_depend` (chỉ có bảng TOAST của chính schema, không có phụ thuộc bên ngoài), xác nhận không config nào dùng các schema này, tạo Neon backup branch `backup-before-smoke-cleanup-2026-10-02` (`br-proud-bread-b3jppjgr`), rồi `DROP SCHEMA ... CASCADE` theo đúng 3 tên trên. Sau xoá: identity-db = `identity,public`; workspace_db = `public,workspace`; workflow_db = `public,workflow`.
- Còn lại (không phải schema, chưa xoá): dữ liệu smoke của gateway trong schema thật (user `smoke-gw-1790828007@example.test`, workspace `b9595038-…`, connection `e99d91ba-…`, workflow `01f6952a-…`), xem `docs/work_logs/K/gateway/gateway-route-coverage.md` §14.
