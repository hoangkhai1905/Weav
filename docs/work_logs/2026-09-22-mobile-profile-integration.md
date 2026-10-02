# Nhật ký làm việc - 2026-09-22

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày / múi giờ | `2026-09-22` / `Asia/Saigon` |
| Repository / branch | `Weav` / `api-gateway` |
| Commit đầu ngày | `7e14de0` |
| Người thực hiện | Luna Max |
| Người review / điều phối | User / Astra |
| Trạng thái | `Hoàn thành trong scope; live/native blocked` |
| Phạm vi | Mobile xem/sửa `displayName` qua Identity/Gateway hiện có |
| Plan | `docs/superpowers/plans/2026-09-22-mobile-profile-integration.md` |

## 2. Tóm tắt điều hành

- Đã nối Mobile profile HTTP với `GET/PATCH /api/auth/me`, là alias Gateway hiện hữu proxy tới Identity `/users/me`.
- Chỉ cho phép chỉnh `displayName` theo contract; email, password, avatar, role/status, ID và token không bị thay đổi.
- Profile query/mutation dùng user-scoped key, retry mutation tắt, chống double submit và bỏ qua response sau logout/đổi account; kết quả hợp lệ cập nhật cùng `useAuthStore` mà Home/Profile đang dùng.
- Không thêm profile persistence: native SecureStore hiện chỉ lưu refresh token từ đợt 8; Expo Web/HTTP không lưu token/profile mới.

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- `apps/mobile` và hai tài liệu plan/work log mobile-profile.
- HTTP repository, explicit mock parity, auth store guard, current-user query cleanup và Profile tab UI.

### Ngoài phạm vi / chưa làm

- Không sửa Web, shared packages, backend, root config/lockfile; không làm avatar upload, email/password/OAuth, Workflow/AI/Bot.
- Không thêm secure-session redesign, native E2E tooling, live account/test data hay commit/merge/push.

### Tiêu chí hoàn thành

- [x] GET/PATCH route/body/response mapping source-grounded.
- [x] Display-name validation, loading/error/retry, pending/double-submit và stale-account guards.
- [x] Focused/full mobile harness, typecheck, Expo Web export và diff check đã chạy.
- [x] Live/native evidence và giới hạn được tách riêng trong log.

## 4. Contract và quyết định kỹ thuật

| Nguồn | Bằng chứng áp dụng |
| --- | --- |
| `packages/contracts/http/auth/openapi.yaml` `/users/me` | GET trả `UserResponse`; PATCH chỉ nhận object bắt buộc `displayName`, tối đa 120 ký tự; null/blank clear; không nhận email, avatar keys, role, status, identifiers, timestamps. |
| `services/api-gateway/src/identity/identity.module.ts` `IdentityAuthProxyController` | `GET/PATCH /api/auth/me` forward tới Identity `/users/me`, auth required. |
| Cùng file `IdentityUsersProxyController` | `GET/PATCH /api/users/me` là alias thứ hai; Mobile giữ alias `/api/auth/me` đang có trong repository để không tạo route mới. |
| `services/identity-service/.../UserController.java` + `UpdateProfileRequest.java` | JWT subject/session quyết định user; PATCH phân biệt field thiếu với JSON null; backend là authority. |

Quyết định: `useAuthStore` vẫn là source-of-truth cho current user; React Query chỉ giữ GET cache `['current-user', userId]` và bị cleanup khi signed out/đổi account. PATCH thành công chỉ gọi `setUserProfileIfCurrent`, không chạm `tokens`.

## 5. GitNexus / impact trước sửa

- `pnpm dlx gitnexus@latest query "mobile profile current user update displayName auth store session" --repo . --limit 12` chạy được, nhận diện flow `UpdateCurrentUser` của Identity.
- Runner nội bộ `node .gitnexus/run.cjs` lỗi storage version mismatch (DB v42, runner v40); không dùng kết quả UNKNOWN của runner cũ làm all-clear.
- Latest CLI: `AuthRepository` `MEDIUM`, `UserProfile` `MEDIUM`, `AuthState` `MEDIUM`, `HttpAuthRepository` `LOW` nhưng lower-bound do interface dispatch. `ProfileScreen` trả `HIGH` nhưng target symbol bị index nhiễu trỏ sang file 3dviz ngoài repo; source xác nhận screen thật chỉ được Expo Router tab layout tham chiếu. Không có HIGH/CRITICAL mobile symbol đáng tin cậy để bỏ qua; cảnh báo HIGH nhiễu được giữ trong handoff.
- `setAuthSession`, `useAuthStore`, `getCurrentUser`, `mapUser` có candidate `UNKNOWN`/ambiguous; đã xác minh bằng source/`rg` rằng chúng được gọi từ auth runtime, login/register, Home/Profile, workspace và notification hooks.
- `isAccountScopedQuery` không được latest index resolve; source xác nhận đây là local predicate chỉ được `useAuthSessionCacheCleanup` dùng, và thay đổi chỉ bổ sung key `current-user` vào cùng predicate.

