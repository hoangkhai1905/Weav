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
