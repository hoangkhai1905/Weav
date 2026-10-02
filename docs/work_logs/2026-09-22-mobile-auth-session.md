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
| Trạng thái cuối session | `Hoàn thành trong phạm vi; native/live blocked` |
| Phạm vi session | Mobile HTTP Identity session persistence/restore bằng SecureStore native |
| Liên kết liên quan | Batch 7 Web Notification; Identity auth OpenAPI/controller |

## 2. Tóm tắt điều hành

### Kết quả chính

- Khảo sát trước sửa xác nhận gap: mobile HTTP auth chưa hydrate session khi cold start, chưa có loading gate và chưa xử lý rotation/persistence race. Gap vẫn còn nên đã triển khai bounded fix.
- Contract thật: Gateway `/api/auth/login|refresh|logout`, `/api/auth/me`; Identity refresh trả token pair mới và `user`, refresh token là single-use 43 ký tự.
- Đã thêm SecureStore adapter native + coordinator single-flight; Expo Web chỉ memory; giữ một Zustand auth source-of-truth; không sửa backend/Web.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Mobile `tsc`; Expo Web export |
| Unit / integration test | `PASS` | Node harness mobile `30/30` |
| Runtime / live | `BLOCKED` | Gateway/Identity ports down; Docker/native device unavailable |
| Review thay đổi | `PASS bounded` | `git diff --check` PASS với CRLF warning baseline; GitNexus collision đã source-verify |
| Commit / PR | Chưa tạo | User yêu cầu không commit/merge/push |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Lưu refresh material tối thiểu bằng `expo-secure-store` trên native sau login/register.
2. Cold-start hydrate và refresh token theo Identity contract trước protected queries, không flash signed-in/demo.
3. Clear memory/storage/cache an toàn khi logout, revoked session, account switch và late response.

### Trong phạm vi

- `apps/mobile` auth store, Identity repository, HTTP auth lifecycle, Expo Router gate, auth-scoped query cleanup và focused tests.
- Work log này.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa backend contract, Web auth, mobile workspace mutation, member mutation, OAuth, biometric, session-management screen, Workflow/AI/Bot.
- Không dùng localStorage/AsyncStorage cho access/refresh token; không restore/pop/drop stash; không stage-all/commit/merge/push.

### Tiêu chí hoàn thành

- [x] Native HTTP session lưu refresh token qua SecureStore, hydrate/rotate trước protected queries.
- [x] Web HTTP chỉ memory sau reload; mock explicit không ghi SecureStore.
- [x] Logout/revoke/network/storage failure và stale response có hành vi rõ, không log token.
- [x] Focused tests, mobile tsc, Expo Web export, regression auth/workspace/notification phù hợp và `git diff --check` được ghi bằng chứng.

## 4. Bối cảnh và nguồn sự thật

- `apps/mobile/package.json` đã có `expo-secure-store ~57.0.1`, `expo ~57.0.14`; không có test/typecheck/export script riêng.
- `packages/contracts/http/auth/openapi.yaml` và `services/api-gateway/src/identity/identity.module.ts` xác nhận routes Gateway; `services/identity-service/src/main/java/com/weav/identity/presentation/http/AuthController.java` xác nhận refresh rotation, logout 204; `TokenResponse` trả `user` cùng token pair.
- `apps/mobile/src/stores/auth.store.ts` hiện chỉ giữ memory; `apps/mobile/src/app/_layout.tsx` chưa hydrate; `apps/mobile/src/app/(app)/_layout.tsx` redirect ngay khi false.
- Expo docs chính thức mô tả SecureStore là native encrypted key-value storage và không có web equivalent; áp dụng native-only persistence.

## 5. GitNexus pre-edit impact

