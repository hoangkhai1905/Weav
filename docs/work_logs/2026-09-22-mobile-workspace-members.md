# Nhật ký làm việc - 2026-09-22

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày / múi giờ | `2026-09-22` / `Asia/Saigon` |
| Repository / branch | `Weav` / `api-gateway` |
| Commit đầu ngày | `7e14de0` theo kiểm tra read-only trước session |
| Người thực hiện | Luna Max |
| Người review | User / Astra điều phối |
| Trạng thái | `Hoàn thành trong scope; native/live blocked` |
| Phạm vi | Mobile Workspace member add, permissions, remove và leave qua Gateway public APIs |
| Liên quan | Batch 9 `docs/work_logs/2026-09-22-web-workspace-members.md`; plan `docs/superpowers/plans/2026-09-22-mobile-workspace-members.md` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Mobile `WorkspaceRepository`/HTTP adapter dùng đúng bốn route member của Gateway; add dùng email của Identity user hiện có, không giả invitation/user search.
- Workspace screen có owner-gated add/permission controls, cancelable remove/leave confirmation, inline error/pending và không fallback HTTP sang mock/localStorage.
- Mutation/cache state giữ user/workspace scope; leave/membership loss loại workspace khỏi active selection và xóa detail/members cache; late account/workspace result bị bỏ qua.
- Không sửa Web/backend/mobile auth persistence/Workflow/AI/Bot; không commit, merge, push hoặc stage-all.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Focused member tests | `PASS` | Route/body/MemberView mapping, validation, owner gate, selection và stale-scope; `13/13` |
| Full mobile `.test.cjs` | `PASS` | `35/35` |
| Mobile typecheck | `PASS` | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` |
| Expo Web export | `PASS` | 40 static routes; không phải browser/live proof |
| Gateway workspace contract E2E | `PASS` | 10/10 với `--forceExit`; fixture route/validation/forwarding |
| Mobile lint | `BLOCKED / limitation` | Không có ESLint config; Expo auto-install đã gỡ lại |
| Native / live authenticated | `BLOCKED` | Không có device/harness/runtime/approved test users |
| Diff check | `PASS` | `git diff --check`; chỉ warning CRLF/LF baseline ở workspace screen |
| Commit / PR | `Chưa tạo` | User yêu cầu review diff; stash giữ nguyên |

## 3. Mục tiêu và phạm vi

### Mục tiêu

1. Đọc status, AGENTS, Batch 9 và contract Workspace/Gateway trước sửa.
2. Nối member mutations mobile vào API public thật, giữ một active workspace source và cache isolation.
3. Test request/response, gating, confirmation, error preservation, cleanup và stale response.

### Trong phạm vi

- Mobile domain/repository HTTP + explicit mock, workspace query mutations/state và Workspace screen.
- Test CJS hiện có, Gateway contract E2E, typecheck/export và work log/plan.

### Ngoài phạm vi

- Không thêm invitation/email delivery/user search; backend nhận `{ email }` và Identity phải có user active.
- Không sửa Web/backend/auth persistence/mobile notification/Workflow/AI/Bot; không thêm member mutation khác.
- Không thêm Playwright/native harness/dependency chỉ để vượt limitation; không dùng dữ liệu thật ngoài test context.

### Tiêu chí

- [x] Đúng POST add, PATCH permissions, DELETE target và DELETE `/members/me`.
- [x] Validation, pending/double-submit, confirmation cancel, error preservation và no HTTP-to-mock fallback.
- [x] Scoped invalidation/selection cleanup và late account/workspace/logout isolation.
- [x] Focused/full tests, typecheck, export, Gateway contract suite và diff check.
- [ ] Native secure/device proof và live authenticated browser proof: blocked bởi runtime/harness/account prerequisites.

## 4. Bối cảnh và nguồn sự thật

- `services/api-gateway/src/workspace/workspace.controller.ts` xác nhận:
  - `POST /api/v1/workspaces/{workspaceId}/members`, body `{ email }`.
  - `PATCH /api/v1/workspaces/{workspaceId}/members/{userId}/permissions`, body đủ `canPublishWorkflow` và `canManageWorkflowState`.
  - `DELETE /api/v1/workspaces/{workspaceId}/members/{userId}` và `DELETE /api/v1/workspaces/{workspaceId}/members/me`.
- `packages/contracts/http/workspace/openapi.yaml` xác nhận email 1–320, `MemberView`, role `OWNER|MEMBER`, response 201/200 cho add/update và 204 cho delete/leave.
- Workspace `MembershipController`/use cases xác nhận owner-only add/update/remove; owner không đổi permissions, không bị remove và không leave. Backend vẫn là authority; UI gate conservative khi current member đã load là OWNER.
- Batch 9 Web semantics được đối chiếu, không copy Web state implementation. Mobile reuse active `useWorkspaceStore` và user/workspace query keys hiện có.

## 5. GitNexus pre-edit impact

- `WorkspaceRepository`: `risk MEDIUM`, 41 impacted symbols; 2 implementations và dispatch boundary nên đây là lower-bound.
- `HttpWorkspaceRepository`: `risk LOW`, 24 impacted symbols; interface binding có thể làm impact thực tế cao hơn.
- `WorkspaceMember`: `risk MEDIUM`, 35 impacted symbols.
- `useWorkspace`, `useWorkspaceStore`, `WorkspaceScreen`: GitNexus trả `risk UNKNOWN`/0 caller vì dynamic React/Zustand references; đã source-verify bằng `rg`: `_layout`, `WorkspaceScreen`, Home, Profile, repository factory và tests đều dùng các symbol này. UNKNOWN không được coi là all-clear.
- Không có HIGH/CRITICAL impact trong symbol mobile được sửa. Không sửa backend symbols; controller/use cases chỉ dùng xác minh contract/invariants.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Hệ quả |
| --- | --- | --- |
| Add bằng email, không userId/invitation | `AddMemberRequest` và `IdentityDirectoryPort.findByEmail` dùng email | User phải tồn tại/active; 404/409 từ server hiển thị, không fake invitation |
| Bốn mutation là methods của `WorkspaceRepository` | HTTP và explicit mock dùng cùng interface, không tạo source thứ hai | Mock leave báo `MOCK_UNSUPPORTED` thay vì giả success |
| Invalidate user/workspace list/detail/members sau mutation | Member count/detail và members cần revalidate từ server | Không hiển thị state giả khi request lỗi; mutation không auto-retry |
| `removeWorkspace` chọn workspace còn truy cập | Leave/mất quyền không được giữ active ID cũ cho Home/Profile/OCR/query | List refetch vẫn là nguồn server |
| UI gate owner chỉ khi current `MemberView` đã load | Public capability snapshot không có trong contract | Nếu chưa load, controls disabled và hiển thị lý do |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `apps/mobile/src/domain/workspace/workspace.types.ts`: input types và bốn methods member trong interface.
- `apps/mobile/src/infrastructure/http/workspace.http.contract.ts`: builders POST/PATCH/DELETE và strict `MemberView` mapping.
- `apps/mobile/src/infrastructure/http/http-workspace.repository.ts`: HTTP adapters, UUID validation, shared auth/error handling; DELETE map 204 thành `void`.
- `apps/mobile/src/infrastructure/mock/mock-workspace.repository.ts`: explicit in-memory add/update/remove; leave báo chưa hỗ trợ, không localStorage/giả HTTP success.
- `apps/mobile/src/features/workspace/hooks/useWorkspace.ts`: mutations, retry false, scoped invalidation, membership-loss cleanup và late scope guard.
- `apps/mobile/src/features/workspace/workspace.mutations.ts`: email validation, owner gate và pure account/workspace scope predicate.
- `apps/mobile/src/stores/workspace.store.ts`: `removeWorkspace` để active selection/Home/Profile chuyển sang workspace còn truy cập.
- `apps/mobile/src/app/(app)/workspace/index.tsx`: add existing email, permission toggles, remove/leave confirmation, pending/error/capability states.

### 7.2. Dữ liệu / migration

- Không đổi database, schema, migration, seed hay backend contract.

### 7.3. Dependency / tooling

- Không thêm dependency/tooling. `pnpm --dir apps/mobile lint` đã khiến Expo tự thêm ESLint/config; thay đổi auto-generated ở `apps/mobile/package.json`, `pnpm-lock.yaml`, `apps/mobile/eslint.config.js` đã được gỡ lại.

### 7.4. API / security

- Protected Gateway routes dùng bearer transport của shared HTTP client; 401 đi theo auth lifecycle hiện có.
- 403/404/409/validation/service errors hiển thị inline; không blind retry mutation, không fallback mock.
- Không log/persist token, password, cookie hoặc dữ liệu member mới.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| Sửa, dirty từ batch trước | `apps/mobile/src/app/(app)/workspace/index.tsx` | UI member mutation/confirmation/gating | Review cùng read/create/rename cũ |
| Sửa, dirty từ batch trước | `apps/mobile/src/domain/workspace/workspace.types.ts` | Repository member methods/input types | Interface impact MEDIUM |
| Sửa, dirty từ batch trước | `apps/mobile/src/infrastructure/http/http-workspace.repository.ts` | HTTP member adapters | Shared auth/error client |
| Thêm, dirty từ batch trước | `apps/mobile/src/infrastructure/http/workspace.http.contract.ts` | Builders + MemberView mapper | Contract source-grounded |
| Thêm, dirty từ batch trước | `apps/mobile/src/infrastructure/http/workspace.mutation.http.test.cjs` | Request/mapping tests | No network/data |
| Sửa, dirty từ batch trước | `apps/mobile/src/infrastructure/mock/mock-workspace.repository.ts` | Explicit mock parity | Leave intentionally unsupported |
| Thêm/sửa, dirty từ batch trước | `apps/mobile/src/features/workspace/workspace.mutations.ts` | Validation/scope helpers | Pure helpers |
| Thêm/sửa, dirty từ batch trước | `apps/mobile/src/features/workspace/workspace.mutations.test.cjs` | Validation/late-scope tests | Part of 35-test harness |
| Sửa, dirty từ batch trước | `apps/mobile/src/features/workspace/hooks/useWorkspace.ts` | Mutation/cache/selection flow | Reuses active store/query keys |
| Sửa, dirty từ batch trước | `apps/mobile/src/stores/workspace.store.ts` | Remove selected workspace | Home/Profile read same store |
| Thêm/sửa, dirty từ batch trước | `apps/mobile/src/stores/workspace.mutation.store.test.cjs` | Selection cleanup regression | No new source of truth |
| Thêm | `docs/superpowers/plans/2026-09-22-mobile-workspace-members.md` | Bounded plan | Review scope/acceptance |
| Thêm | `docs/work_logs/2026-09-22-mobile-workspace-members.md` | Evidence/handoff | No secrets |

> Các file mobile/Web dirty khác, untracked examples và hai stash là thay đổi trước đợt 10 hoặc ngoài scope; không restore/pop/drop/stage/commit.

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| TDD RED | `node --test` với 3 focused files trước implementation | 8 pass, 4 fail do symbols chưa tồn tại | Expected RED |
| Focused member tests | `node --test` với 3 focused files sau implementation | `13/13 PASS` | Contract/state, không UI live |
| Full mobile harness | `node --test` với mọi `apps/mobile/src/**/*.test.cjs` | `35/35 PASS` | Node contract/state/auth, không native/live |
| Mobile typecheck | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` | `PASS` | TypeScript compile |
| Expo Web export | `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <TEMP>/weav-mobile-export-batch10 --no-minify` | `PASS`, 40 routes | Export, không browser/live |
| Gateway contract suite | `pnpm --dir services/api-gateway test:e2e -- --runInBand workspace.e2e-spec.ts --forceExit` | `1 suite, 10/10 PASS` | In-process fixture, không live DB |
| Mobile lint | `pnpm --dir apps/mobile lint` | `BLOCKED`: thiếu config; Expo cố auto-install | Auto changes đã gỡ, không claim lint PASS |
| Runtime | Ports `3000,5173,8081–8085`; `adb devices` | Các port đều `False`; không có device | Gateway/Identity/Expo/native unavailable |
| UI/native harness | `rg --files apps/mobile` lọc Playwright/Detox/Maestro/Jest/Vitest | Không có harness | Không tự thêm dependency |
| Static/diff | `git diff --check` | `PASS`; warning CRLF/LF baseline | Không commit/stage |

