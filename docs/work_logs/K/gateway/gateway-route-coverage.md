# Nhật ký: API Gateway - phủ route còn thiếu và sửa lỗi liên quan

## 1. Metadata

| Trường                  | Giá trị                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| Ngày làm việc           | `2026-10-01`                                                                     |
| Múi giờ ghi log         | `Asia/Saigon`                                                                    |
| Dự án / repository      | Weav, `services/api-gateway`                                                     |
| Nhánh                   | `refactor/optimize-backend` (chưa commit)                                        |
| Người thực hiện         | AI agent theo yêu cầu của K                                                      |
| Trạng thái              | `Hoàn thành` (chưa commit); chờ review                                           |
| Phạm vi session         | Đưa các route của service chưa có ở Gateway lên Gateway và sửa lỗi tiềm ẩn       |
| Liên kết liên quan      | [api-gateway spec](../../../specs/services/api-gateway.md), [gateway contract](../../../../packages/contracts/http/gateway/README.md) |

## 2. Tóm tắt điều hành

- Thêm route Gateway: Identity (`oauth-accounts`, `avatar` GET/PUT/DELETE, `admin/users` list/detail/status), Workspace (`credential` PUT/DELETE), Workflow (`workflows/generate`, webhook công khai `POST /api/v1/webhooks/:endpointKey`).
- Sửa lỗi Gateway: `X-Forwarded-For` lấy từ IP client do Gateway suy ra (không sao chép giá trị client), chuyển tiếp `Idempotency-Key` hợp lệ, security headers, `trustProxy` cấu hình được, throttler `webhook` theo endpoint key, `enableShutdownHooks`, UUID chặt cho notification `:id/read` và OCR `workspaceId`.
- Contract OpenAPI Gateway: 17 -> 19 operations.

| Hạng mục        | Trạng thái | Ghi chú                              |
| --------------- | ---------- | ------------------------------------ |
| Build / tsc     | PASS       | `pnpm exec tsc --noEmit -p tsconfig.json` |
| Unit            | PASS       | 92/92                                |
| E2E             | PASS       | 80/80 (6 suites, có `routes.e2e-spec.ts` mới) |
| Lint            | 9 lỗi còn lại, đều có sẵn ở dòng không đổi | `notifications.module.ts` 2, `workflow.module.spec.ts` 7 |
| Commit / PR     | Chưa tạo   | Theo yêu cầu: không commit           |

## 3. Mục tiêu và phạm vi

### Ngoài phạm vi / chủ động chưa làm

- Luồng cookie/OAuth của Identity (`/auth/web/*`, Google OAuth start/exchange/callback, link, unlink) giữ nguyên gọi thẳng Identity; callback Google của Workspace cũng vậy.
- Không đổi ngữ nghĩa timeout 503 -> 504 (cần cập nhật contract).
- Không thêm Valkey cho throttler, circuit breaker, giới hạn byte cho OCR upload, dependency mới.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Cookie/OAuth browser flow ở lại Identity | Cần cookie/redirect gắn với origin Identity; đổi sẽ phá luồng hiện có | Web vẫn gọi Identity trực tiếp (cả danh sách `oauth-accounts`) |
| Không đổi 503 -> 504 | Đổi status là thay đổi contract công khai | Ghi vào next steps |
| Không thêm dependency | Dùng `fetch`, Fastify, zod, Nest sẵn có | Không đổi lockfile |
| Kiểm tra ADMIN ở edge cho `/api/admin/users` | Từ chối sớm, không gọi upstream; Identity vẫn kiểm tra lại | 403 không có upstream call |
| `X-Forwarded-For` đặt từ `request.ip`, `trustProxy` mặc định tắt | Không để client giả IP/né rate limit | Cần `GATEWAY_TRUST_PROXY_HOPS` khi sau load balancer |

### Nguyên nhân test e2e admin lỗi

`test/routes.e2e-spec.ts` "limits admin routes...": test chunked avatar trước đó bị Gateway hủy giữa chừng; fixture upstream ghi nhận request `PUT /users/me/avatar` bị hủy này bất đồng bộ, sau khi test kế tiếp đã `fixtureRequests.length = 0`, nên mảng request của test admin có thêm một dòng. Là lỗi cách ly test, không phải lỗi code Gateway (admin trả 403/400 không gọi upstream đúng ý). Sửa test: đợi fixture ghi nhận request bị hủy trước khi kết thúc test chunked, hủy socket client, và `closeAllConnections()` ở `afterAll` (socket body chưa đọc hết khiến `app.close()` treo). Đã thử thêm `Connection: close` ở code nhưng client nhận `ECONNRESET` trước khi đọc 413, nên hoàn tác.

## 7. Thay đổi đã thực hiện