## 6. Thay đổi trong đợt 11B

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `apps/mobile/src/domain/auth/auth.types.ts` | Thêm `updateCurrentUser(displayName)` vào interface hiện hữu. Các thay đổi session khác trong file là baseline đợt 8. |
| Sửa | `apps/mobile/src/infrastructure/http/http-auth.repository.ts` | Dùng profile contract mapper; thêm PATCH `/api/auth/me`, profile error mapping; giữ GET alias và token/session flow. |
| Thêm | `apps/mobile/src/infrastructure/http/profile.http.contract.ts` | Route builders và `IdentityUserResponse` → `UserProfile` mapping. |
| Thêm | `apps/mobile/src/infrastructure/http/profile.http.contract.test.cjs` | Route/body/response mapping tests. |
| Sửa | `apps/mobile/src/infrastructure/mock/mock-auth.repository.ts` | Explicit mock parity cho update profile; HTTP không fallback mock. |
| Sửa | `apps/mobile/src/stores/auth.store.ts` | `setUserProfileIfCurrent` kiểm tra account và không thay token. Các auth-session fields khác là baseline đợt 8. |
| Sửa | `apps/mobile/src/features/auth/useAuthSession.ts` | Cleanup thêm query key `current-user` theo user/account lifecycle. |
| Thêm | `apps/mobile/src/features/profile/profile.utils.ts` | Normalize/validate display name, submission gate, stale-scope predicate. |
| Thêm | `apps/mobile/src/features/profile/profile.utils.test.cjs` | Validation, duplicate submit và logout/account-switch guard tests. |
| Thêm | `apps/mobile/src/features/profile/hooks/useProfile.ts` | User-scoped GET/PATCH hook, inline error/pending/retry, no retry mutation, late-response guard. |
| Sửa | `apps/mobile/src/app/(app)/(tabs)/profile.tsx` | Form display name, loading/error/retry/success states; bỏ fallback demo profile trong HTTP. |

Các file mobile khác đang dirty, các file Web đang dirty/untracked và hai stash là thay đổi trước/concurrent ngoài scope; không restore/pop/drop/stage/commit.

## 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| TDD RED | `node --test` hai focused files trước helper | Fail vì helper/contract chưa tồn tại | Expected RED. |
| Focused profile | `node --test apps/mobile/src/features/profile/profile.utils.test.cjs apps/mobile/src/infrastructure/http/profile.http.contract.test.cjs` | `7/7 PASS` | Pure contract/state; harness không import trực tiếp repository TS graph. |
| Auth/session regression | Focused auth coordinator + shared HTTP client + profile contract | `16/16 PASS` | Không phải native/live UI. |
| Full mobile harness | `$testFiles = rg --files apps/mobile/src | Where-Object { $_ -like '*.test.cjs' }; node --test $testFiles` | `42/42 PASS` | Node CJS contract/state tests. |
| Typecheck | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` | `PASS` | TypeScript compile. |
| Expo Web export | `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <TEMP>/weav-mobile-profile-export --no-minify` | `PASS`, 40 static routes | Bundle/export, không phải browser/live proof. |
| Lint | `pnpm --dir apps/mobile lint` | `BLOCKED`: thiếu ESLint config; Expo auto-install đã bị loại khỏi package, config và lockfile | Không cài tooling/sửa baseline. |
| Runtime | Kiểm tra ports `3000,5173,8081–8085`, `adb devices`, harness commands | Gateway/service ports 3000 và 8081–8083 listen; 5173 down; ADB không có device; không có Playwright/Detox/Maestro | Không có approved authenticated test session; không chạy live/native. |
| Diff | `git diff --check` giới hạn các path mobile-profile/plan/log | PASS; chỉ warning CRLF→LF baseline ở mobile workspace file khác scope | Không kết luận toàn worktree sạch. |

Một thử nghiệm CJS import trực tiếp `HttpAuthRepository` bị harness từ chối vì Node không resolve import TS extensionless (`http-client`) và manifest không có `tsx`/Jest/Vitest; test đó không được giữ lại, không thêm dependency. Contract builders được tách pure để vẫn kiểm chứng route/body/mapping bằng harness hiện có.

## 8. Rủi ro và blocker

| Mức độ | Vấn đề | Xử lý / bước tiếp theo |
| --- | --- | --- |
| Cao | Chưa có native/live authenticated proof; không có device, Playwright/Detox/Maestro và approved test account/session | User cung cấp runtime + account/workspace test được phép trước khi claim live. |
| Trung bình | Mobile lint baseline thiếu config; lệnh lint tự thêm ESLint/config | Đã khôi phục package/lockfile và xóa config auto-generated; không claim lint PASS. |
| Thấp | GitNexus index có symbol collision/nhiễu ngoài repo | Đã dùng CLI latest, file disambiguation và source confirmation; chưa commit nên không cần detect-changes. |

## 9. Trạng thái bàn giao / checklist user review

1. Review contract route/body ở `profile.http.contract.ts` và `http-auth.repository.ts`.
2. Review `useProfile.ts`: `['current-user', userId]`, `retry:false`, `setUserProfileIfCurrent`, 401 expiry và stale account guard.
3. Review `profile.tsx`: chỉ `displayName`, input preservation khi lỗi, disabled pending và không còn demo fallback trong HTTP.
4. Khi có device/test session, chạy native/Expo Web authenticated profile GET/PATCH bằng test profile được phép; tách kết quả live khỏi `42/42` fixture/state PASS.
5. Kiểm tra riêng các file Web/concurrent đang dirty; lane này không chạm chúng.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 11:42 Asia/Saigon` |
| Worktree | Dirty với thay đổi trước/concurrent; files đợt 11B mobile-profile được liệt kê ở mục 6; stash giữ nguyên. |
| Commit/PR | `Chưa tạo` |
| Người cập nhật | Luna Max |
| Tiếp theo | User review diff; chờ `work done`, không tự mở đợt sau. |
