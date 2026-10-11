# Nhật ký: mời thành viên qua email (W7-A1)

Spec: `docs/superpowers/specs/2026-10-10-w7-a1-invite-by-email-design.md`. Plan: `docs/superpowers/plans/2026-10-10-w7-a1-invite-by-email.md`.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-10 |
| Nhánh | `feat/w7-a1a-invite-backend` (từ `week6` aef8ef3) |
| Lane | A1a backend (Task 1-7); A1b (web, Task 8-9) làm song song |
| Trạng thái | Backend xong, chưa commit (coordinator commit); chưa kiểm tra live |

## 2. Quyết định

| Quyết định | Lý do |
| --- | --- |
| Không dùng token; accept so khớp email đã xác minh của người gọi (identity) với email trong lời mời | D1 trong spec |
| `Clock` bean mới trong `WorkspaceApplicationConfig` | Repo chưa có bean `Clock`; use case lấy `now` từ đây để test được |
| Giao dịch accept: đọc lời mời để biết workspace, khóa workspace (`mutationLock`), đọc lại rồi mới ghi | Hai accept đồng thời không tạo hai membership |
| `markMemberAdded` dùng actor = người mời, subject/recipient = người nhận lời mời | Khớp ràng buộc event `member_added` của notification-service |
| Dòng delivery EMAIL có `readAt = now` và payload thêm `title`/`message` | API v1 `/notifications` liệt kê mọi delivery của user; tránh đếm email là thông báo chưa đọc và tránh title rỗng |
| Replay `workspace.invitation.created` trong `ingest` trả về im lặng | Broker giao lại không được dead-letter (Review Focus 3) |
| `GATEWAY_INVITATION_RATE_LIMIT` (mặc định 10/phút/user) cho POST tạo và resend | Cả hai đều gửi email thật |
| `IdentityDirectoryHttpClient` đọc `emailVerified` kiểu `Boolean` | Jackson 3 báo lỗi với `boolean` nguyên thủy khi thiếu trường |

## 3. Thay đổi

- identity: `UserDirectorySummary.emailVerified`.
- workspace-service: Flyway `V8__workspace_invitations.sql`; `WorkspaceInvitation`, repository + adapter (index duy nhất một PENDING dịch thành `INVITATION_EXISTS`), `GoneException` (410), `TooManyRequestsException` (429); 4 use case chủ sở hữu, 3 use case người được mời; `InvitationController`, `MyInvitationController`; event `workspace.invitation.created`.
- notification-service: enum `EMAIL` (migration `202610100001_email_provider`), `EmailProvider` (nodemailer), `renderInvitationEmail`, catalog + schema sự kiện, `ingest` tạo inbox + delivery EMAIL.
- api-gateway: 4 route chủ sở hữu + `InvitationController` (3 route), bucket throttle `invitation`.
- contracts: `workspace/openapi.yaml`, `gateway/openapi.yaml`, `events/notification` (schema, ví dụ, README).
- cấu hình: `NOTIFICATION_EMAIL_ENABLED`, `GATEWAY_INVITATION_RATE_LIMIT` trong `.env.example` và `compose.dev.yml`; notification-service nhận `SMTP_*` trong compose.

## 4. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| identity | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | 384 test, chỉ 3 lỗi Avatar/minio đã biết |
| workspace-service | `./mvnw verify` | 479 test, 1 lỗi `WorkflowContractValidationTest.workflowDetailContractAddsOnlyTheSafeTriggerProjection` (có từ trước: `workflow/openapi.yaml` đã có `WORKFLOW_EVENT`, file này không đổi) |
| notification-service | `pnpm test`, `pnpm test:e2e`, `pnpm build` | 120 test, 19 e2e, build PASS |
| api-gateway | `pnpm test`, `pnpm test:e2e`, `pnpm build` | 144 test, 141 e2e (suite `invitation.e2e-spec.ts` mới), build PASS |
| Lint (chỉ kiểm tra) | `pnpm exec eslint "{src,test}/**/*.ts"` | file mới sạch; lỗi còn lại có từ trước |

Chưa chạy: `test:integration` của notification-service (cần Postgres + RabbitMQ, đã cập nhật `runtime.integration.cjs`), kiểm tra live gửi email thật.

## 5. Rủi ro và việc tiếp theo

- Email cần `NOTIFICATION_EMAIL_ENABLED=true` cộng `SMTP_*` và `NOTIFICATION_DETAIL_BASE_URL` (HTTPS) để link `/invitations` đầy đủ.
- Kiểm tra live trên Neon `dev-k`: V8 và migration Prisma tự áp dụng khi khởi động.
- Handoff mobile: `docs/handoff/2026-10-week7-mobile.md`.
