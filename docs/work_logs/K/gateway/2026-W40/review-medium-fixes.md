# Nhật ký: Gateway - sửa các phát hiện mức Thấp (Step 3)

## Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-02 |
| Nhánh | `refactor/optimize-backend` |
| Phạm vi | `services/api-gateway` (không đụng `services/ocr-service`) |
| Trạng thái | Hoàn thành, chờ coordinator review và commit |
| Tham chiếu | `docs/reviews/2026-10-01-backend-review.md` (GW-1, GW-4, X-11, mục 5.5) |

## Quyết định

- Timeout khi ghi (không phải GET/HEAD/OPTIONS) trả `504 UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN`
  thay cho `503`, để client retry với cùng `Idempotency-Key`. GET timeout và lỗi kết nối giữ `503`.
  `createUpstreamAbortHandle` có thêm cờ `timedOut` (chỉ đặt khi deadline hết, không phải client ngắt kết nối).
- Log 4xx ở WARN, 5xx ở ERROR trong `GatewayExceptionFilter`; body/status không đổi.
- X-11: dùng `@nest-lab/throttler-storage-redis` 1.2.0 (peer `@nestjs/throttler >=6`, đang dùng 6.5.0) + `ioredis` 6.
  Bọc bằng `FailOpenThrottlerStorage` (Valkey lỗi -> cho qua + WARN; ghi chú `ponytail:`).
  Biến `GATEWAY_THROTTLER_REDIS_URL` (rỗng = giữ in-memory). Compose dùng `${GATEWAY_THROTTLER_REDIS_URL:-${VALKEY_URL:-}}`.
- GW-4: OCR service đã giới hạn file 10 MiB (`MAX_FILE_BYTES = 10_485_760`), nên gateway dùng
  10 MiB + 64 KiB (overhead multipart, cùng cách với avatar). Vượt `Content-Length` -> `413` trước khi gọi upstream;
  stream chunked vượt ngưỡng -> `413` (đếm byte khi stream, không buffer).
- `Idempotency-Key` đã được forward trên các route ghi (`applyClientForwardingHeaders`, GW-1 đã xong); xác nhận, không đổi.

## File thay đổi

- `src/common/gateway-exception.filter.ts`, `src/common/request-context.ts`
- `src/identity/identity.module.ts`, `src/workflow/workflow.module.ts`, `src/notifications/notifications.module.ts`, `src/workspace/workspace-proxy.service.ts` (504 khi ghi timeout)
- `src/config/gateway.config.ts`, `src/rate-limit/rate-limit.module.ts`, `src/rate-limit/fail-open-throttler-storage.ts` (mới)
- `src/ocr/ocr.service.ts` (cap 413)
- Test: `gateway-exception.filter.spec.ts`, `request-context.spec.ts`, `fail-open-throttler-storage.spec.ts`, `ocr.service.spec.ts`
- `package.json`, `pnpm-lock.yaml`, `.env.example`, `compose.dev.yml`, `README.md`

## Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --dir services/api-gateway test` | 101 passed (baseline 93) |
| `pnpm --dir services/api-gateway test:e2e` | 82 passed (baseline 82) |
| `pnpm --dir services/api-gateway build` | OK |
| `docker compose ... --profile app config -q` | OK |

## Rủi ro / việc tiếp theo

- Throttler dùng Valkey chưa được kiểm thử với Valkey thật (chỉ unit test của wrapper fail-open); cần smoke với Valkey khi deploy nhiều replica.
- Valkey sập -> giới hạn tạm thời không được áp dụng (fail open), giống limiter của identity.
- `VALKEY_URL` trong compose phải là `redis://` hoặc `rediss://`, nếu không gateway sẽ không khởi động (validate cấu hình).
- Impact GitNexus báo CRITICAL nhưng nhiễu (trùng tên với flow web); caller thực tế qua text search: filter chỉ ở `create-app.ts`, `createUpstreamAbortHandle` ở 5 file proxy của gateway (thay đổi chỉ thêm).
