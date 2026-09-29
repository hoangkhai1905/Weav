# Notification expansion — thiết kế, trạng thái và rollout

Ngày cập nhật: 2026-09-29
Nhánh tích hợp: `api-gateway`
Trạng thái: **đã implement phần lớn, đang paused để local test; chưa production-ready**

Tài liệu này hợp nhất thiết kế, kế hoạch triển khai, rollout và đề xuất deferred
của chuỗi notification expansion. Bằng chứng chi tiết theo từng milestone và
runtime handoff nằm trong [work log tổng hợp](../work_logs/T/2026-09-29-notification-local-test-handoff.md).

## Quyết định sản phẩm

- Thay đổi thường xuyên chỉ hiện toast.
- Chuông/inbox chỉ lưu các mốc đáng chú ý: Workflow, Workspace, Connection và Identity security.
- Nội dung hỗ trợ `vi` và `en`; summary bị giới hạn an toàn, không chứa credential, token, raw provider response hay execution input/output.
- Inbox được scope theo user đã xác thực; unread count là global theo user, không phụ thuộc filter/workspace hiện tại.
- API/event cũ vẫn được giữ tương thích. V2 là inbox view bổ sung, không thay thế delivery/provider view legacy.

## Kiến trúc đã triển khai

Service nghiệp vụ ghi notification outbox trong cùng transaction với mutation đã
được xác thực. Publisher dùng RabbitMQ và event envelope v2. Notification Service
sở hữu inbox, deduplication, read state và các API v2; không đọc bảng của service
khác. Gateway proxy các route đã xác thực. Web/mobile chỉ đọc inbox và phát toast
từ kết quả mutation, không tự ghi notification.

Các hướng chính:

- Identity: `password_changed`, `password_reset`, `google_linked`, `google_unlinked`.
- Workspace: tạo/đổi tên workspace, membership, permission, leave.
- Connection: connected, disabled, invalid chỉ khi có transition nghiệp vụ thật.
- Workflow: created, published, paused, resumed, completed, failed; terminal result chịu lease fencing và authorization gate.
- Web/mobile: list, locale/category/unread filters, cursor, unread count, read-one, read-all và target navigation an toàn.

## Milestone và trạng thái review

| Milestone | Kết quả | Giới hạn còn lại |
| --- | --- | --- |
| 1. Event v2, catalog, template | Accepted sau fix recipient | Chưa có independent cross-validator parity đầy đủ |
| 2. Inbox persistence/backfill | Accepted; migration, deterministic backfill và repository tests đã có | Chưa migrate DB dùng chung; reconciliation là operator action |
| 3. Consumer/API v2 | Accepted sau fix replay repair | Runtime authenticated production path chưa được chứng minh |
| 4. Workspace/membership producers | Accepted; transactional outbox/publisher/recipient snapshot | Full suite không được rerun độc lập trong handoff |
| 5. Connection lifecycle | Accepted sau fix OAuth reauthorization | TTL/orphan metadata limitation đã ghi nhận |
| 6. Identity security producers | Accepted có điều kiện | Full suite gặp MinIO image-pull limitation |
| 7. Workflow lifecycle/results | Accepted sau fix summary/terminal fencing | Full suite còn TLS fixture limitation |
| 8. Web inbox/toast | Accepted sau fix store/session regressions | Identity login, broad E2E và lint cần kiểm tra thêm |
| 9. Mobile inbox/toast | Accepted sau fix session/query regressions | Live backend, native E2E và Identity login chưa chứng minh |
| 10. Final integration | **NO-GO / paused** | Live run exit 1; mobile legacy Workflow/Execution routes còn 404; retention/capacity/operator gates chưa đóng |

Các con số test và command thực tế đã được giữ trong work log tổng hợp, không
dùng riêng báo cáo worker để tuyên bố toàn bộ branch pass.

## HTTP và dữ liệu

Notification Service bổ sung:

- `GET /api/v2/notifications`
- `GET /api/v2/notifications/unread-count`
- `PATCH /api/v2/notifications/:id/read`
- `POST /api/v2/notifications/read-all`

Các route yêu cầu Identity HS256 JWT và chỉ trả item của subject hiện tại.
Cursor/limit/filter có giới hạn chặt; target navigation chỉ nhận descriptor đã
allowlist. Migration inbox và các outbox migration đều additive; rollback ứng
dụng giữ table/row lịch sử, không có destructive down migration.

Contract chi tiết vẫn nằm tại:

- `packages/contracts/events/notification/README.md`
- `packages/contracts/events/notification/event-v2.schema.json`
- `packages/contracts/http/notifications-v2.md`

README của từng service vẫn là tài liệu vận hành cục bộ và không bị thay thế bởi
tài liệu hợp nhất này.

## Rollout checklist

1. Xác nhận đúng database đích và backup/restore plan; không chạy migration trên DB dùng chung chỉ vì local client gọi v2.
2. Apply additive migrations theo service owner: Identity outbox, Workspace outbox, Workflow outbox, rồi Notification inbox theo rollout window đã phê duyệt.
3. Kiểm tra RabbitMQ exchange/queue/binding, publisher confirm, retry, DLQ và consumer deduplication.
4. Quiesce legacy consumer/read writes trước bounded inbox reconciliation; chạy lại cho tới khi không còn `linkedDeliveries` hoặc `skippedGroups` chưa xử lý.
5. Chỉ bật client v2 sau khi authenticated list/unread/read/read-all và producer → outbox → broker → inbox → Gateway được kiểm tra bằng runtime evidence.
6. Theo dõi outbox retry, consumer lag, duplicate event, inbox growth, reconciliation skips và provider-independent inbox health.
7. Rollback ứng dụng giữ dữ liệu additive; trước cutover lại phải đánh giá legacy reads và reconciliation dưới quiescence.

Tên cấu hình quan trọng chỉ được ghi, không ghi giá trị secret:
`WORKFLOW_INTERNAL_SERVICE_KEY`, `WEAV_INTERNAL_SERVICE_KEY`,
`NOTIFICATION_EXCHANGE`, các biến outbox/publisher và thông tin broker tương ứng.
Trong Docker, service-to-service host phải dùng hostname Compose (`rabbitmq`),
không dùng `localhost` từ bên trong container.

## Deferred scope

Đề xuất mobile workspace-wide execution history đã được ghi nhận nhưng chưa
được duyệt triển khai. Nếu tiếp tục, cần backend + contract/integration tests và
mobile riêng: API list/count có workspace scope, filter/pagination ổn định,
`WORKFLOW_MONITOR` authorization, query key có account/session/workspace scope,
và target mở detail qua contract hiện có. Không được giả lập bằng cách tải từng
workflow rồi ghép trên mobile; không trả raw inputs/outputs hoặc secrets.

## Handoff

- Không coi branch này là deploy-ready chỉ vì build/unit test cục bộ pass.
- Không tự migrate DB thật, gửi provider notification thật hoặc bật live E2E thiếu credential được cấp đúng cách.
- Khi sửa code tiếp theo, đọc AGENTS.md, chạy GitNexus impact trước symbol edit và detect-changes trước commit.
- Runtime local hiện có thể còn lỗi startup/config; work log tổng hợp ghi rõ từng lỗi và bằng chứng mới nhất.