### Fixture / Expo Web / native / live distinction

- Node tests chứng minh builder/mapping/state predicates; không gọi Gateway.
- Gateway E2E chứng minh route registration, body validation/forwarding fixture; không chứng minh DB/Identity live.
- Expo Web export chứng minh bundle/static routes; không chứng minh UI click/network.
- Không có Playwright/Detox/native harness trong mobile; chưa có native device.
- Live authenticated verification chưa chạy vì ports down và không có approved test workspace/users. Không bật JWT bypass, không seed/xóa member thật.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý hiện tại | Bước tiếp theo |
| --- | --- | --- | --- | --- |
| Cao | Chưa có live/native proof | Ports down; `adb devices` không có thiết bị; không có approved accounts | Chỉ claim Node/Gateway fixture/export | User cung cấp runtime + test workspace/users nếu cần |
| Trung bình | Mobile lint thiếu config | Package có script nhưng không có ESLint config/dev deps baseline | Gỡ auto-install/config/lockfile; không sửa tooling | Team cấp config riêng ngoài slice |
| Trung bình | Không có public capability snapshot | OpenAPI không expose capability route | Gate conservative theo loaded current `MemberView.role`; backend enforce | Nếu cần capability/pagination, mở đợt mới |
| Thấp | Mock leave không mô phỏng success | Mock user mặc định là OWNER, không giả owner leave | Trả `MOCK_UNSUPPORTED`; HTTP không fallback | Chạy live/approved fixture cho leave member |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Review diff các file mục 8, nhất là route/body ở `workspace.http.contract.ts` và cache/selection ở `useWorkspace.ts`/`workspace.store.ts`.
2. Review `WorkspaceScreen`: add bằng existing email, đủ hai permission booleans, owner gate, confirm cancel/no-request, error/input preservation và owner cannot leave.
3. Khi có runtime, chạy Expo Web/native với approved test workspace/users; tách live evidence khỏi `35/35` fixture/state PASS.

