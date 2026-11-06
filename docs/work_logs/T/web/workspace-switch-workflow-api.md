# Nhật ký: API workflow đi theo workspace đang chọn (apps/web)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-11-05` (Asia/Saigon) |
| Nhánh | `fix/web-active-workspace-sync` từ `dev` |
| Người thực hiện | T + AI agent |
| Trạng thái | Đang tiếp tục (chờ merge, deploy, kiểm tra trên production) |

## 2. Sự cố

Trên https://app.weav.id.vn, tạo workflow "test gg sheet" bằng AI báo "You do not have permission to perform this action": `POST /workflows/generate` và `PUT /workflows/{id}/draft` trả 403 cho workspace `3f3a7fa5` ("Test").

## 3. Nguyên nhân (đã kiểm chứng)

- Người dùng là OWNER của cả hai workspace (đọc qua phiên đăng nhập trong browser pane, chỉ đọc). Kết nối Google Sheets nằm ở "My workspace 1" (`0d0614b6`); "Test" không có kết nối.
- Giao diện đang chọn "My workspace 1" nên danh sách kết nối (store `useWorkspaceStore.activeWorkspaceId`) có Google Sheets; nhưng mọi API workflow đọc khoá `localStorage` `weav_active_workspace_id` qua `getActiveWorkflowWorkspaceId()`. Khoá chỉ được ghi khi trống/không hợp lệ, bộ chọn workspace ở thanh trên không bao giờ ghi nó → request đi vào "Test" kèm id kết nối của "My workspace 1".
- workflow-service gọi `authorize-attachment`; workspace-service không thấy kết nối trong "Test" → 404, `WorkspaceClient.isDenied` đổi thành 403.
- Hệ quả phụ: workflow "test gg sheet" nằm trong "Test" (chỉ có trigger thủ công) và trang Quy trình của workspace đang chọn báo "chưa có quy trình".
- Tái hiện trong pane: chọn "Test" trên giao diện → khoá vẫn `0d0614b6`, danh sách không hiện "test gg sheet". Đã chọn lại "My workspace 1"; không sửa dữ liệu.

## 4. Thay đổi

| File | Thay đổi |
| --- | --- |
| `apps/web/src/api/workflow-v1.api.ts` | `getActiveWorkflowWorkspaceId` ưu tiên workspace đang chọn trong store, ghi lại vào khoá; fallback như cũ khi store chưa có. Áp dụng cho mọi caller: workflow, generate, execution, monitoring, templates, import |
| `apps/web/src/pages/WorkflowsPage.tsx` | Danh sách tải lại khi đổi workspace (trước chỉ tải lúc mount) |
| `apps/web/e2e/workspace-read-switch.spec.ts` | Test: khoá cũ = A, chọn B trên thanh trên → danh sách gọi `/workspaces/B/workflows` và hiện workflow của B |

## 9. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Test mới trước khi sửa | `VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium e2e/workspace-read-switch.spec.ts -g "follow the selected workspace"` | FAIL (vẫn hiện "Alpha flow" sau khi chọn Beta) |
| Test mới sau khi sửa | cùng lệnh | PASS |
| Types | `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | Pass |
| Build | `pnpm --dir apps/web build` | Pass |
| Lint | `pnpm --dir apps/web exec eslint .` | 3 lỗi, như trên `dev` (gồm `set-state-in-effect` ở `loadWorkflows` có sẵn) |

### Kiểm tra trên stack local (2026-11-06)

- Stack: `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build identity-service workspace-service workflow-service ai-service api-gateway` (build từ `dev`), tất cả healthy; `/health` gateway 200, AI `/health/ready` 200. Web: Vite `localhost:5173` từ nhánh sửa.
- Tạo workspace thử "Kiem tra doi workspace" (`f6806407`, không có kết nối). Dựng lại tình huống production: thanh trên chọn "test 1" (`cf725faa`, có Google Sheets), khoá `weav_active_workspace_id` đặt tay = `f6806407`.
- AI "Webhook ghi vào Google Sheets" → chọn kết nối "test gg sheets": mọi `POST /workspaces/cf725faa…/workflows/generate` → 200; "Tạo bản nháp": `POST …/workflows` 201, `PUT …/workflows/6c3a573e…/draft` 200. Draft có `trigger.webhook` + `google.sheets` (có `connectionId`). Khoá tự ghi lại `cf725faa`.
- Trang Quy trình: chọn "Kiem tra doi workspace" → trống; chọn lại "test 1" → hiện workflow mới. Console không lỗi.
- Dữ liệu thử để lại trên tài khoản local: workspace "Kiem tra doi workspace", workflow "Nhận webhook và thêm dòng vào Google Sheets" trong "test 1" (người dùng tự xoá).

## 11. Bàn giao

- Workflow thừa "test gg sheet" trong "Test" do người dùng tự xoá.
- Sau khi deploy: thử lại tạo workflow Google Sheets bằng AI trên production.
