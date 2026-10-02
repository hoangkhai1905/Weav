# Nhật ký: hardening notification-service (NT-3, NT-4, NT-5, NT-6)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-02 (Asia/Saigon) |
| Nhánh | `refactor/optimize-backend` (chưa commit) |
| Người thực hiện | AI agent, theo yêu cầu của K ("I'm handling the whole backend now(except ocr)... just dont overengineer") |
| Trạng thái | Hoàn thành code + test |
| Nguồn | `docs/reviews/2026-10-01-backend-review.md` NT-3, NT-4, NT-5, NT-6 |

## 2. Thay đổi

| ID | Thay đổi | File |
| --- | --- | --- |
| NT-5 | `RABBITMQ_USERNAME/PASSWORD` bắt buộc, bỏ default guest/guest; thiếu thì `loadSettings` ném lỗi cấu hình. compose.dev.yml và `.env.example` đã truyền sẵn biến này nên không sửa | `src/config/settings.ts` |
| NT-6 | v2 ingest: event phát lại có thêm recipient thì `createMany({ skipDuplicates: true })` chỉ thêm dòng thiếu; sau đó đếm lại để một dòng trùng id/key của event khác vẫn bị từ chối (không bị skipDuplicates che) | `prisma.inbox.repository.ts` |
| NT-4 | v1 `markRead/markAllRead` ghi cả `notification_inbox.read_at`; v2 ghi cả `notification_deliveries.read_at` (qua `inbox_id`), cùng một transaction, vẫn `WHERE read_at IS NULL`. v1 mark-read một delivery cũng đánh dấu các delivery anh em cùng inbox item. Không bỏ endpoint v1, không đổi schema | `prisma.repository.ts`, `prisma.inbox.repository.ts` |
| NT-3 | Worker ghi "provider đã nhận" (`SENT`/receipt) ngay sau khi provider trả về, thử lại tối đa 3 lần chỉ riêng lần ghi DB, không gọi lại `send`. Expo gửi `collapseId = delivery.id` để push gửi lại thay thế push cũ | `delivery.worker.ts`, `providers.ts` |

## 3. Quyết định

- **Telegram là at-least-once theo thiết kế**: Telegram không có idempotency key; nếu process chết sau khi Telegram nhận mà trước khi ghi DB, lease hết hạn và dòng được gửi lại. Không xây kho dedup (ngoài phạm vi, tránh over-engineering). Có comment tại điểm gửi.
- **Không đổi replay của v1**: v1 vẫn đóng băng danh sách destination của event đầu tiên (test hiện có bảo vệ điều này). NT-6 chỉ áp dụng cho recipient (user) của v2 inbox.
- Script `scripts/reconcile-inbox.cjs` dùng `loadSettings()` nên operator phải đặt `RABBITMQ_USERNAME/PASSWORD` (như đã phải đặt `JWT_ACCESS_SECRET`).

## 3b. Thay đổi hành vi người dùng thấy

- Đọc một thông báo ở API nào thì API kia cũng thấy đã đọc; số chưa đọc v1/v2 khớp nhau.
- Event v2 phát lại với recipient mới giờ tạo thêm inbox item cho recipient đó.
- Service không khởi động nếu thiếu thông tin đăng nhập RabbitMQ.

## 4. Kiểm thử

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --dir services/notification-service test` | 10 suites, 100 tests pass |
| `pnpm --dir services/notification-service test:e2e` | 1 suite, 14 tests pass |
| `pnpm ... test:inbox-integration` (Postgres 17 + RabbitMQ qua `test/compose.yml`, đã `down -v`) | 33/33 pass (thêm: NT-6, NT-4 hai chiều + read-all; cập nhật các assert cũ cho delivery read write-through) |
| `pnpm ... test:integration` | 8/8 pass |
| `pnpm ... build` | pass (dist mới cho consumer test của workflow-service) |
| eslint `{src,test}/**/*.ts` | còn lỗi sẵn có ở file không sửa (vd. `DeliveryRecord` chưa dùng, `inbox.persistence.ts`); file đã sửa sạch |

Test mới: thiếu credential RabbitMQ (settings.spec), ghi DB lỗi sau khi provider nhận không gửi lại (delivery.worker.spec), `collapseId` (providers.spec), NT-6/NT-4 (inbox.integration.cjs).

## 5. Rủi ro / việc tiếp theo

- Ghi DB lỗi 3 lần liên tiếp sau khi provider nhận vẫn dẫn tới gửi lại sau khi lease hết hạn (at-least-once).
- Khi triển khai: đảm bảo môi trường notification-service có `RABBITMQ_USERNAME/PASSWORD` (compose đã có).
