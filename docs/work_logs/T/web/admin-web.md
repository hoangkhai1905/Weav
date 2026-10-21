# Nhật ký: Web admin riêng (`apps/admin`)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-10-21` → `2026-10-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Nhánh / commit gốc | `feature/admin-web` từ `dev` `09816f60` |
| Người thực hiện | T (Trường) + AI agent (subagent-driven, implementer Sonnet) |
| Trạng thái | Hoàn thành, chờ review toàn nhánh và merge vào `dev` |
| Phạm vi | Tách web admin thành app riêng, phủ UC025–UC028 |
| Tài liệu | Spec `docs/superpowers/specs/2026-10-21-admin-web-design.md`, plan `docs/superpowers/plans/2026-10-21-admin-web.md`, `docs/specs/apps/admin.md` |

## 2. Tóm tắt

- App mới `apps/admin` (Vite + React, cổng 5174): đăng nhập chỉ cho ADMIN, Tổng quan, Người dùng (+ chi tiết), Không gian làm việc, Lượt chạy (+ panel chi tiết chỉ đọc), Mẫu quy trình (gỡ mẫu công khai), Hệ thống. VI mặc định, có EN, sáng/tối.
- Backend mới, chỉ đọc: workflow-service `GET /admin/executions`, `/admin/executions/summary`, `/admin/executions/{id}` (UC028, Flyway V17 thêm index `created_at`); workspace-service `GET /admin/workspaces` (UC027). Gateway `/api/admin/workspaces`, `/api/admin/executions*` kiểm tra ADMIN ở edge, query `.strict()`.
- Web người dùng: gỡ `/admin/users` và link trong Cài đặt.

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Build / compile | PASS | admin `tsc`/`build`/`eslint`; gateway `build`; web `tsc`/`build` |
| Test | PASS | workflow `verify` 1135 test (3 lỗi môi trường đã biết); workspace focused 32/32; gateway unit 192 + e2e 164; admin Playwright 28/28; web 17/17 |
| Migration | PASS | workflow V17 áp lên Neon `production` schema `workflow` (284 ms) |
| Health | UP | 3 service healthy sau rebuild; `/ready/upstreams` ok |
| Commit | 13 commit | `71be19e1..91ac3c88` |

## 3. Quyết định kỹ thuật

| Quyết định | Lý do | Hệ quả / theo dõi |
| --- | --- | --- |
| App riêng, copy token giao diện, không có package dùng chung | User chọn; không đụng `apps/web` | Token có thể lệch với web; tách `packages/ui` khi cần |
| workspace/workflow-service tin claim `system_role` trong JWT | Không có bảng user, không đọc bảng service khác | Admin bị hạ quyền vẫn dùng được token tới khi hết hạn |
| Gateway: query admin `.strict()` (key lạ → 400) | Đồng nhất với route workflow/workspace | Client gửi thừa key bị 400 |
| Bỏ cột "số workflow" ở màn Workspace | Số này ở workflow-service, cấm đọc chéo | Thêm endpoint đếm nếu cần |
| Chia sẻ `sanitizeRunError` + `MonitoringService.validateRunRange` | Giới hạn 300 ký tự và 90 ngày là ràng buộc bảo mật, không để lệch | Monitoring giữ nguyên hành vi (test lại) |
| Lọc ngày ở màn Lượt chạy theo ngày địa phương | Admin ở VN chọn ngày nghĩa là ngày theo giờ VN | Web monitoring dùng ngày UTC, lệch 7 giờ ở ranh giới |
| V17 an toàn cho checkout cũ | Spring Boot Flyway bỏ qua migration "future" | Index tạo thường (khóa ghi ngắn), ổn ở quy mô hiện tại |
| GitNexus CLI segfault → dò người gọi bằng text search | User cho phép cho cả nhánh | Chạy lại `detect_changes` khi CLI được sửa |

## 4. Kiểm tra trên stack thật (2026-10-22)

| Hạng mục | Thao tác | Kết quả |
| --- | --- | --- |
| Rebuild | `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build workflow-service workspace-service api-gateway` | healthy; log Flyway "Successfully applied 1 migration … v17" |
| Gateway | curl các route admin bằng token ADMIN test | 200; `?bad=1` → 400; preflight CORS từ `localhost:5174` → 204 đúng origin |
| App admin | `localhost:5174`, tài khoản ADMIN test | 7 màn có dữ liệu thật (22 người dùng, 15 workspace, 3 lượt chạy/24 h); panel lượt chạy + Escape + focus; hộp gỡ mẫu → Hủy (mẫu thật không đổi); khóa rồi mở lại `smoke2c-…@example.test` (PATCH 200 ×2, cuối ACTIVE); console sạch; tối OK |
| Mobile 375 px | đo `scrollWidth`/`innerWidth` 6 màn | Phát hiện `/users` rộng 893 px (span `sr-only` absolute thoát khung `overflow-x-auto`) → sửa `91ac3c88` (`relative` cho khung bảng + spec mobile); đo lại 375/375 cả 6 màn |

### Chưa kiểm tra

- Đăng nhập bằng tài khoản USER trên stack thật (không có tài khoản USER biết mật khẩu). Đã có test tự động ở service, Gateway và app.
- `WorkspaceNotificationRuntimeIntegrationTest` ×3 (lỗi môi trường, đã xác nhận): báo cáo surefire ghi `Cannot run program "node" ... error=2` tại `ProcessBuilder.start` (test dựng cầu Nest từ `services/notification-service/dist` + `node_modules` bằng lệnh `node`; container JDK 25 không có `node`) và lỗi xảy ra trước khi chạm code workspace. Nhánh chỉ thêm API admin (một hàm `default` trong `WorkspaceRepository`, controller/use case admin mới), không đổi luồng thông báo. Đã ghi vào mục "Known environment-only test errors" của CLAUDE.md/AGENTS.md.
- Máy chỉ có JDK 21, Maven chạy trong container `eclipse-temurin:25-jdk`.

## 5. Dữ liệu đã thay đổi

- `identity.users`: tài khoản ADMIN test (user id 33d0e6ad-150e-4bab-8200-3be7c2f8dab2) nâng lên `ADMIN` (2026-10-21, theo yêu cầu). Muốn trả lại: UPDATE `system_role` về `USER` cho đúng id đó.
- `smoke2c-…@example.test`: khóa rồi mở lại, trạng thái cuối `ACTIVE`.
- `workflow` schema: thêm index `idx_workflow_executions_created`.

## 6. Bàn giao

1. Review toàn nhánh, rồi merge `feature/admin-web` vào `dev` bằng `git merge --no-ff`.
2. Các lỗi nhỏ để sau (đã ghi trong review): ConfirmDialog/panel chưa có focus trap; double-submit khi gỡ mẫu; ô ngày bắn request khi gõ dở năm; WARN tra owner thiếu loại lỗi.
3. Đối tác: `.env` đã có sẵn `CORS_ALLOWED_ORIGINS` thì phải tự thêm `http://localhost:5174,http://127.0.0.1:5174` (giá trị mặc định trong compose không ghi đè khóa đã đặt); nếu `.env` chưa đặt khóa này thì dùng mặc định mới, không cần làm gì. Thiếu 5174 thì app admin bị Gateway chặn CORS.
4. Chạy `node .gitnexus/run.cjs analyze --index-only` và `detect-changes` khi CLI hết segfault.