- Code: `identity.module.ts`, `workspace.controller.ts`, `workspace-proxy.service.ts`, `workflow.module.ts`, `common/request-context.ts`, `config/gateway.config.ts`, `create-app.ts`, `rate-limit/*`, `main.ts`, `notifications.module.ts` (UUID_PATTERN), `ocr/ocr.service.ts`.
- Cấu hình mới: `GATEWAY_TRUST_PROXY_HOPS` (0-10, mặc định 0), `GATEWAY_WEBHOOK_RATE_LIMIT` (mặc định 60). Thêm vào `.env.example`, `compose.dev.yml` (gateway) và `.env` (cùng giá trị mặc định, không in nội dung).

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/api-gateway/src/**` (xem mục 7) | Route mới và sửa lỗi |
| Sửa | `services/api-gateway/test/transport.e2e-spec.ts`, `test/workspace.e2e-spec.ts`, `src/config/gateway.config.spec.ts` | Cập nhật kỳ vọng |
| Thêm | `services/api-gateway/test/routes.e2e-spec.ts` | Suite e2e cho route mới (13 test) |
| Sửa | `packages/contracts/http/gateway/openapi.yaml`, `README.md` | 19 operations, credential PUT/DELETE |
| Sửa | `docs/specs/services/api-gateway.md`, `services/api-gateway/README.md` | Cập nhật trạng thái, route, cấu hình |
| Sửa | `.env.example`, `compose.dev.yml` | Hai biến mới |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh (từ `services/api-gateway`) | Kết quả |
| --- | --- | --- |
| tsc | `pnpm exec tsc --noEmit -p tsconfig.json` | PASS |
| Unit | `pnpm test --runInBand --silent` | 92/92 |
| E2E | `pnpm test:e2e --runInBand --silent` | 80/80 |
| Lint | `pnpm exec eslint "{src,test}/**/*.ts"` | 9 lỗi có sẵn (không chạy `pnpm lint` vì `--fix`) |
| Diff | `git diff --check` | sạch (cảnh báo CRLF của spec đã có sẵn) |
| Compose | `docker compose -f compose.yml -f compose.dev.yml --profile app config -q` | OK |

### Điều chưa được kiểm tra

- Chưa chạy với Identity/Workspace/Workflow thật; chưa có smoke test trình duyệt (chỉ fixture upstream).

## 10. Rủi ro

| Mức độ | Vấn đề | Xử lý / bước tiếp theo |
| --- | --- | --- |
| Trung bình | Identity vẫn bỏ qua `X-Forwarded-For` đến khi cấu hình `server.forward-headers-strategy` | Cấu hình ở Identity |
| Trung bình | Cổng Identity còn mở trực tiếp, nên chưa thể tin `X-Forwarded-For` | Đóng cổng trước khi bật trust |
| Thấp | Web client vẫn gọi Identity trực tiếp cho danh sách oauth-accounts | Chuyển sang Gateway khi sửa client |
| Thấp | Upload chunked bị hủy để socket mở cho đến timeout của Node | Theo dõi; cân nhắc giới hạn ở tầng server |

## 11. Việc tiếp theo

1. Cấu hình `server.forward-headers-strategy` cho Identity.
2. Throttler dùng Valkey khi chạy nhiều replica.
3. Trả URL webhook của Gateway trong response publish của Workflow.
4. Giới hạn byte cho OCR upload.
5. Ngữ nghĩa 504 cho timeout, kèm cập nhật contract.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Trạng thái worktree | Có thay đổi chưa commit |
| Commit/PR | Chưa tạo |
| Người cập nhật log | AI agent |

## 14. Live smoke (Docker)

Ngày: 2026-10-01. Dịch vụ đã chạy: rabbitmq, identity-service, workspace-service, workflow-service, api-gateway (trước đó chưa có container nào chạy; đã `stop` hết sau khi test, không xóa image). Dữ liệu thật trên Neon.

| Route (qua Gateway :3000) | Kỳ vọng | Thực tế |
| --- | --- | --- |
| `/ready` | 200 | 200 (sau ~40s khởi động) |
| `POST /api/auth/register`, `POST /api/auth/login` | 201 / 200 | 201 / 200 |
| Header bảo mật (`nosniff`, `DENY`, `no-referrer`) | có | có (cả 2xx lẫn 4xx) |
| `GET /api/users/me/oauth-accounts` | 200 | 200 (`[]`) |
| `GET /api/admin/users`, `GET /api/admin/users/:id`, `PATCH .../status` (token USER) | 403 | 403 |
| `GET /api/users/me/avatar` (chưa có) | 404 | 404 |
| `PUT /api/users/me/avatar` (PNG 1x1, multipart `file`) | 200 | 200 |
| `GET /api/users/me/avatar` (sau PUT) | 200 | 200 (trả `url` presigned R2) |
| `DELETE /api/users/me/avatar` | 204 | 204 |
| `PUT /connections/:cid/credential` (có `Idempotency-Key`) | 200 | 200 (`hasCredential:true`) |
| `DELETE /connections/:cid/credential` | 200 | 200 (`hasCredential:false`) |
| `POST /workflows` (có `Idempotency-Key`), `PUT .../draft`, `POST .../publish` | 201 / 200 / 200 | 201 / 200 / 200 (định nghĩa cần cả `trigger.manual`) |
| `POST /api/v1/webhooks/:key` + secret đúng | 202 | 202 (`executionId`, QUEUED) |
| Webhook sai secret / thiếu secret | 404 generic | 404 `WEBHOOK_NOT_FOUND` |
| `POST /workflows/generate` (AI tắt) | lỗi upstream sạch | 503 `AI_UNAVAILABLE` (không phải 502); body rỗng 400; không token 401 |
| `pause` / `resume` có `Idempotency-Key` | 200 | 200 / 200 |

Dữ liệu test còn lại trên Neon: user `smoke-gw-1790828007@example.test`, workspace `b9595038-a5f3-4b4c-9a51-1f594001126b`, connection `e99d91ba-a84f-4a15-8dc7-d4ef36538487`, workflow `01f6952a-ba3f-407c-90de-8d837d29aee8` (đã publish, 1 execution QUEUED). Không chạy SQL xóa.

Vấn đề: không có 5xx ở Gateway. Gateway log các 4xx kỳ vọng ở mức ERROR (`GatewayExceptionFilter`) gây nhiễu log. Publish response không trả URL webhook của Gateway (đã nằm ở mục 11). Chưa kiểm tra tận nơi việc Workflow nhận `Idempotency-Key` (chỉ xác nhận không gây lỗi).