- Đã chạy GitNexus latest `1.6.12` query/impact upstream cho auth session flow và các symbol `useAuthStore`, `setAuthSession`, `setHttpClientToken`, `RootLayout`, `AppLayout`.
- Index hiện tại đúng commit `7e14de0` nhưng có collision với `examples/3dviz-pro-max` và một số symbol cùng tên; kết quả `UNKNOWN`/ID nhiễu không được coi là safe.
- Cảnh báo: impact `setHttpClientToken` báo `HIGH`; một truy vấn `useAuthStore` trả `CRITICAL` nhưng target id/path bị fixture collision. Source đã xác minh callers thật trong Login/Register, AppLayout, Workspace/Notification repositories/hooks và layouts; do đó giữ sửa bounded, không đổi token interceptor contract.

## 6. Bounded plan

### RED

1. Thêm test thuần cho coordinator: persist-before-apply, cold restore/rotation, unauthorized vs transient network, single-flight refresh, storage failure, logout/hydrate race và account-operation race.
2. Thêm test adapter policy: native delegate SecureStore; web/mock không gọi storage.

### GREEN

1. Thêm `auth-session.storage.ts` (pure contract) và Expo SecureStore adapter; chỉ lưu refresh token native.
2. Thêm auth-session coordinator/runtime; update auth types/HTTP repository, auth store hydration state, root/app gate, login/register và logout callers.
3. Dọn query cache `workspaces`/`notifications` theo account khi logout/đổi user; không tạo source-of-truth thứ hai.

### VERIFY

- Chạy focused Node tests, `pnpm --dir apps/mobile exec tsc --noEmit --pretty false`, `pnpm --dir apps/mobile exec expo export --platform web --output-dir <temporary> --no-minify`, regression tests có sẵn và `git diff --check`.
- Native SecureStore/device và live Identity/Gateway chỉ ghi là bằng chứng nếu runtime + approved test account có sẵn; fixture/Expo Web không chứng minh native persistence.

## 7. Nhật ký session

### Session 1 - Khảo sát và plan

| Việc | Kết quả | Trạng thái |
| --- | --- | --- |
| Đọc status/AGENTS/work logs đợt trước | Giữ nguyên 24 tracked modified, 26 untracked và 2 stash; không restore/pop/drop | Xong |
| Đọc manifest/source/contract | Xác nhận SecureStore đã có; auth persistence/restore còn thiếu | Xong |
| GitNexus graph-first + source verification | Collision/UNKNOWN/HIGH/CRITICAL đã ghi ở mục 5 | Xong |
| Bounded TDD plan | Chỉ mobile auth persistence/restore | Xong |

### Session 2 - Implementation và verification

| Việc | Kết quả | Trạng thái |
| --- | --- | --- |
| Implementation | SecureStore native refresh-token persistence, hydration gate, coordinator, cache cleanup và logout wiring | Xong |
| Tests/build/export | Node `30/30`, mobile tsc PASS, Expo Web export PASS | Xong |
| Runtime/browser/device | Live/native unavailable; fixture/unit evidence tách riêng | Bị chặn ngoài code |

## 8. Thay đổi đã thực hiện

