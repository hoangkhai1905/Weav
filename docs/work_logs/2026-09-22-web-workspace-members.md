# Nhật ký làm việc - 2026-09-22

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu session | `api-gateway` / `7e14de0` |
| Người thực hiện | `Luna Max` |
| Người review / nhận bàn giao | `Người dùng / Astra` |
| Trạng thái cuối session | `Hoàn thành bounded slice; live Gateway blocked` |
| Phạm vi session | Web Workspace member add/permissions/remove/leave qua Gateway public APIs |
| Liên kết liên quan | Workspace/Gateway OpenAPI và Workspace controller/use cases |

## 2. Tóm tắt điều hành

### Kết quả chính

- Nối Web Workspace member mutations với đúng routes Gateway: add existing Identity user by `email`, update hai workflow permission booleans, remove member và leave bằng `DELETE`.
- Bỏ placeholder disabled/local mock behavior trong HTTP mode; UI có validation contract, pending guard, inline error, confirm destructive actions và scoped query invalidation.
- Giữ server là authority cho owner/permission constraints; UI chỉ gate bảo thủ theo `MemberView.role === OWNER` của current user khi member đã được load. Không thêm invitation delivery, user search, backend/mobile/Workflow/AI/Bot.
- Bổ sung fixture Playwright UI/network tests và regression; không commit/merge/push.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Web build | `PASS` | `pnpm --dir apps/web build`; Vite chỉ cảnh báo bundle >500 kB |
| Focused E2E | `PASS` | Member `7/7`; workspace/OCR regression `27/27` Chromium fixture |
| Focused lint | `PASS` | ESLint các file thuộc slice |
| Full Web lint | `FAIL baseline ngoài scope` | `SettingsPage.tsx:76,82` `react-hooks/set-state-in-effect`; warning line 106 |
| Live Gateway/browser | `BLOCKED` | Ports 3000/5173/8081/8085 đều down; không có approved test workspace/users |
| Diff check | `PASS` | `git diff --check`; chỉ cảnh báo CRLF cũ ở mobile file ngoài scope |
| Commit / PR | `Chưa tạo` | User yêu cầu review diff trước, không commit/merge/push |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Xác nhận contract/source thật trước khi sửa, đặc biệt identity input và owner invariants.
2. Nối Web UI với POST/PATCH/DELETE member APIs hiện có, không fake success/fallback HTTP sang localStorage.
3. Kiểm chứng mutation, permission gating, confirmation, cache/selection cleanup và late-response isolation.

### Trong phạm vi

- `apps/web` Workspace API adapter, Workspace page, workspace query/session cleanup, member type và confirm-button test hook.
- Controlled Playwright fixture tests và work log/plan.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa backend contract/controller, mobile, invitation/email delivery, user search, push/realtime, Workflow execution, AI, Bot.
- Không đổi auth persistence hay thêm public capability endpoint.
- Không restore/pop/drop stash, reset, stage-all, commit, merge hoặc push.

### Tiêu chí hoàn thành

- [x] Routes/body/mapping đúng OpenAPI/Gateway/controller.
- [x] Add, permission update, remove, leave có pending/error/confirmation và không HTTP-to-mock fallback.
- [x] Invalidate user/workspace-scoped list/detail/members; leave clear active workspace an toàn; late workspace/account mutation guard giữ nguyên.
- [x] Focused E2E, regression, build, focused lint và diff check.
- [ ] Live authenticated browser proof: bị chặn bởi runtime/account prerequisites.

## 4. Bối cảnh và nguồn sự thật

- Gateway controller `services/api-gateway/src/workspace/workspace.controller.ts` xác nhận:
  - `POST /api/v1/workspaces/{workspaceId}/members` body `{ email: string }`.
  - `PATCH /api/v1/workspaces/{workspaceId}/members/{userId}/permissions` body `{ canPublishWorkflow: boolean, canManageWorkflowState: boolean }`.
  - `DELETE /api/v1/workspaces/{workspaceId}/members/{userId}`.
  - `DELETE /api/v1/workspaces/{workspaceId}/members/me`.
