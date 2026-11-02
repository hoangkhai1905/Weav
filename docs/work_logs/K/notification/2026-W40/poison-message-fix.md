# Nhật ký: sửa poison message của notification-service (NT-1/X-4, NT-2/X-5)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-01 (Asia/Saigon) |
| Nhánh | `refactor/optimize-backend` (chưa commit) |
| Người thực hiện | AI agent, theo yêu cầu của K; service thuộc sở hữu của partner, K đã duyệt sửa |
| Trạng thái | Hoàn thành code + test; còn bước vận hành thủ công (xóa queue cũ) |
| Nguồn | `docs/reviews/2026-10-01-backend-review.md` NT-1/X-4, NT-2/X-5, NT-7 |

## 2. Tóm tắt

- Một event lỗi không còn chặn queue vô hạn: lỗi vĩnh viễn được broker dead-letter nguyên bản; lỗi tạm thời được requeue có backoff và bị dead-letter sau `x-delivery-limit`; không còn đóng connection.
- DLQ giữ message gốc (body, routing key, header `x-death`) thay cho record `{code, occurredAt}` đã lọc, nên truy vết và replay được.
- Topology mới: quorum queue `<NOTIFICATION_QUEUE>.v2`; queue classic cũ được unbind và drain.

## 3. Quyết định kỹ thuật

| Quyết định | Lý do | Phương án đã cân nhắc |
| --- | --- | --- |
| Queue mới `.v2` kiểu quorum (`x-delivery-limit` mặc định 10, DLX `''`, routing key = DLQ) | Không đổi được argument của queue classic (PRECONDITION_FAILED) | Xóa/tạo lại queue cùng tên: mất message |
| Lỗi tạm thời dùng `channel.reject(msg, true)`, KHÔNG dùng `nack(msg,false,true)` | Đã kiểm chứng trên `rabbitmq:4` (4.3.6): `basic.nack` requeue không tăng `x-delivery-count`, message lặp 260+ lần không bị dead-letter; `basic.reject` requeue và mất consumer thì có tăng | Đếm attempt ở app rồi republish: phức tạp hơn |
| Backoff trước khi requeue: `min(30s, 500ms * 2^deliveryCount)` | Quorum queue redeliver ngay; không có backoff thì 10 lần retry hết trong vài ms khi DB chập chờn và event hợp lệ bị đẩy sang DLQ. Với limit 10 chịu được ~2,5 phút DB down | Không backoff |
| Lỗi vĩnh viễn: SyntaxError, ZodError, InboxPersistenceConflictError, RangeError (ngày sai), Prisma validation, Prisma P2000/2005/2006/2007/2020 | Retry không sửa được | Mọi lỗi khác coi là tạm thời (an toàn: tối đa limit lần rồi vào DLQ) |
| Bỏ record DLQ đã lọc, dùng message gốc | Cần eventId/routing key/body để replay. DLQ chứa cùng dữ liệu với queue sống nên cần phân quyền như queue; log không in payload | Giữ record lọc kèm eventId/routingKey: không replay được |
| Drain queue cũ cùng handler khi `NOTIFICATION_LEGACY_DRAIN=true`; unbind mọi routing key khi khởi động | Message còn lại trong queue cũ không bị mất, không có message mới vào. Lỗi tạm thời ở queue cũ chờ 5s (classic không có delivery limit) và chỉ chặn queue cũ | Tự động xóa queue cũ: xóa dữ liệu, bị cấm nếu chưa xác nhận |
| Reset bộ đếm backoff khi bắt đầu consume (NT-7) | Review NT-7 | - |

## 4. File thay đổi

| Loại | Đường dẫn | Ghi chú |
| --- | --- | --- |
| Sửa | `services/notification-service/src/infrastructure/rabbit.consumer.ts` | topology, phân loại lỗi, ack/nack/reject, log có cấu trúc |
| Sửa | `services/notification-service/src/config/settings.ts` | `NOTIFICATION_QUEUE_V2`, `NOTIFICATION_DELIVERY_LIMIT`, `NOTIFICATION_LEGACY_DRAIN` |
| Sửa | `services/notification-service/src/infrastructure/rabbit.consumer.spec.ts` | unit test mới (hành vi + topology) |
| Sửa | `services/notification-service/test/inbox.integration.cjs`, `test/runtime.integration.cjs` | cập nhật theo hành vi mới (DLQ giữ body gốc, transient không throw) |
| Thêm | `services/notification-service/test/poison.integration.cjs`, `package.json` (script `test:integration`) | test RabbitMQ thật |
| Sửa | `docs/specs/services/notification-service.md`, `.env.example` (và `.env`, chỉ tên biến mặc định) | topology, DLQ, migration |

Không đổi schema DB, không đổi contract event, không đụng service khác. `compose.dev.yml` chưa truyền 3 biến mới vào container (dùng mặc định); nếu cần override thì thêm vào compose (ngoài phạm vi lần này).

## 5. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --dir services/notification-service test` | PASS, 10 suites, 97 tests |
| `pnpm --dir services/notification-service test:e2e` | PASS, 14 tests |
| `pnpm --dir services/notification-service build` | PASS |
| Compose test (`notif-poison`, RabbitMQ 4 + Postgres 17) `node --test test/poison.integration.cjs` | PASS: event lỗi tạm thời vào DLQ sau 4 lần giao (1 + limit 3), body gốc + `x-death`; event hợp lệ phía sau không bị chặn; queue cũ unbind + drain |
| `node --test test/runtime.integration.cjs test/inbox.integration.cjs` | PASS, 37/37 |
| eslint (không `--fix`) | 48 vấn đề (46 lỗi, 2 cảnh báo), đều có sẵn; HEAD có 50 (spec cũ có 3 lỗi, nay 1). File mới/sửa không thêm lỗi |
| `git diff --check` | xem báo cáo cuối |

Đã dọn: `docker compose -p notif-poison down -v`.

## 6. Rủi ro, việc vận hành, bước tiếp theo

| Mức | Nội dung | Xử lý |
| --- | --- | --- |
| Trung bình | Service của partner | Báo partner; thay đổi gói trong 1 file consumer + settings |
| Trung bình | Queue cũ phải xóa thủ công | Khi queue cũ 0 message: đặt `NOTIFICATION_LEGACY_DRAIN=false`, rồi `rabbitmqctl delete_queue notification-service.execution-events` |
| Thấp | Record DLQ cũ dạng `{code, occurredAt}` không replay được | Giữ nguyên, chỉ entry mới là message gốc |
| Thấp | Event lỗi tạm thời giữ prefetch 1 tối đa ~2,5 phút trước khi vào DLQ | Chấp nhận; chỉnh `NOTIFICATION_DELIVERY_LIMIT` nếu cần |
| Thấp | Cần quyền tạo quorum queue trên broker (RabbitMQ 3.8+/4.x; test dùng 4.3.6) | Không cần plugin |

Next: partner review; triển khai theo thứ tự deploy service (queue `.v2` tự khai báo), kiểm tra queue cũ về 0, rồi xóa.