- `apps/mobile/src/infrastructure/auth/auth-session.storage.ts`: pure storage contract; native only delegates to SecureStore, web/mock no-op.
- `apps/mobile/src/infrastructure/auth/expo-auth-session.storage.ts`: wires Expo Platform + `expo-secure-store` đã có trong manifest; chỉ refresh token được lưu.
- `apps/mobile/src/features/auth/auth-session.coordinator.ts`: single-flight restore/refresh, rotation persistence ordering, operation invalidation, local-first logout và invalid/transient distinction.
- `apps/mobile/src/features/auth/auth-session.runtime.ts`, `useAuthSession.ts`: production wiring, hydration bootstrap và workspace/notification query cleanup theo account.
- `apps/mobile/src/stores/auth.store.ts`: thêm `isHydrating`, `authError` và actions; vẫn là auth source-of-truth duy nhất.
- `apps/mobile/src/infrastructure/http/http-auth.repository.ts`, `domain/auth/auth.types.ts`, `infrastructure/mock/mock-auth.repository.ts`: thêm `restoreSession`, logout token override và status-preserving auth errors theo Gateway/Identity contract.
- `apps/mobile/src/app/_layout.tsx`, `app/(app)/_layout.tsx`: bootstrap/cache boundary và loading gate trước protected route.
- `apps/mobile/src/app/(auth)/login.tsx`, `register.tsx`: persist-before-success, operation guard.
- `apps/mobile/src/app/(app)/(tabs)/profile.tsx`, `app/(app)/settings/index.tsx`: logout dùng local-first coordinator, revoke best-effort.
- `apps/mobile/src/infrastructure/http/http-workspace.repository.ts`, `http-notification.repository.ts`: 401 expire cả persisted auth state, không tiếp tục giữ refresh material revoked.
- `apps/mobile/src/features/auth/auth-session.coordinator.test.cjs`: 8 test lifecycle/storage/race.
- Các file dirty khác, stash và untracked ngoài danh sách trên là thay đổi trước đợt 8; không chỉnh/khôi phục.

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Status baseline | `git status --short`, `git stash list --date=local` | Đã đọc; chi tiết cập nhật ở handoff | Không thay đổi stash |
| GitNexus | `pnpm dlx gitnexus@latest query/impact ...` | Collision/UNKNOWN/HIGH/CRITICAL như mục 5 | Source verification bắt buộc |
| Focused auth lifecycle | `node --test apps/mobile/src/features/auth/auth-session.coordinator.test.cjs` | `8/8 PASS` | Pure coordinator + storage policy; không chứng minh SecureStore native |
| Mobile regression harness | `node --test $(rg --files apps/mobile/src | rg '\\.test\\.cjs$')` | `30/30 PASS` | Bao gồm workspace/notification/auth-client contract fixtures; không live |
| Typecheck | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` | `PASS` | Mobile TypeScript |
| Expo Web export | `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <temp> --no-minify` | `PASS`; 40 static routes bundled | Expo Web memory behavior only, not native SecureStore |
| Lint | `pnpm --dir apps/mobile lint` | `BLOCKED/NOT ACCEPTED`: Expo tự tạo config và cài ESLint khi thiếu config; thay đổi dependency/config đã được gỡ lại | Không mở rộng tooling; baseline thiếu lint config |
| Runtime prerequisites | `Test-NetConnection localhost -Port 3000/8081..8085`; `docker compose ps`; `adb devices` | Ports `False`; Docker daemon unavailable; không có device evidence | Chưa chạy live/native |
| Static/diff check | `git diff --check` | `PASS`; CRLF warning cũ ở workspace file | Không stage/commit/merge/push |

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Dấu hiệu | Cách xử lý hiện tại |
| --- | --- | --- | --- |
| Cao | GitNexus collision làm một số impact không đáng tin tuyệt đối | Target IDs trỏ fixture/example hoặc `UNKNOWN`; `setHttpClientToken` báo HIGH | Không miễn trừ cảnh báo; source-verify callers và giữ diff nhỏ |
| Cao | Chưa có native device/approved live Identity session | Ports 3000/8081..8085 down; Docker daemon không chạy; không có native device evidence | Không bật service/bypass JWT; fixture/unit không gọi là live/native PASS |
| Trung bình | Lint baseline thiếu config | `pnpm --dir apps/mobile lint` tự động đề nghị cài ESLint/config | Gỡ đúng config/package/lock do auto-setup; không tự cài tooling lại |
| Thấp | Refresh rotation chỉ có unit coordinator evidence | Không thể gọi Identity thật trong môi trường hiện tại | Khi có approved runtime, chạy cold-start/rotation trên device và cập nhật log |

## 11. Trạng thái bàn giao

### Files thuộc đợt 8

- Thêm: `apps/mobile/src/features/auth/` (coordinator, runtime, hook, 8-test CJS harness), `apps/mobile/src/infrastructure/auth/` (SecureStore adapter/persistence), work log này.
- Sửa có phần dirty trước cần giữ: `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/app/(app)/(tabs)/profile.tsx`, `apps/mobile/src/infrastructure/http/http-workspace.repository.ts`, `http-notification.repository.ts`.
- Sửa thuộc đợt 8: auth store/types/repository/mock, auth login/register, app route gate, settings/profile logout.

### Behavior handoff

- Native + HTTP: login/register lưu refresh token tối thiểu sau khi SecureStore ghi thành công; cold start đọc token, gọi `POST /api/auth/refresh`, lưu token đã rotate trước khi publish Zustand session; protected workspace/notification queries chỉ bật sau hydration.
- Native invalid 401/revoked: clear memory + SecureStore, account-scoped workspace/notification query cleanup, signed-out. Network/503 khi restore/refresh: signed-out/unverified nhưng giữ refresh material để retry chủ động; không replay mutation.
- Logout: invalidate late hydrate/refresh/login, clear memory/storage trước, gọi Gateway logout với token đã capture best-effort; revoke lỗi không phục hồi session.
- Expo Web HTTP: no persistent SecureStore equivalent; memory-only, sign-in lại sau reload; không ghi access/refresh token vào localStorage/AsyncStorage. Mock explicit: demo state không chạm SecureStore.

### Evidence and blockers

- Unit/fixture: `30/30` mobile Node tests, trong đó `8/8` auth lifecycle; tests chứng minh rotation, single-flight, invalid/transient, storage failure, logout/hydrate race, superseded operation và web/mock storage policy.
- Compile/export: mobile tsc PASS; Expo Web export PASS, 40 routes. Đây không phải native SecureStore proof.
- Live/native: BLOCKED. Gateway/Identity ports `3000`, `8081`–`8085` đều không mở; Docker Desktop Linux engine unavailable; không có approved test account/native device evidence. Không đọc/in secret, không seed dữ liệu.
- Lint: baseline thiếu config; Expo auto-setup đã bị gỡ lại, nên không claim lint PASS.

### Checklist user review

1. Review coordinator: storage write trước `setAuthSession`, `storageOperation` queue, lifecycle invalidation và phân biệt 401 với transient.
2. Review `auth-session.runtime.ts` + `useAuthSession.ts`: persistence chỉ bật native HTTP, loading gate/query cleanup không tạo auth source thứ hai.
3. Review `http-auth.repository.ts`: `/api/auth/refresh`, `/api/auth/logout`, `TokenResponse.user` mapping; không gửi token trong URL/log.
4. Review login/register/profile/settings để xác nhận không success giả khi SecureStore lỗi và logout local-first.
5. Khi runtime được cấp, chạy native device cold start + revoked/rotation/logout race và authenticated Gateway smoke; cập nhật log, không tự mở đợt 9.

## 12. Tham chiếu

- `AGENTS.md`, `apps/mobile/AGENTS.md`
- `docs/work_logs/2026-09-22-web-notification-integration.md`
- `packages/contracts/http/auth/openapi.yaml`
- `services/api-gateway/src/identity/identity.module.ts`
- `services/identity-service/src/main/java/com/weav/identity/presentation/http/AuthController.java`

## 13. Kết thúc session

| Thời điểm dừng | `2026-09-22` sau khi hoàn tất checks, Asia/Saigon |
| Trạng thái worktree | Có thay đổi chưa commit; `61` entries (`32` tracked modified + `29` untracked), `0` staged; stash giữ nguyên; `git diff --check` PASS với CRLF warning cũ |
| Commit/PR đã tạo | Chưa tạo theo yêu cầu |
| Người cập nhật log | `Luna Max` |
| Cần đọc trước khi tiếp tục | Mục 11 behavior/evidence/blocker, root `AGENTS.md`, `apps/mobile/AGENTS.md`, Identity OpenAPI/controller |