- Workspace OpenAPI `packages/contracts/http/workspace/openapi.yaml` xác nhận `MemberView`, `MemberPageResponse`, `MembershipRole = OWNER|MEMBER`, request limits email 1–320, và capability names. Public web route không expose internal access snapshot; vì vậy không invent capability mapping.
- Workspace controller/use cases xác nhận add tra existing active Identity user bằng email; chỉ owner được add/update/remove; owner không thể đổi permissions, bị remove hoặc leave (`OWNER_PERMISSIONS_IMMUTABLE`, `OWNER_CANNOT_REMOVE`, `OWNER_CANNOT_LEAVE`).
- Batch 8 log `docs/work_logs/2026-09-22-mobile-auth-session.md` đã đọc; tồn đọng native/live của mobile auth không thuộc đợt này, không có blocker chức năng Web member cần xử lý trước.

## 5. GitNexus pre-edit impact

- `workspaceApi`, `useWorkspaceContext`, `workspaceKeys`, `WorkspacePage`, `ConfirmButton`: CLI trả `risk: UNKNOWN`/không resolve caller do module/property reference; đã source-verify bằng `rg` và callers trực tiếp trong Web.
- `WorkspaceMember`: GitNexus trả `risk: HIGH`, `34` upstream impacts (`16` direct, `16` depth-2, `2` depth-3). Source xác nhận type được dùng bởi Workspace API/page và mock client/fixtures; chỉ thêm field optional để không phá explicit legacy mock fixtures, adapter HTTP map field bắt buộc theo `MemberView`.
- Query flow `web workspace member management` cho thấy process symbols Workspace membership controller/use cases; source được dùng để kiểm chứng UNKNOWN và invariants. Không có HIGH/CRITICAL source symbol bị sửa mà không cảnh báo.
- GitNexus impact skill path riêng trong repo không tồn tại; dùng `pnpm dlx gitnexus@latest` theo AGENTS, không coi UNKNOWN là safe-all-clear.

## 6. Bounded plan / quyết định kỹ thuật

Plan đầy đủ: `docs/superpowers/plans/2026-09-22-web-workspace-members.md`.

| Quyết định | Lý do / bằng chứng | Hệ quả và việc theo dõi |
| --- | --- | --- |
| Add form gọi là existing Identity user email, không “invitation” | `AddMemberRequest` và `IdentityDirectoryPort.findByEmail` dùng email; không có email delivery API trong scope | User phải tồn tại/active; 404/409 do server hiển thị, không fake invitation |
| Permission UI gửi cả hai boolean | PATCH schema yêu cầu cả `canPublishWorkflow` và `canManageWorkflowState` | Mỗi toggle gửi full current permission pair; owner controls disabled, server vẫn quyết định |
| Invalidate rồi set member response vào query | Hai permission mutation liên tiếp từng lộ race do refetch cũ có thể ghi đè state mới | Query vẫn revalidate server, response mutation là cache cuối cùng cho request hiện tại |
| Leave dùng `removeWorkspace` + remove member/detail query + invalidate list | Active workspace vừa mất quyền không được giữ cho OCR/member query | List query chọn accessible workspace còn lại; không chuyển backend contract |
| Cleanup workspace state/cache khi session layout unmount hoặc user đổi | Logout làm AppLayout biến mất trước effect cũ có thể clear; cần tránh account cũ sống lại | Không tạo active-workspace source thứ hai; account-switch regression giữ pass |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `apps/web/src/api/workspace.api.ts`: thêm `AddWorkspaceMemberInput`, `UpdateWorkspaceMemberPermissionsInput`, email validation; HTTP adapters `addMember`, `updateMemberPermissions`, `removeMember`, `leaveWorkspace`; map `canManageWorkflowState`; mock chỉ chạy explicit `VITE_API_MODE=mock`.
- `apps/web/src/pages/WorkspacePage.tsx`: thay disabled member placeholder bằng add existing email, hai permission toggles, remove/leave confirm, owner/member gating, inline server errors, pending/double-submit guard, response-aware invalidation và late account/workspace guard.
- `apps/web/src/hooks/useWorkspace.ts`: cleanup workspace state/query cache khi session layout cleanup/user boundary chạy, tránh workspace account cũ sau logout/login.
- `apps/web/src/types/workflow.types.ts`: thêm `canManageWorkflowState?` cho legacy explicit mock compatibility; HTTP mapper luôn cung cấp field từ contract.
- `apps/web/src/components/common/ConfirmButton.tsx`: additive `dataTestId` để E2E định vị confirm trigger, không đổi modal semantics.

### 7.2. API, bảo mật và lỗi

