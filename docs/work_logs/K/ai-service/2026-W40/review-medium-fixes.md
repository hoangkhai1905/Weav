# Nhật ký: ai-service review medium fixes (AI-1, AI-3)

Nguồn: `docs/reviews/2026-10-01-backend-review.md` (AI-1, AI-3). Nhánh `refactor/optimize-backend`. Trạng thái: code xong, chờ coordinator review/commit. Người dùng đồng ý "8. ok" (AI-1 requestId ổn định + dedup, AI-3 kiểm tra ngữ nghĩa).

## Quyết định

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| `RequestDedup` (map in-flight + cache kết quả TTL 5 phút, tối đa 1000, đẩy entry cũ nhất), khóa `${workspaceId}:${requestId}`, đặt trong controller trước `Admission` | Retry/crash-recovery cùng attempt không bị tính tiền hai lần; bản trùng không chiếm slot | Chỉ cache kết quả thành công; lỗi không cache. `// ponytail:` chỉ theo từng replica, chuyển Valkey nếu ai-service scale-out |
| Kiểm tra đồ thị bằng `superRefine` trên `intent` | Khai báo trong schema hiện có, lỗi vẫn là `AI_OUTPUT_INVALID` (502) như mọi lỗi schema khác | Không thêm mã/HTTP status mới |
| Không thêm header correlation-id | ai-service chưa đọc header nào như vậy; cần đổi cả hai phía | Bỏ qua (xem việc tiếp theo) |

## Thay đổi

- `src/infrastructure/request-dedup.ts` (mới) và `ai.controller.ts` (bọc luồng chạy bằng `dedup.run`). GitNexus impact `AiController`: UNKNOWN (không có caller được index); xác nhận bằng grep: chỉ được đăng ký trong `ai.module.ts`.
- `generation-result.ts`: cạnh trỏ tới node có thật, đúng một `trigger.manual`, đồ thị không có chu trình (Kahn), mỗi `config` ≤ 16 KB, cả intent ≤ 256 KB, mọi URL (chuỗi dạng `scheme://` hoặc khóa kết thúc bằng `url`) phải là http(s) và không phải localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8, `::1`, fc00::/7, fe80::/10, `*.localhost|internal|local`. Id node trùng đã có sẵn. GitNexus impact `generationResultSchema`: CRITICAL (kéo theo cả class); caller thật chỉ là `application/generate.ts`.
- Không có helper sàng lọc URL dùng chung trong ai-service hay `packages/shared`, nên viết hàm nhỏ trong cùng file.

## Kiểm tra

- `pnpm --dir services/ai-service test`: 86 test pass (thêm `request-dedup.spec.ts` 4 test, 16 ca từ chối + 1 ca chấp nhận của `generate`).
- `pnpm --dir services/ai-service test:e2e`: 21 pass. `pnpm --dir services/ai-service build`: OK.
- eslint (`exec eslint "{src,test}/**/*.ts"`): vẫn 177 lỗi, đa số prettier/CRLF và quy tắc `no-unsafe-*` có sẵn từ trước ở nhiều file; không sửa hàng loạt để giữ diff nhỏ.

## Rủi ro / việc tiếp theo

- Dedup không so sánh nội dung body: cùng `requestId` khác body trả kết quả cũ. Workflow chỉ tái dùng id cho cùng execution/node/attempt nên chấp nhận.
- Cùng attempt đang chạy dở bị abort rồi worker khác chạy lại: bản trùng đợi chung một promise; nếu bản đầu lỗi thì bản chờ cũng lỗi (không cache) và engine retry.
- Correlation id workflow -> ai-service chưa truyền (cần đổi cả hai phía).

## Bước 3 (Low): AI-6, AI-8, AI-9, X-15 (phía ai-service), BOT-1

- AI-6: `infrastructure/auth/load-verifier.ts` (tách khỏi `main.ts`) ghi log lỗi nạp JWKS (chỉ tên class lỗi và đường dẫn file, không nội dung khóa); readiness vẫn 503.
- AI-8: `ai.controller.ts` xác thực JWT trước khi kiểm tra cấu hình. Chưa có verifier (JWKS lỗi) -> luôn 401; có verifier mà thiếu provider -> 503 `AI_NOT_CONFIGURED` chỉ cho caller đã xác thực. Dedup vẫn chạy sau xác thực.
- AI-9: `infrastructure/llm/circuit-breaker-provider.ts` bọc provider trong `main.ts` (không sửa `DeepSeekProvider`). Mở sau 5 lỗi liên tiếp `AI_PROVIDER_UNAVAILABLE`/`AI_TIMEOUT`, mở 30 s trả ngay `AI_PROVIDER_UNAVAILABLE` (503, workflow coi là tạm thời), rồi cho 1 request thử (half-open). Lỗi output/auth không được tính. Log WARN khi đổi trạng thái. Hạn chế: client ngắt kết nối cũng có thể thành `AI_TIMEOUT` và bị tính.
- X-15: đọc `X-Correlation-ID` (cùng tên header gateway dùng), hợp lệ khi `^[A-Za-z0-9._:-]{1,128}$`, đưa vào log của request và trả lại trong response (kể cả lỗi); giá trị sai bị bỏ qua. Không OpenTelemetry. Workflow chưa gửi header (lane sau).
- BOT-1 (bot-service, scaffold chưa nối vào hệ thống): thêm `GET /health`, `enableShutdownHooks()`, `bootstrap().catch` log + exit 1, và `DenyAllGuard` toàn cục (403 mọi route trừ `@Public()`). Route `GET /` cũ giờ trả 403; sửa e2e bot (dùng Fastify `inject`, vì `platform-express` không được cài nên e2e cũ vốn đã lỗi).
- Kiểm tra: ai-service `test` 90 pass (baseline 86), `test:e2e` 23 pass (baseline 21), `build` OK; bot-service `test` 1, `test:e2e` 2, `build` OK. eslint từng file file mới sạch, `ai.e2e-spec.ts` giữ nguyên 11 lỗi có sẵn.
- GitNexus impact: `AiController` UNKNOWN (grep: chỉ `ai.module.ts`); `DeepSeekProvider`/`createAiApp` CRITICAL do trùng tên trong đồ thị, thực tế chỉ `main.ts` và test dùng; thay đổi mang tính cộng thêm.
