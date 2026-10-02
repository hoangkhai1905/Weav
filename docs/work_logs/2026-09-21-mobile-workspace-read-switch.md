# Nhật ký làm việc - 2026-09-21

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `api-gateway` / chưa commit đợt mobile |
| Người thực hiện | `Luna Max` |
| Người review / nhận bàn giao | `Người dùng / Astra` |
| Trạng thái cuối ngày | `Hoàn thành trong phạm vi; còn blocker verification` |
| Phạm vi session | Mobile Workspace list/detail/switch và members read qua API Gateway |
| Liên kết liên quan | Workspace/Gateway OpenAPI và controller trong repository |

## 2. Tóm tắt điều hành

### Kết quả chính

- Đã kiểm tra kết quả đợt 1/2, git status và phát hiện không có blocker chức năng mới cần xử lý trước đợt 3; các blocker live-auth/full-lint của web được giữ nguyên, ngoài phạm vi.
- Đã xác nhận mobile hiện gọi route không tồn tại `/api/workspaces/current` và chỉ có repository/hook cho một workspace cố định; đây là gap chính của slice.
- Đã lập kế hoạch bounded: thay repository bằng API có phân trang, chuyển state sang danh sách + `activeWorkspaceId`, thêm query/cache isolation theo user/workspace, UI read/switch/members và kiểm thử theo harness hiện có.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | Chưa chạy | Sẽ dùng `pnpm --dir apps/mobile exec tsc --noEmit` nếu Expo cung cấp compiler và `pnpm --dir apps/mobile lint`. |
| Unit / integration test | Chưa chạy | Mobile không khai báo Jest/Vitest/Playwright; chỉ có `node:test` mapper test hiện hữu. |
| Migration / database | Không áp dụng | Không sửa backend/database. |
| Health check | Chưa kiểm tra | Chưa có authenticated Gateway runtime được xác nhận. |
| Review thay đổi | Đang làm | Chưa sửa production source tại thời điểm lập plan. |
| Commit / PR | Chưa tạo | Theo yêu cầu không commit/merge/push. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Cho mobile đọc danh sách/chi tiết workspace và đọc members qua Gateway bằng contract thật.
2. Cho phép chọn workspace tồn tại, hiển thị members đúng workspace, có loading/error/empty/retry và không flash dữ liệu cũ.
3. Cô lập query/state theo user và workspace, xử lý logout/account switch/late response an toàn.

### Trong phạm vi

- `apps/mobile`: domain workspace, HTTP/mock repository tương thích, query hook, Zustand workspace state, root query cleanup, Workspace screen và các consumer đang đọc active workspace.
- Contract kiểm chứng: `GET /api/v1/workspaces`, `GET /api/v1/workspaces/{workspaceId}`, `GET /api/v1/workspaces/{workspaceId}/members`.
- Pagination: request `size <= 100`, lặp các page còn lại để UI không coi page đầu là toàn bộ.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa web, backend, mobile create/rename/member mutations, Workflow/AI/Bot hoặc secure-session persistence/auth redesign.
- Không fallback mock khi HTTP lỗi; mock chỉ được chọn bởi `EXPO_PUBLIC_API_MODE=mock`.
- Không seed hoặc gọi dữ liệu thật không liên quan.

### Tiêu chí hoàn thành

- [ ] HTTP repository map đúng page/workspace/member contract, route và auth header; không còn route `current`.
- [ ] Store/query dùng một nguồn active workspace là `activeWorkspaceId`, key có `userId` và `workspaceId` khi phù hợp.
- [ ] Workspace UI có list/switch/detail/members, loading/error/empty/retry, 403/404 selection recovery và không flash members cũ.
- [ ] Có kiểm thử có ý nghĩa cho mapping, pagination, error/empty, switch, account isolation/late response và missing ID.
- [ ] Chạy được focused checks, lint/typecheck phù hợp, `git diff --check`; live/fixture/native evidence được phân biệt rõ.
- [ ] Không commit/merge/push; log và handoff cập nhật.

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Mobile đang dùng Expo SDK `~57.0.14`, React Native `0.86.2`, TanStack Query và Zustand. `useWorkspace` hiện truy vấn `['workspace']`/`['workspace','members']`; store khởi tạo hardcode `ws-main`; HTTP repository gọi `/api/workspaces/current`.
- **Nguồn contract:** `packages/contracts/http/gateway/openapi.yaml`, `packages/contracts/http/workspace/openapi.yaml`, `services/api-gateway/src/workspace/workspace.controller.ts`, `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/WorkspaceController.java` và `MembershipController.java`.
- **Contract đã xác minh:** list/detail trả `WorkspaceResponse` với `id,name,createdBy,createdAt,updatedAt`; list/members trả `PageResult`; `MemberView` có `userId`, `email`, nullable `displayName`, `role`, capability flags và timestamps. Gateway query `page` bắt đầu từ 0, `size` tối đa 100.
- **Harness:** `apps/mobile/package.json` chỉ có `start`, `web`, `android`, `ios`, `lint`, `reset-project`; không có test runner mobile. File test duy nhất hiện thấy là `src/infrastructure/http/notification.mapper.test.cjs` dùng `node:test`. Không suy PASS từ fixture nếu không có live authenticated runtime.
- **GitNexus:** query/context đã chạy graph-first. `WorkspaceRepository` upstream impact: `MEDIUM`, lower-bound, dynamic dispatch boundary; `HttpWorkspaceRepository`: `LOW`, lower-bound. `useWorkspace`, `RootLayout`, `WorkspaceScreen` trả `UNKNOWN`; `ProfileScreen` trả `HIGH` do collision với symbol trong untracked `3dviz-pro-max`. Các UNKNOWN/HIGH đã được xác minh bằng source và `rg`; sẽ tránh coi đó là an toàn mặc định.

