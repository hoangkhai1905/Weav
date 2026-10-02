# Nhật ký ngày `2026-09-22`

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` (`D:\End\Weav`) |
| Nhánh / commit đầu ngày | `api-gateway` / `7e14de0` |
| Người thực hiện | `Tesla / Luna Max worker` |
| Người review / nhận bàn giao | `USER qua Astra` |
| Trạng thái cuối ngày | `Hoàn thành trong scope; chờ review` |
| Phạm vi session | Đợt 13A: nối đổi mật khẩu Web với Identity qua Gateway hiện có |
| Liên kết liên quan | Plan `docs/superpowers/plans/2026-09-22-web-change-password.md`; contract Gateway/Identity |

## 2. Tóm tắt điều hành

### Kết quả chính

- Web Settings gửi đúng payload `{ currentPassword, newPassword }` qua `authApi.changePassword()` tới `POST /api/auth/change-password`; không sửa `auth.api.ts` vì method hiện có đã đúng contract.
- Bổ sung validation đúng policy Identity (8–72 ký tự Java và tối đa 72 UTF-8 bytes), confirm password chỉ ở UI, password input masked, pending guard chống duplicate, và error handling không echo response body/password.
- Sau `204 No Content`, Web clear password state rồi dùng logout/store flow hiện có để xoá local session; điều này khớp Identity revoke toàn bộ session, gồm session hiện tại. Stale response sau logout/account switch không được logout hoặc sửa account mới.
- Thêm focused Playwright HTTP fixture coverage và regression profile Web; không có backend/mobile/shared/root-config/lockfile change.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | `pnpm --dir apps/web build` |
| Unit / integration test | `PASS` | Focused change-password `8 passed`; profile regression `6 passed`; Chromium fixture |
| Migration / database | `Chưa áp dụng` | Không đổi backend/schema |
| Health check / live | `Chưa kiểm tra live` | Chưa có runtime và test account được cấp |
| Review thay đổi | `Đã kiểm tra` | Scoped lint, full lint, `git diff --check` pass; warning CRLF chỉ ở Mobile ngoài scope |
| Commit / PR | `Chưa tạo` | Không stage/commit/merge/push theo yêu cầu |

## 3. Mục tiêu và phạm vi

### Mục tiêu

1. Nối form đổi mật khẩu Web với endpoint Identity/Gateway đã tồn tại, không đoán lại contract.
2. Giữ đúng validation, session revocation semantics, error behavior và account-isolation yêu cầu.
3. Bàn giao diff/test evidence cho USER review rồi dừng.

### Ownership trong session

- Được sửa: `apps/web/**`, `docs/superpowers/plans/2026-09-22-web-change-password.md`, `docs/work_logs/2026-09-22-web-change-password.md`.
- Không sửa: `apps/mobile/**`, `packages/shared/**`, backend services, root config/lockfile, Workflow/AI/Bot và thay đổi worker khác.
- `SettingsPage.tsx` và `translations.ts` đã dirty từ các đợt Web trước; chỉ giữ nguyên phần đó và thêm hunk password thuộc đợt này.

### Ngoài phạm vi

- Không thêm forgot/reset password, OAuth, avatar/email/password policy backend, session-management mới hoặc mock-success.
- Không live-test bằng account thật; fixture PASS không được coi là live PASS.
- Không restore/drop/stash/pop/revert/stage/commit/merge/push.

## 4. Bối cảnh và nguồn sự thật

### Contract đã source-confirm

- Identity `ChangePasswordRequest` tại `services/identity-service/src/main/java/com/weav/identity/presentation/http/request/ChangePasswordRequest.java:6-13` chỉ có `currentPassword` và `newPassword`, mỗi field `@NotBlank` và `@Size(min = 8, max = 72)`.
- `AuthInputPolicy.validatePassword` tại `services/identity-service/src/main/java/com/weav/identity/application/validation/AuthInputPolicy.java:50-56` thêm giới hạn tối đa 72 UTF-8 bytes.
- Identity `PasswordController.changePassword` tại `.../PasswordController.java:70-80` yêu cầu bearer JWT/session claim, gọi use case và trả `204` bodyless.
- `ChangePasswordUseCase` tại `.../ChangePasswordUseCase.java:50-79` kiểm tra current password, cập nhật hash trong transaction và gọi `sessionRepository.revokeAllForUser(userId, now)`.
- Real HTTP test `PasswordChangeHttpIntegrationTest` tại `.../PasswordChangeHttpIntegrationTest.java:45-95` xác nhận malformed/Unicode-over-byte-limit `400`, wrong current password generic `401`, success `204`, cả access tokens và refresh tokens hiện hữu đều `401`, old password fail và new password login succeed.
- Gateway README route matrix tại `services/api-gateway/README.md:75-80` ghi `POST /api/auth/change-password` required bearer → Identity. Route `services/api-gateway/src/identity/identity.module.ts:243-251` forward body tới `/auth/change-password`; proxy giữ bodyless `204` tại `.../identity.module.ts`/`IdentityProxyService` lines `120-124`. README lines `116-118` ghi mutating requests không retry và `429` có `Retry-After`.

### Web hiện có trước đợt

- `apps/web/src/api/auth.api.ts:443-448` đã gửi chính xác `POST /api/auth/change-password` với `{ currentPassword, newPassword }` và không retry; file này không cần sửa.
- `SettingsPage` đã có form UI nhưng trước đợt còn client validation thiếu current/max/UTF-8 policy, mock-only fake success và timer logout; các gap đó được khép trong hunk bounded.

## 5. Nhật ký theo session

### Session `13A-web-change-password` - `2026-09-22`

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Sáng | Đọc `AGENTS.md`, `git status`, log profile 11A/12A, plan/log template và source contract | Xác định ownership Web-only; backend đã có endpoint và semantics revoke-all | Xong |
| Sáng | Chạy GitNexus query/upstream impact trước sửa | `SettingsPage`, `authApi`, `useAuthStore` chủ yếu `UNKNOWN`/ambiguous; source call sites đã xác minh; không có HIGH/CRITICAL | Xong |
| Sáng | Viết plan và Playwright tests trước production edit | RED: 7 test cases fail vì form chưa có stable test id/behavior mới | Xong |
| Trưa | Sửa tối thiểu password slice trong `SettingsPage` và VI/EN copy | Exact policy validation, bỏ mock success, ref guard, stale-account guard, clear + logout sau 204 | Xong |
| Trưa | Chạy focused suite và bổ sung confirmation case | GREEN: `8 passed`; payload/error/race/session evidence | Xong |
| Chiều | Chạy scoped lint, build, full lint và profile regression | Tất cả PASS; profile `6 passed`; không chạm file worker khác | Xong |
| Chiều | Diff review, diff check và cập nhật log | Handoff chuẩn bị; live vẫn blocked vì thiếu approved test runtime/account | Xong |

### Diễn giải quan trọng

Identity là authority về session: sau khi đổi thành công, current bearer cũng bị revoke. Web không gọi endpoint revoke-all riêng; chỉ clear local auth qua `useAuthStore.logout()` hiện có sau khi request đổi mật khẩu trả thành công. Logout remote trong store là best-effort theo flow hiện có, không phải một revoke mới do đợt này invent.

Request snapshot gồm `user.id` và access-token snapshot. Success, error và finally chỉ cập nhật state nếu auth store vẫn cùng account/session; response cũ sau logout/account switch bị bỏ qua.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Giữ `authApi.changePassword` nguyên trạng | Method đã gửi đúng Gateway route/body và không retry | Đổi transport/API client | Không tăng blast radius; backend contract là authority |
| Validate cả current/new bằng length + UTF-8 bytes | Khớp `AuthInputPolicy`, không chỉ dựa vào HTML `maxLength` | Chỉ kiểm tra new password hoặc chỉ kiểm tra char count | UI chặn request sai trước HTTP; server vẫn validate lại |
| Bỏ mock-only fake success | User yêu cầu không fake success/mock fallback cho HTTP | Giữ nhánh `isAuthMockMode` cũ | Mock mode sẽ báo transport/auth error thật thay vì giả đổi mật khẩu |
| Clear fields rồi `logout()` ngay sau guarded 204 | Identity revoke current session ngay khi đổi thành công | Giữ timer/giữ token tới khi redirect | Không dùng access token đã bị revoke; AppLayout hiện có điều hướng login |
| Dùng `useRef` in-flight + id/token guard | Chặn duplicate event và late response/account switch | Chỉ dựa vào disabled UI hoặc cập nhật state vô điều kiện | Failure giữ input; account mới không bị logout bởi request cũ |
| Thêm focused fixture spec, không gọi live | Chưa có approved test runtime/account | Dùng account thật hoặc ghi fixture là live | Cần runtime/account test được cấp nếu muốn live gate |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `apps/web/src/pages/SettingsPage.tsx`: thêm `isIdentityPassword`, max length/UTF-8 checks; `autoComplete`/`maxLength` cho password inputs; test IDs cho submit/error/success; in-flight ref; request user/token snapshot; guarded success/error/finally; bỏ mock-success và timer; clear fields + existing logout flow sau `204`.
- `apps/web/src/lib/i18n/translations.ts`: thêm message VI/EN mô tả đúng 8–72 ký tự và ≤72 UTF-8 bytes; giữ lại key `password_min` để không phá consumer cũ.
- `apps/web/e2e/change-password.spec.ts`: fixture-only HTTP UI coverage cho exact payload/204, policy validation, confirmation mismatch, wrong-current `401`, `429`, network failure, duplicate submit và late response sau account switch.

### 7.2. Dữ liệu, schema và migration

- Không có database/schema/migration/seed change.
- Không log hoặc persist password; request assertion trong test chỉ kiểm tra payload trong memory và không ghi credential vào log.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi dependency, root config, lockfile, Vite/Playwright config hoặc Compose.

### 7.4. API, bảo mật và quan sát hệ thống

- Route giữ nguyên `POST /api/auth/change-password`, bearer bắt buộc, request chỉ gồm hai field contract.
- Error transport hiện có chuyển Axios/network errors thành safe `AuthApiError`; UI không hiển thị upstream body. No automatic mutation retry.
- Không thêm runtime logging.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `apps/web/src/pages/SettingsPage.tsx` | Password validation, pending/race guard, clear/logout semantics, test locators | File có hunk profile/session từ đợt trước; review chỉ password hunk của 13A |
| `Sửa` | `apps/web/src/lib/i18n/translations.ts` | VI/EN password policy message | File có thay đổi worker khác; giữ nguyên phần ngoài hunk |
| `Thêm` | `apps/web/e2e/change-password.spec.ts` | HTTP UI fixtures và 8 focused scenarios | Fixture evidence, không phải live backend evidence |
| `Thêm` | `docs/superpowers/plans/2026-09-22-web-change-password.md` | Bounded plan và commands | Plan của đợt 13A |
| `Thêm` | `docs/work_logs/2026-09-22-web-change-password.md` | Source evidence, results và handoff | Focused log của Web worker |

Không có thay đổi chủ ý nào khác trong ownership này.

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| TDD RED | `pnpm --dir apps/web test:e2e -- e2e/change-password.spec.ts --project=chromium --workers=1` trước production edit | `7 failed`, đúng gap test locator/behavior trước sửa | Expected RED; không dùng làm PASS |
| Focused password UI | `pnpm --dir apps/web test:e2e -- e2e/change-password.spec.ts --project=chromium --workers=1` | `8 passed` | Chromium + Playwright route fixtures; không live Gateway/Identity |
| Profile regression | `pnpm --dir apps/web test:e2e -- e2e/profile-integration.spec.ts --project=chromium --workers=1` | `6 passed` | Regression profile/auth UI fixture |
| Scoped lint | `pnpm --dir apps/web exec eslint src/pages/SettingsPage.tsx src/lib/i18n/translations.ts e2e/change-password.spec.ts` | `PASS` | Files thuộc Web change |
| Full Web lint | `pnpm --dir apps/web lint` | `PASS` | Full Web baseline, chạy tuần tự |
| Web build | `pnpm --dir apps/web build` | `PASS`; Vite chỉ báo chunk lớn >500 kB | TypeScript + production bundle |
| Tracked diff check | `git diff --check` | Exit `0`; chỉ cảnh báo CRLF của `apps/mobile/src/app/(app)/workspace/index.tsx` ngoài scope | Không sửa warning ngoài ownership |
| Git status/diff review | `git status --short --branch`, scoped diff review | Branch `api-gateway`; pre-existing Mobile/Web/worker changes preserved; no stage/commit | Shared dirty worktree |

### GitNexus evidence

- `pnpm dlx gitnexus@latest query "web SettingsPage change password authApi session logout"` chạy được và tìm thấy Web `authApi` cùng Identity password-change integration flows.
- `pnpm dlx gitnexus@latest impact "SettingsPage" --direction upstream`: `risk: UNKNOWN`, không resolve caller; đã source-confirm route/import tại `apps/web/src/App.tsx` và các call sites.
- `impact "authApi"` và `impact "useAuthStore"`: `UNKNOWN`/ambiguous do plain-object/module resolution và collision Web/Mobile; đã source-confirm `SettingsPage`, `LoginPage`, store và API call sites.
- `impact "changePassword"` ambiguous giữa Identity/backend test symbols; Web method được source-confirm tại `apps/web/src/api/auth.api.ts:443-448` và được giữ nguyên.
- Fallback `node .gitnexus/run.cjs impact ...` báo LadybugDB version mismatch (`database 42`, runner 40); không coi `UNKNOWN`/zero caller là all-clear. Không có cảnh báo HIGH/CRITICAL cho symbol Web được sửa.

### Điều chưa được kiểm tra

- Chưa chạy Playwright authenticated live qua Gateway/Identity vì session này không có runtime và approved test account. Không dùng tài khoản thật ngoài test và không đổi password live.
- Chưa chạy backend integration suite trong ownership Web-only; backend contract được đối chiếu source và test đã có sẵn, không sửa backend.
- Chưa chạy Firefox/WebKit; focused Chromium là vòng kiểm tra bounded.
- `detect_changes` không chạy vì không commit/stage và request yêu cầu dừng trước integration; coordinator chạy graph gate riêng trước commit nếu cần.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| `Trung bình` | Chưa có live evidence | Không có approved test runtime/account | Ghi rõ fixture-only; không claim live PASS | USER/Astra cung cấp runtime/account nếu cần |
| `Trung bình` | GitNexus local runner không đọc index | LadybugDB version mismatch; current `pnpm dlx` query/impact dùng được nhưng Web edges UNKNOWN | Source-confirm caller/contract; không coi UNKNOWN là safe | Coordinator refresh/index và detect-changes trước commit |
| `Thấp` | Shared worktree dirty | Mobile và nhiều Web worker files đang modified/untracked | Không revert/stash/stage/commit; chỉ sửa ownership | Astra/USER quản lý tích hợp |

### Lỗi có thể tái lập

```text
node .gitnexus/run.cjs impact "handleChangePassword" --direction upstream --repo .
=> LadybugDB unavailable: database file version 42, current runner storage version 40.
```

Đây là giới hạn tooling/index, không phải lỗi source. `pnpm dlx gitnexus@latest` được dùng làm fallback và mọi `UNKNOWN` đều được đối chiếu source.

## 11. Trạng thái bàn giao

### USER review checklist

1. Review password hunk trong `SettingsPage.tsx`: exact payload vẫn ở `auth.api.ts`, validation 8–72 + UTF-8 bytes, no mock success, no timer, no password persistence/logging.
2. Review success semantics: guarded `204` clear fields rồi `useAuthStore.logout()`; current session không bị giữ lại sau Identity revoke-all.
3. Review `passwordRequestInFlight` và user/token snapshot: late success/error không tác động account mới.
4. Review `change-password.spec.ts` để phân biệt fixture evidence với live evidence; hiện chưa có live test.
5. Chạy lại các lệnh ở phần 9 nếu cần; không stage/commit/merge/push trong worker này.

### Handoff exact files

- `apps/web/src/pages/SettingsPage.tsx`
- `apps/web/src/lib/i18n/translations.ts`
- `apps/web/e2e/change-password.spec.ts`
- `docs/superpowers/plans/2026-09-22-web-change-password.md`
- `docs/work_logs/2026-09-22-web-change-password.md`

### Dừng

Đợt 13A Web đã hoàn tất trong ownership và dừng tại handoff. Không tự mở đợt tiếp theo; chờ USER review/`work done` qua Astra.

## 12. Tham chiếu

- `AGENTS.md` và `CLAUDE.md` repository guidance.
- `docs/work_logs/2026-09-22-web-profile-integration.md` (đợt 11A/12A Web trước).
- `services/identity-service/.../ChangePasswordRequest.java`, `AuthInputPolicy.java`, `PasswordController.java`, `ChangePasswordUseCase.java`, `PasswordChangeHttpIntegrationTest.java`.
- `services/api-gateway/README.md`, `src/identity/identity.module.ts`.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22` (Asia/Saigon) |
| Trạng thái worktree | Có thay đổi chưa commit; nhiều thay đổi ngoài scope được giữ nguyên |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Tesla / Luna Max worker` |
| Cần đọc trước khi tiếp tục | Plan 13A, phần 8–11 của log này, prior Web profile log và `git status` |

---

Checklist trước khi đóng log:

- [x] Kết quả và giới hạn live/fixture được phân biệt.
- [x] Contract, session semantics và quyết định có source evidence.
- [x] Exact ownership/files và commands/results đã ghi.
- [x] Rủi ro GitNexus UNKNOWN/tooling và shared worktree đã ghi.
- [x] Không ghi secret, token, password value hoặc connection string.
- [x] Không stage/commit/merge/push.