### Cần quyết định / quyền truy cập

- Approved authenticated test session, test workspace và test users để verify add/update/remove/leave thật; không dùng dữ liệu người dùng thật ngoài test.
- Quyết định riêng nếu muốn capability snapshot hoặc member pagination UI; không tự mở rộng đợt này.

### Hướng dẫn agent tiếp theo

- Đọc log này, Batch 9 log, plan, AGENTS và `git status` trước khi sửa.
- Giữ nguyên thay đổi cũ/stash/untracked; không restore/pop/drop stash, reset, stage-all, commit/merge/push.
- Không coi 35/35, Gateway fixture hoặc Expo export là live/native PASS.
- Không tự mở đợt 11; chờ user review và `work done`.

## 12. Gap table sau Batch 10

| Capability | Web | Mobile | Remaining / evidence |
| --- | --- | --- | --- |
| Identity HTTP/auth | Implemented; fixture/build verified qua logs trước | Implemented HTTP + native SecureStore path; Node/tsc/export verified | Live Identity và native cold-start/device proof còn thiếu |
| Workspace read/switch/create/rename | Implemented; Web fixtures/build verified | Implemented; mobile Node/tsc/export verified | Live authenticated Web/native proof còn thiếu |
| Workspace members | Implemented; Web fixture `7/7` | Implemented; mobile `35/35`, Gateway fixture `10/10` | Live approved users/workspace và native/UI proof còn thiếu; capability snapshot/pagination UI chưa có |
| Notification | Implemented list/cursor/unread/read/delivery; Web fixture/contract logs verified | Implemented HTTP list/read/unread; regression/tsc/export verified | Live proof còn thiếu; push/realtime chưa làm |
| OCR | Implemented Web workspace-scoped upload; fixture/regression logs verified | Chưa triển khai mobile OCR | Mobile OCR remaining; không mở scope đợt 10 |

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 11:16 Asia/Saigon` |
| Trạng thái worktree | Sau log: 68 entries, 34 tracked modified, 34 untracked, 0 staged; hai stash giữ nguyên |
| Commit/PR | `Chưa tạo` |
| Người cập nhật | Luna Max |
| Cần đọc trước khi tiếp tục | Mục 8–12 log này; Batch 9 Web members log; `git status`/stash |

---

## Checklist trước khi đóng log

- [x] Tóm tắt kết quả và phần chưa hoàn thành.
- [x] Quyết định contract/cache/gating có lý do.
- [x] File Batch 10 và giới hạn file dirty cũ đã nêu.
- [x] Commands/results và fixture/live/native distinction đã ghi.
- [x] Risks/blockers/next step có hành động rõ.
- [x] Không có secret/token/connection string.
- [x] Không commit/PR; stash không đổi.