## 5. Kế hoạch bounded trước implementation

### Bước 1 — contract/mapping và test đỏ

- Sửa `apps/mobile/src/domain/workspace/workspace.types.ts`: `PageResult`, list/detail/member query types và repository methods nhận `workspaceId`/pagination/signal.
- Thêm mapper thuần cho `WorkspaceResponse`/`MemberView` và test `node:test` hoặc harness có sẵn, tập trung page metadata, `userId` và `displayName` nullable.
- Sửa `apps/mobile/src/infrastructure/http/http-workspace.repository.ts` và mock adapter theo interface; giữ mock explicit, không fallback.

### Bước 2 — state/query isolation

- Sửa `apps/mobile/src/stores/workspace.store.ts`: state chỉ giữ `workspaces`, `activeWorkspaceId` và selection/access-error actions; không giữ bản sao `activeWorkspace`.
- Sửa `apps/mobile/src/features/workspace/hooks/useWorkspace.ts`: query keys `[workspaces,userId,...]`, `[workspace,userId,workspaceId]`, `[members,userId,workspaceId]`; fetch hết page còn lại với guard; disable khi thiếu user/ID; clear/guard late response.
- Sửa `apps/mobile/src/app/_layout.tsx`: cleanup workspace queries/store khi logout hoặc đổi user bằng QueryClient lifecycle hiện có, không đổi cơ chế secure session.

### Bước 3 — UI/consumer và regression

- Sửa `apps/mobile/src/app/(app)/workspace/index.tsx`: list/select/detail/members, loading/error/empty/retry, 403/404 recovery, testIDs/accessibility state.
- Sửa `apps/mobile/src/app/(app)/(tabs)/index.tsx` và `profile.tsx` để đọc selector-derived active workspace, không tạo nguồn state thứ hai.
- Chạy focused mapping/state checks, mobile lint/typecheck và Expo Web/real auth nếu runtime đủ; ghi rõ fixture/native/live evidence.

## 6. Nhật ký theo session / thời gian

### Session 1 - khảo sát và lập plan

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| 2026-09-21 | Đọc root/mobile AGENTS, work logs đợt 1/2, git status | Giữ nguyên thay đổi web/untracked; blocker live-auth/full-lint web kế thừa, ngoài scope | Xong |
| 2026-09-21 | Đọc OpenAPI/Gateway/Workspace controllers | Xác nhận 3 route GET, PageResult và MemberView contract | Xong |
| 2026-09-21 | GitNexus query/context/impact + source verification | Đã ghi risk/boundary, không coi UNKNOWN là PASS | Xong |
| 2026-09-21 | Đọc package/harness mobile | Không có test/build script chuyên mobile ngoài Expo lint/start; cần bounded harness | Xong |

## 7. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Aggregate pagination ở query layer | Contract có `totalPages`; UI cần không coi page đầu là toàn bộ | Chỉ gọi page 0 sẽ sai khi có nhiều workspace/member | Test phải kiểm tra request page tiếp theo và metadata hợp lệ |
| `activeWorkspaceId` là state duy nhất | Store hiện giữ object hardcode; user yêu cầu không tạo hai nguồn active | Giữ cả object và ID dễ lệch khi refresh/switch | Home/Profile dùng selector-derived object |
| Snapshot user/workspace trong query key và guard effect | Bảo vệ account switch/late response mà không redesign auth persistence | Dùng key chung hiện tại gây rò cache | Root cleanup remove query cũ và clear store |
| Detail query theo selected ID | Slice yêu cầu list/detail/switch và route detail có trong contract | Chỉ dùng summary list bỏ qua endpoint detail | 403/404 detail/members phải hạ selection an toàn |

