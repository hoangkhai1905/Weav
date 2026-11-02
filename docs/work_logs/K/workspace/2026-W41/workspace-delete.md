# Nhật ký: Xóa không gian làm việc (W6-D2)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-10-08 |
| Nhánh | `feat/w6-d2-workspace-delete` (từ `week6` 1cafb47) |
| Người thực hiện | AI agent (lane W6-D2) |
| Trạng thái | Code và kiểm tra tự động xong; chờ coordinator kiểm tra trên stack thật |
| Phạm vi | Soft delete workspace + dừng workflow: workspace-service, workflow-service (pause-all nội bộ), gateway, contracts, notification-service, web |
| Spec | `docs/superpowers/specs/2026-10-08-mobile-oauth-and-workspace-delete.md` mục B |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Soft delete: V7 thêm `status` (ACTIVE/DELETED), `deleted_at`, `deleted_by`; index tên owner thành partial `WHERE status='ACTIVE'` | Additive, tên dùng lại được, dữ liệu cũ mặc định ACTIVE | Workspace DELETED giữ nguyên hàng, memberships/connections không bị xóa vật lý |
| Điểm chặn duy nhất cho "workspace đã xóa = không tồn tại": truy vấn `findByWorkspaceIdAndUserId` / `existsByWorkspaceIdAndUserId` (join trạng thái), danh sách + count, `existsOwnedNameNormalized`, `ConnectionRepository.findByWorkspaceIdAndId` | Mọi use case, `/access` nội bộ và `/resolve`, `/authorize-attachment`, `/auth-failure` đều đi qua các hàm này | Không phải sửa từng use case; khóa mutation re-check vì use case gọi lại lookup sau `lock` |
| Thứ tự: (1) kiểm tra quyền + tên trong tx ngắn, (2) gọi workflow-service `pause-all` ngoài tx/khóa, (3) tx cuối: lock, kiểm tra lại, mark DELETED, disable connections, xóa credentials, ghi outbox, evict cache sau commit | Không giữ tx/khóa trong lúc HTTP; pause-all cần credential Telegram nên phải chạy trước khi xóa credential; lỗi ở (2) thì chưa có gì thay đổi và retry an toàn | Cửa sổ giữa (2) và (3) được đóng bằng một pause-all thứ hai best-effort sau commit (try/catch, chỉ log id); pause-all trả thêm `failed` và nếu `failed > 0` thì use case abort 503, không xóa gì (một số workflow có thể đã bị pause, retry an toàn) |
| Pause-all là service mới `WorkspaceShutdownService` (không sửa `WorkflowPublicationService`), mỗi workflow một tx, lock như pause, không gửi `workflow.paused`, không kiểm tra capability; unregister Telegram best-effort và đếm lỗi | Tránh đụng lane W6-A; retry được | Execution đã nhận được để chạy tiếp, lỗi khi resolve connection đã bị xóa |
| Client mới `WorkflowShutdownClient` + RestClient riêng, read timeout 30s (`weav.workflow.shutdown-read-timeout`, mặc định trong code) | Usage client chỉ 5s | Gateway cho DELETE workspace timeout 35s |
| Bulk SQL (`disableAllByWorkspaceId`, `deleteAllByWorkspaceId`) | Bỏ qua `ConnectionUsageProtection` có chủ đích (workflow đã pause) | Kể cả connection `auth_type=NONE` được set DISABLED |
| `findNormalizedNamesByOwner` chỉ tính workspace ACTIVE | Tên mặc định "My workspace N" tính lại sau khi xóa | Hành vi thay đổi chỉ khi có workspace DELETED |

## 3. Thay đổi (file chính)

- workspace-service: `V7__workspace_soft_delete.sql`, `Workspace`, `WorkspaceStatus`, `WorkspaceJpaEntity`, mapper, `SpringData{Workspace,Membership,Connection,Credential}Repository`, adapters, `DeleteWorkspaceUseCase`, `WorkflowShutdownPort` + `WorkflowShutdownClient`, `WorkspaceController` (`DELETE /workspaces/{id}`), `DeleteWorkspaceRequest`, `WorkspaceNotificationRecorder.recordDeleted`, `WorkspaceApplicationConfig`.
- workflow-service: `WorkspaceShutdownService`, `InternalWorkspaceShutdownController` (`POST /internal/workspaces/{w}/pause-all`), `InternalServiceKeyFilter` + `SecurityConfig` (route mới), `WorkflowRepository.findIdsByWorkspaceAndStatus`.
- api-gateway: `@Delete(':workspaceId')` (body strict `{name}`), `timeoutMs` trong `WorkspaceProxyService`.
- contracts: `workspace/openapi.yaml` (DELETE + `DeleteWorkspaceRequest`), `gateway/openapi.yaml`, `workflow/openapi.yaml` (pause-all), `events/notification/event-v2.schema.json` + README (`workspace.deleted`).
- notification-service: `workspace.deleted` trong `notification-event.ts`, `notification-catalog.ts` (WORKSPACE/WARNING, target NONE, vi + en) và spec.
- web: `workspaceApi.deleteWorkspace`, `WorkspacePage` (vùng nguy hiểm cho OWNER dùng `TypedConfirmDialog`), i18n vi/en, `e2e/workspace-delete.spec.ts`.
- docs: `docs/handoff/2026-10-week6-mobile.md` (mục B).

## 4. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| workspace-service | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | PASS, 431 test, 0 lỗi (cần `notification-service/dist` đã build cho 3 test runtime) |
| workflow-service | `./mvnw verify` | PASS, 848 test, 0 lỗi |
| gateway | `pnpm --dir services/api-gateway test` / `test:e2e` / `build` | 112 / 118 test PASS; build PASS |
| notification-service | `pnpm test` / `test:e2e` / `build` | 102 / 19 test PASS; build PASS |
| web | `tsc -p tsconfig.app.json`, `build`, eslint file đã sửa | PASS |
| Playwright (port 4181, `VITE_API_MODE=http`) | `workspace-delete.spec.ts` | 3/3 PASS; các spec workspace khác: cùng 10 lỗi nền như trước khi sửa; 1 test builder không liên quan (`workspace-connections.spec.ts:1581`) chập chờn |

## 5. Rủi ro và việc tiếp theo

- Chưa kiểm tra trên stack thật (coordinator): tạo workspace tạm có workflow Gmail/Telegram/schedule, xóa, kiểm tra trigger DISABLED, thành viên khác nhận thông báo, workspace biến mất khỏi danh sách.
- Chấp nhận: cache ủy quyền workflow-service (Caffeine ~30 s) vẫn cho phép thành viên có cache còn ấm thao tác tối đa 30 s sau khi xóa.
- Telegram unregister best-effort; endpoint webhook vẫn từ chối trigger đã DISABLED.
- Mobile cần làm theo `docs/handoff/2026-10-week6-mobile.md` mục B.

## 6. Review vòng 1 (2026-10-08)

- M1 pause-all lần hai sau commit (best-effort) + test; M2 `WorkspaceRepositoryAdapter.findById` chỉ trả ACTIVE (replay idempotent sau khi xóa không trả workspace đã xóa); L1 `CreateConnectionUseCase` lấy `mutationLock` đầu tiên; L2 mô tả 503 "không xóa, có thể đã pause một phần"; L3 đóng dialog trước `removeWorkspace`; L4 `WorkspaceShutdownService` catch theo từng workflow, trả `failed`, use case abort khi `failed > 0`.
- Test thêm: 404 trên mọi route sau khi xóa, final-tx lỗi giữ nguyên dữ liệu, replay idempotent, một workflow lỗi vẫn pause các workflow còn lại.
