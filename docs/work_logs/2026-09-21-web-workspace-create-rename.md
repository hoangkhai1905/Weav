# Nhật ký đợt 2 - Web Workspace create + rename

## Metadata

- Ngày: 2026-09-21, múi giờ `Asia/Saigon`
- Repository/branch: `D:\End\Weav` / `api-gateway`
- Người thực hiện: Luna Max
- Người review: user
- Trạng thái: Đang triển khai, chưa commit/merge/push
- Scope: Web Workspace create + rename qua API Gateway; giữ list/switch/cache isolation và OCR workspace binding của đợt 1.
- Ngoài scope: mobile, Workflow execution, AI, Bot, member management/backend domain.

## Kết quả đợt 1 đã kiểm tra lại

- Worktree có các thay đổi đợt 1 và hai thư mục untracked của user; không có commit mới từ đợt 1.
- Fixture Chromium đợt 1 đã ghi nhận 6 workspace tests và 7 OCR tests pass; web build pass; focused lint pass.
- Full lint vẫn có blocker baseline tại `apps/web/src/pages/SettingsPage.tsx` (2 lỗi `react-hooks/set-state-in-effect`, 1 warning dependency), file này không thuộc đợt 2.
- Live authenticated browser chưa có vì môi trường hiện không cung cấp session/credentials runtime; không seed hoặc chạm dữ liệu thật.

## Contract và quyền đã xác minh

- Gateway: `POST /api/v1/workspaces` -> `201 WorkspaceResponse`; `PATCH /api/v1/workspaces/{workspaceId}` -> `200 WorkspaceResponse`.
- Create body: `{ name?: string | null }`; chuỗi dài 1-255; bỏ qua/null để Workspace service sinh `My workspace N`; Gateway strict schema.
- Rename body: `{ name: string }`; 1-255 ở Gateway, backend yêu cầu nonblank; Gateway strict schema.
- Create lỗi công khai: 400, 401, 409, 5xx/502/503 qua Gateway contract. Rename: 400, 401, 403 owner-only, 404, 409, 5xx/502/503.
- Backend rename chỉ OWNER được phép; non-owner bị `ForbiddenException`, workspace không thuộc caller bị not-found. Không suy diễn capability UI mới.
- `WorkspaceResponse` gồm `id`, `name`, `createdBy`, `createdAt`, `updatedAt`; create response dùng ID trả về để chọn workspace mới.

## Plan bounded / acceptance

1. API adapter: thêm `workspaceApi.createWorkspace` và `workspaceApi.renameWorkspace`, map `WorkspaceResponse`, gửi đúng Gateway paths/body; mock chỉ chạy khi `VITE_API_MODE=mock`, không fallback khi HTTP lỗi.
2. Query/state: dùng `workspaceKeys` hiện có và `useWorkspaceStore` hiện có; cập nhật/invalidate list/detail theo `userId`, guard kết quả nếu account đổi giữa request; rename giữ active ID và members cache.
3. UI `WorkspacePage`: form create và rename, validation 1-255/nonblank theo contract, pending chống double-submit, inline errors, giữ input khi lỗi; create success chọn ID response; rename success đổi label nhưng không đổi ID.
4. Regression: giữ member switching/403/empty và OCR selected ID của đợt 1; không thêm execution backend.
5. Docs/verification: focused Playwright fixture tests, build, focused lint, regression tests, `git diff --check`; live browser chỉ báo nếu runtime thật có sẵn.

## GitNexus upstream impact trước sửa

- `workspaceApi` (`apps/web/src/api/workspace.api.ts`): `UNKNOWN`; graph không resolve property/module callers. Source đã xác nhận callers ở `useWorkspace.ts` và `WorkspacePage.tsx`; chỉ sửa additive methods/adapter.
- `WorkspacePage` (`apps/web/src/pages/WorkspacePage.tsx`): sau refresh index trả `UNKNOWN` do UID lỗi; source xác nhận `App.tsx` route import/call. Trước refresh graph cũ cho direct caller `App`, LOW; thay đổi giữ route contract.
- `useWorkspaceStore` (`apps/web/src/store/useWorkspaceStore.ts`): `UNKNOWN` từ graph; source xác nhận `useWorkspace.ts`, `WorkspacePage.tsx`, `WorkflowBuilderPage.tsx` và cleanup. Không tạo store thứ hai.
- `useWorkspaceSessionCleanup`: GitNexus có kết quả `CRITICAL` nhưng target UID bị name-collision với `3dviz-pro-max/examples/shared/standalone-runtime.js:mountScene`; source xác nhận caller thực tế duy nhất là `AppLayout`. Không sửa cleanup trong slice.
- Không có HIGH/CRITICAL caller impact thực tế còn lại trong các symbol web sẽ sửa; UNKNOWN đã được xử lý bằng source inspection.