- Protected Gateway routes dùng shared `requestWorkspace`, gửi Bearer auth hiện có; 401 vẫn đi qua auth store logout flow.
- Không fallback mock/localStorage khi HTTP lỗi. HTTP errors giữ envelope `code/message/requestId`; UI hiển thị message an toàn, không success giả.
- Remove/leave confirm nêu target/workspace và hậu quả. Owner restrictions không bị client chuyển role; backend tiếp tục enforce.

### 7.3. Test/docs

- `apps/web/e2e/workspace-members.spec.ts`: 7 UI/network fixture tests cho route/body mapping, owner/member gating, invalid/error preservation, double submit, permission pair, remove confirm cancel/success, leave selection cleanup và late workspace switch.
- `apps/web/e2e/workspace-read-switch.spec.ts`: cập nhật assertion cũ từ placeholder “invite” sang “add member”; regression account-switch create late-response vẫn giữ.
- `docs/superpowers/plans/2026-09-22-web-workspace-members.md`: bounded plan/acceptance/commands.
- File log này.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| Sửa, đang dirty từ batch trước | `apps/web/src/api/workspace.api.ts` | Thêm member HTTP adapters/mapping | Review cùng diff cũ của Web Workspace; không reset phần trước |
| Sửa, đang dirty từ batch trước | `apps/web/src/pages/WorkspacePage.tsx` | UI mutation/gating/cleanup | Cùng file create/rename/read/switch; preserve toàn bộ |
| Sửa, untracked từ batch trước | `apps/web/src/hooks/useWorkspace.ts` | Session cleanup và query boundary | Không tạo active source thứ hai |
| Sửa | `apps/web/src/types/workflow.types.ts` | Optional permission field | GitNexus HIGH đã source-verify |
| Sửa | `apps/web/src/components/common/ConfirmButton.tsx` | Additive test id prop | Không đổi confirm behavior |
| Sửa, untracked từ batch trước | `apps/web/e2e/workspace-read-switch.spec.ts` | Regression assertion | Không xóa tests cũ |
| Thêm | `apps/web/e2e/workspace-members.spec.ts` | Bounded Playwright fixtures | Fixture PASS không phải live PASS |
| Thêm | `docs/superpowers/plans/2026-09-22-web-workspace-members.md` | Plan bounded | Chưa commit |
| Thêm | `docs/work_logs/2026-09-22-web-workspace-members.md` | Evidence/handoff | Không chứa secret |

Các mobile changes, notification/OCR tests, examples untracked và hai stash là thay đổi tồn tại trước session này; không restore/chỉnh ngoài scope.

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| RED baseline | `$env:CI='1'; pnpm --dir apps/web test:e2e -- e2e/workspace-members.spec.ts --project=chromium --workers=1 --retries=0 --grep "adds an existing" --timeout=5000` | `FAIL` tại selector placeholder chưa tồn tại | Expected RED trước production code |
| Member fixture E2E | `$env:CI='1'; pnpm --dir apps/web test:e2e -- e2e/workspace-members.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` | `7 passed` | Controlled HTTP fixture/UI/network, không live |
| Workspace/OCR regression | `$env:CI='1'; pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` | `27 passed` | Bao gồm account-switch create late-response; không chứng minh live member mutation |
| Focused ESLint | `pnpm --dir apps/web exec eslint src/api/workspace.api.ts src/pages/WorkspacePage.tsx src/hooks/useWorkspace.ts src/types/workflow.types.ts src/components/common/ConfirmButton.tsx e2e/workspace-members.spec.ts e2e/workspace-read-switch.spec.ts` | `PASS` | Chỉ file scope |
| Web build | `pnpm --dir apps/web build` | `PASS`; 2508 modules, bundle warning >500 kB | Không phải live runtime |
| Full Web lint | `pnpm --dir apps/web lint` | `FAIL baseline ngoài scope`: `SettingsPage.tsx:76,82` errors; line 106 warning | Không sửa SettingsPage/tooling |
| Static/diff check | `git diff --check` | `PASS`; cảnh báo CRLF cũ từ mobile workspace ngoài scope | Không stage/commit |
| Runtime prerequisites | `Test-NetConnection localhost -Port 3000/5173/8081/8085` | Tất cả `False` | Gateway/Identity/Workspace không chạy |
| Git status/stash | `git status --short; git stash list` | `66 entries` (`34 tracked modified`, `32 untracked`), `0 staged`; hai stash giữ nguyên | Chỉ đọc, không restore/pop/drop |

### Live / fixture distinction