## 8. Trạng thái bàn giao hiện tại

- Implementation mobile slice đã hoàn thành trong phạm vi; bằng chứng và blocker cập nhật ở phần 10-14.
- Không commit/merge/push; dừng chờ user review và không tự mở đợt 4.

## 9. Tham chiếu

- `apps/mobile/AGENTS.md`
- `packages/contracts/http/gateway/openapi.yaml`
- `packages/contracts/http/workspace/openapi.yaml`
- `services/api-gateway/src/workspace/workspace.controller.ts`
- `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/WorkspaceController.java`
- `services/workspace-service/src/main/java/com/weav/workspace/presentation/http/MembershipController.java`
- `docs/work_logs/2026-09-21-web-workspace-read-switch.md`
- `docs/work_logs/2026-09-21-web-workspace-create-rename.md`

## 10. Kết quả implementation và bằng chứng

### Code và hành vi đã hoàn thành

- `HttpWorkspaceRepository` bỏ `/api/workspaces/current`, dùng `/api/v1/workspaces`, `/api/v1/workspaces/{id}` và `/api/v1/workspaces/{id}/members`; request giữ bearer token snapshot, không fallback mock khi HTTP lỗi, 401 đi qua auth store hiện tại, 403/404 được expose cho hook xử lý selection.
- Contract mapper map đúng `WorkspaceResponse`, `PageResult` và `MemberView.userId/displayName`; `displayName` null dùng email làm tên hiển thị nhưng vẫn giữ field gốc. Query layer lặp page `0..totalPages-1` với `size=100` để không coi trang đầu là toàn bộ.
- Store chỉ giữ `workspaces` và `activeWorkspaceId`; list/detail/members query key scope theo `userId` và `workspaceId`. Root cleanup xoá workspace cache/selection khi logout hoặc đổi account; late response bị signal scope guard chặn trước khi áp dụng.
- Workspace screen có list/select/detail/members read-only, loading/error/empty/retry, selection state và thông báo rõ phần member mutation chưa hỗ trợ. Home/Profile đọc active workspace bằng selector, không giữ object active thứ hai.

### Lệnh và kết quả thực tế

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| Focused Node tests | `node --test apps/mobile/src/infrastructure/http/notification.mapper.test.cjs apps/mobile/src/infrastructure/http/workspace.http.repository.test.cjs apps/mobile/src/features/workspace/workspace.pagination.test.cjs apps/mobile/src/stores/workspace.store.test.cjs` | `PASS`, 9 tests | Contract/helper/store/pagination; mobile chưa có component test runner |
| Expo Web export | `pnpm --dir apps/mobile exec expo export --platform web --output-dir .expo/export-check --no-minify` | `PASS`, bundle web + 40 static routes, gồm `/(app)/workspace` | Build/export không chứng minh Gateway auth |
| Mock browser fixture | `cmd /c "set EXPO_PUBLIC_API_MODE=mock&& pnpm --dir apps/mobile web -- --port 8087"`; mở `http://localhost:8087/(app)/workspace` | `PASS`: list workspace, selected detail và 3 member rows hiển thị | Explicit mock only; không phải live Gateway/native PASS |
| Typecheck | `pnpm --dir apps/mobile exec tsc --noEmit --pretty false` | `FAIL` tại `src/features/notifications/hooks/useNotifications.ts:54`, `Type 'unknown' is not assignable to type 'string'` | Lỗi baseline ngoài slice, không sửa notification |
| Lint | `pnpm --dir apps/mobile lint` | `BLOCKED`: mobile chưa có ESLint config; Expo CLI đề nghị tự cài dependency và đã được hoàn nguyên | Không để lại package/lock/config mutation |
| Diff hygiene | `git diff --check` | `PASS` | Có cảnh báo Git về CRLF/LF của file UI, không có whitespace error |

### Browser/native/live evidence

- Fixture browser: đã đọc accessibility tree của Expo Web ở mock mode; thấy `WEAV Production Workspace`, selected state, detail read-only notice và các member `OWNER/MEMBER` với email/capability.
- Live authenticated Gateway: `BLOCKED/Chưa kiểm tra`; không có runtime Gateway + session được xác nhận trong môi trường này, nên không kết luận route live PASS.
- Native Android/iOS: `Chưa chạy`; repository không có native E2E/unit harness riêng ngoài Node test hiện hữu.