## Test plan theo TDD

- Mở rộng `apps/web/e2e/workspace-read-switch.spec.ts` trước production code với fixture HTTP cho create/rename.
- RED trước: create success chọn workspace ID response; invalid input không POST; double-submit một POST; create/rename error giữ input và không success; rename giữ ID; account switch trong request không ghi vào user mới; OCR sau create dùng selected ID.
- GREEN: `workspace.api.ts` -> query/state guard -> `WorkspacePage.tsx`.
- Commands lấy từ manifests:
  - `pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts --project=chromium --workers=1 --retries=0`
  - `pnpm --dir apps/web test:e2e -- e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0`
  - `pnpm --dir apps/web build`
  - focused `pnpm --dir apps/web exec eslint ...` cho files đổi; full `pnpm --dir apps/web lint` để ghi baseline.

## Bàn giao cuối đợt

- Không commit/merge/push.
- Phải báo files, behavior, commands/results, fixture/live browser evidence hoặc blocker, checklist review; sau đó dừng chờ user.

## Implementation và bằng chứng

### Đã triển khai

- `apps/web/src/api/workspace.api.ts`: thêm `createWorkspace`, `renameWorkspace`, contract validation helper; HTTP POST/PATCH dùng Gateway path và response mapping; explicit mock branch tách biệt, không fallback mock khi HTTP lỗi; status/envelope errors giữ nguyên để UI hiển thị.
- `apps/web/src/pages/WorkspacePage.tsx`: thêm form create/rename, inline validation/error/success, pending chống double-submit, preserve input khi lỗi; create upsert/invalidate user-scoped list/detail và chọn ID response; rename cập nhật label/list nhưng giữ active ID và members key; bỏ qua mutation result khi account đã đổi.
- `apps/web/src/pages/WorkspacePage.tsx`: PATCH 404 loại workspace khỏi active store và invalidate list để selection an toàn; PATCH 403 vẫn giữ state.
- `apps/web/e2e/workspace-read-switch.spec.ts`: thêm 7 fixture tests cho create/rename/OCR/account-switch và error/pending behavior; regression đợt 1 giữ nguyên.

### Commands và kết quả thực tế

- `pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` -> **14 passed**.
- `pnpm --dir apps/web test:e2e -- e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` -> **7 passed**.
- `pnpm --dir apps/web exec eslint src/api/workspace.api.ts src/pages/WorkspacePage.tsx e2e/workspace-read-switch.spec.ts` -> **PASS**.
- `pnpm --dir apps/web build` -> **PASS**; còn cảnh báo bundle Vite >500 kB.
- `pnpm --dir apps/web lint` -> **FAIL baseline ngoài scope** tại `apps/web/src/pages/SettingsPage.tsx:76,82` (`react-hooks/set-state-in-effect`) và warning line 106; không sửa file này.
- `git diff --check` -> **PASS**.
- `Test-NetConnection localhost:3000` và `:5173` -> **False** tại thời điểm kiểm tra; không có Gateway/live web runtime để authenticated browser verify.

### Giới hạn bằng chứng

- Browser evidence là Playwright Chromium fixture, không phải live authenticated flow; fixture đã kiểm tra POST/PATCH paths, body, response ID, switching, OCR URL, error/pending/cache isolation.
- Không đọc/in secrets, không seed/chạm dữ liệu thật, không chạy Gateway suite vì không đổi backend contract.

## Trạng thái bàn giao đợt 2

- Code và focused verification hoàn tất; chờ user review diff, chưa commit/merge/push.
- Review checklist: kiểm tra API body/path/status mapping; create blank/default và overlength validation; 403/409 preserve state; pending button; create chọn ID response kể cả list refetch; rename không đổi active ID; account switch không ghi cache/store user mới; OCR vẫn dùng selected ID; member mutation vẫn disabled trong HTTP.
- Không triển khai mobile, Workflow/AI/Bot hay member management. Sau handoff này dừng chờ `work done`.