- Fixture evidence chứng minh browser UI gửi đúng path/body/method, auth header fixture, response mapping, confirmation và cache/selection behavior trong controlled browser.
- Không có real authenticated browser proof: Gateway/Identity/Workspace và approved test workspace/users không khả dụng; không bật bypass JWT, không seed/xóa member dữ liệu thật.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý hiện tại |
| --- | --- | --- | --- |
| Cao | Live Gateway/Identity/Workspace unavailable | Ports 3000/5173/8081/8085 đều `False` | Chỉ claim fixture/build; cần approved runtime/test workspace/users để live verify |
| Trung bình | Full lint baseline fail ngoài scope | `SettingsPage.tsx` set-state-in-effect | Không sửa file ngoài scope; focused lint PASS |
| Trung bình | Public web chưa có capability snapshot route | Capability chỉ có internal OpenAPI/controller | Gate conservative theo loaded `MemberView.role`; backend quyết định; current user không nằm trong page thì controls disabled với status rõ |
| Thấp | Member list UI vẫn dựa page hiện có (default 20), chưa thêm pagination UI | Read slice đã có PageResult nhưng page chưa có paging control | Không mở rộng slice; owner/member management nên verify với current membership loaded hoặc bổ sung capability/paging ở đợt riêng |
| Thấp | Member-specific late account response chưa có test mới riêng | Fixture account setup không tạo request B sau logout/login dù token/user B đã được kiểm tra; existing workspace create account-switch regression `27/27` PASS | Giữ guard `isCurrentUser`/workspace; không rewrite auth harness trong bounded slice; cần runtime/harness review riêng nếu muốn chứng minh mutation account-switch trực tiếp |

## 11. Trạng thái bàn giao

### Đã hoàn thành / user review

1. Review `workspace.api.ts` routes/body/mapping, nhất là add bằng existing Identity email và PATCH gửi đủ hai booleans.
2. Review `WorkspacePage.tsx` owner/member gate, pending/error preservation, confirmation, scoped invalidation và leave selection cleanup.
3. Review `useWorkspace.ts` logout/account cleanup; bảo đảm không có active workspace source thứ hai và late response không chạm account mới.
4. Review fixture `workspace-members.spec.ts` cùng regression `workspace-read-switch.spec.ts`/`ocr-builder.spec.ts`.

### Cần quyền/runtime từ người khác

- Approved authenticated Gateway + Identity + Workspace runtime, test workspace và test users để chạy real browser add/permission/remove/leave. Không dùng dữ liệu người dùng thật ngoài test.
- Quyết định riêng nếu muốn mở rộng public capability endpoint hoặc member pagination; không thuộc đợt 9.

### Checklist user review

- [ ] POST add dùng đúng `email`, không hiểu là invitation delivery.
- [ ] PATCH permission luôn gửi `canPublishWorkflow` + `canManageWorkflowState`; owner row không mutation.
- [ ] DELETE remove và DELETE `/me` confirm đúng; owner cannot remove/leave là backend invariant, không client invent conversion.
- [ ] 403/404/409/validation envelope giữ message, không success toast/localStorage HTTP.
- [ ] Leave không giữ selected workspace đã mất quyền; OCR/member query không tiếp tục dùng ID đó.
- [ ] Kiểm tra diff có nhiều file dirty từ các đợt trước; không reset/stage-all.
- [ ] Không commit/merge/push trong đợt này.

## 12. Tham chiếu

- `AGENTS.md`
- `docs/work_logs/2026-09-22-mobile-auth-session.md`
- `docs/work_logs/2026-09-22-web-notification-integration.md`
- `docs/work_logs/2026-09-22-web-ocr-integration.md`
- `packages/contracts/http/workspace/openapi.yaml`
- `packages/contracts/http/gateway/openapi.yaml`
- `services/api-gateway/src/workspace/workspace.controller.ts`
- `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/MembershipController.java`
- `services/workspace-service/src/main/java/com/weav/workspace/application/usecase/{AddMemberUseCase,UpdateMemberPermissionsUseCase,RemoveMemberUseCase,LeaveWorkspaceUseCase}.java`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22` sau final checks, Asia/Saigon |
| Trạng thái worktree | `Có thay đổi chưa commit; 66 entries, 34 tracked modified + 32 untracked, 0 staged; stash giữ nguyên` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Luna Max` |
| Cần đọc trước khi tiếp tục | Mục 9–11 file này, plan bounded, root `AGENTS.md`, Workspace/Gateway contracts |