## 11. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| Sửa | `apps/mobile/src/domain/workspace/workspace.types.ts` | Page/query/repository contract và model Workspace/Member chuẩn Gateway | Không còn API một workspace ngầm |
| Thêm | `apps/mobile/src/infrastructure/http/workspace.http.contract.ts` | Request params và mapper dùng trực tiếp bởi HTTP repository | Có test Node tương ứng |
| Sửa | `apps/mobile/src/infrastructure/http/http-workspace.repository.ts` | Gateway list/detail/members, auth/error/invalid ID | Không mock fallback |
| Sửa | `apps/mobile/src/infrastructure/http/http-client.ts` | Không ghi đè Authorization header explicit; map status 401/403/404 | Shared HTTP client, cần review kỹ |
| Sửa | `apps/mobile/src/infrastructure/mock/mock-workspace.repository.ts`, `apps/mobile/src/infrastructure/mock/mock-data.ts` | Mock explicit theo page/repository mới | Chỉ dùng khi `EXPO_PUBLIC_API_MODE=mock` |
| Sửa | `apps/mobile/src/features/workspace/hooks/useWorkspace.ts`, `apps/mobile/src/features/workspace/workspace.pagination.ts` | Query scope, pagination, cleanup, late response và recovery | Không đổi auth persistence |
| Sửa | `apps/mobile/src/stores/workspace.store.ts` | Một active source là ID + list | Home/Profile phải dùng selector |
| Sửa | `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(app)/workspace/index.tsx` | Root cleanup và UI list/switch/detail/members | UI mutation member vẫn disabled/not supported |
| Sửa | `apps/mobile/src/app/(app)/(tabs)/index.tsx`, `apps/mobile/src/app/(app)/(tabs)/profile.tsx` | Đọc active workspace nullable qua selector | Hiển thị empty prompt khi chưa chọn |
| Sửa | `apps/mobile/src/domain/common/error.types.ts` | Thêm HTTP status vào ApiError | Dùng để phân biệt 403/404/401 |
| Thêm | `apps/mobile/src/infrastructure/http/workspace.http.repository.test.cjs`, `apps/mobile/src/features/workspace/workspace.pagination.test.cjs`, `apps/mobile/src/stores/workspace.store.test.cjs` | 9 focused Node tests | Chưa có component/native harness |

## 12. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý / bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | Mobile typecheck không sạch vì lỗi notification cũ | `useNotifications.ts:54` | Giữ ngoài scope; xử lý riêng trước khi claim full mobile typecheck PASS |
| Trung bình | Không có mobile ESLint config/harness | `pnpm --dir apps/mobile lint` tự yêu cầu cài ESLint | Không thêm dependency trong đợt này; tạo config riêng ở task tooling nếu cần |
| Trung bình | Chưa có live authenticated Gateway/native evidence | Không có runtime/session được xác nhận | User review cần chạy Gateway + auth thật và native smoke riêng |
| Thấp | GitNexus có collision/UNKNOWN do `3dviz-pro-max` untracked | impact `useWorkspace`/layout/screen bị UNKNOWN hoặc false HIGH | Đã xác minh source/rg; không coi kết quả đó là PASS |

## 13. Trạng thái bàn giao

### Có thể review ngay

1. Review contract/routes ở `apps/mobile/src/infrastructure/http/http-workspace.repository.ts` và mapper; đối chiếu không còn `/api/workspaces/current`.
2. Review single-source state ở `apps/mobile/src/stores/workspace.store.ts` và query keys/cleanup trong `apps/mobile/src/features/workspace/hooks/useWorkspace.ts`.
3. Review UI tại `apps/mobile/src/app/(app)/workspace/index.tsx`: selected ID, no-flash members, empty/error/retry và unsupported mutation notice.
4. Chạy lại 9 Node tests và Expo export; nếu có Gateway/session thì chạy authenticated flow, kiểm tra Network đúng 3 route và account switch không giữ cache cũ.

### Chưa làm / không thuộc đợt này

- Không sửa web/backend/mobile mutation, không thêm create/rename/member mutations.
- Không triển khai Workflow/AI/Bot và không mở đợt 4.
- Không commit/merge/push.

## 14. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; giữ nguyên thay đổi web/untracked có sẵn và thêm thay đổi mobile đợt 3 |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Luna Max |
| Cần đọc trước khi tiếp tục | Phần 10-13 của log này, root/mobile AGENTS, git status và source contract |
