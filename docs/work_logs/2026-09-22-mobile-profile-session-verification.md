# Nhật ký làm việc - 2026-09-22

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày / múi giờ | `2026-09-22` / `Asia/Saigon` |
| Repository / branch | `Weav` / `api-gateway` |
| Commit đầu ngày | `7e14de0` |
| Người thực hiện | Luna Max |
| Người review / điều phối | User / Astra |
| Trạng thái | `Hoàn tất kiểm chứng trong scope; native/live blocked` |
| Phạm vi | Khép gap kiểm chứng Mobile profile + auth session persistence/restore |
| Ownership | `apps/mobile` và focused log này; không sửa Web/backend/shared/root config/lock/stash |

## 2. Tóm tắt điều hành

- Đã xác nhận đợt 11B đã có production flow: profile GET/PATCH dùng current-user Gateway alias, `useAuthStore` là source-of-truth, Home/Profile đọc cùng user hiện tại, và query `current-user` được scope theo user.
- Bổ sung chỉ các assertion verification còn thiếu: cold-start dùng profile server mới thay tên cache cũ; hydrate account A không thể publish vào account B sau switch; profile response sau logout bị từ chối.
- Không tái lập được bug production; không sửa production code, auth contract, secure-storage behavior hay dependency.

## 3. Mục tiêu và phạm vi bounded

### Trong phạm vi

- Rà source hiện tại của `apps/mobile/src/features/profile`, auth session coordinator/store, Home/Profile và cache cleanup.
- Bổ sung focused tests cho profile/session integration gap.
- Chạy focused profile/session tests, mobile typecheck và Expo Web export theo manifest.
- Cập nhật bảng gap Mobile Identity/Workspace/Notification/OCR dựa trên evidence hiện có.

### Ngoài phạm vi

- Không thêm feature, auto-refresh, secure-storage redesign, auth contract/backend change hoặc UI refactor.
- Không sửa Web, backend, shared package, root config/lockfile; không restore/pop/drop stash, stage toàn bộ, commit, merge hoặc push.
- Không chạy native/live flow khi thiếu device và approved authenticated test session.

### Acceptance

- [x] Profile save path vẫn cập nhật current-user cache và `useAuthStore`; Home/Profile dùng cùng user source.
- [x] Cold-start/server profile và logout/account-switch stale guards có focused evidence.
- [x] Không có response account A ghi vào account B hoặc resurrect session sau logout.
- [x] Không thay đổi production behavior khi chưa có bug tái lập.
- [x] Work log, diff check và giới hạn runtime được ghi rõ.

## 4. Bằng chứng source và GitNexus

- `apps/mobile/src/features/profile/hooks/useProfile.ts` dùng key `['current-user', userId]`, gọi `authRepository.updateCurrentUser`, kiểm tra `canApplyProfileResponse`, gọi `setUserProfileIfCurrent`, rồi cập nhật query data. Query success 401 gọi `expireAuthSession`; mutation không retry.
- `apps/mobile/src/stores/auth.store.ts` chỉ cập nhật user khi account hiện tại, `isAuthenticated` và response ID khớp; không thay tokens.
- `apps/mobile/src/app/(app)/(tabs)/index.tsx` và `profile.tsx` cùng đọc `useAuthStore`, nên profile mutation thành công được phản ánh ở Home/Profile qua một source-of-truth.
- `apps/mobile/src/features/auth/useAuthSession.ts` cleanup account-scoped query gồm `current-user` khi logout/đổi account.
- Graph-first query: `pnpm dlx gitnexus@latest query "mobile profile update current user session restore logout account switch" --repo . --limit 16` nhận diện flow Identity `UpdateCurrentUser`.
- Upstream impact với `createAuthSessionCoordinator`, `canApplyProfileResponse`, `mapIdentityUser` đều trả `risk: UNKNOWN` / target chưa được index resolve. Đã xác minh UNKNOWN bằng source và `rg`: coordinator được runtime dùng; profile guard được `useProfile` dùng; mapper được HTTP repository và contract test dùng. Không coi empty/UNKNOWN caller set là an toàn.
- Index/runner cũ vẫn có version mismatch DB/runner như log đợt 11B; latest CLI được dùng cho query/impact. Không có HIGH/CRITICAL mobile impact đáng tin cậy phát sinh từ thay đổi test-only này.

## 5. Thay đổi trong đợt 12B

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa test hiện hữu của đợt 11B | `apps/mobile/src/features/auth/auth-session.coordinator.test.cjs` | Thêm cold-start profile freshness và account-switch late-hydrate isolation. |
| Sửa test hiện hữu của đợt 11B | `apps/mobile/src/features/profile/profile.utils.test.cjs` | Thêm assertion response không được apply sau logout. |
| Thêm | `docs/work_logs/2026-09-22-mobile-profile-session-verification.md` | Focused handoff, evidence và bảng gap Mobile. |

Không có production source, Web, backend, shared, root config/lockfile hoặc stash nào bị sửa.

## 6. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| Focused profile/session | `node --test apps/mobile/src/features/auth/auth-session.coordinator.test.cjs apps/mobile/src/features/profile/profile.utils.test.cjs apps/mobile/src/infrastructure/http/profile.http.contract.test.cjs` | `17/17 PASS` | Node CJS state/contract harness; chưa phải native/live UI. |
| Mobile typecheck | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` | `PASS` | Compile only. |
| Expo Web export | `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <TEMP>/weav-mobile-profile-session-verification-export --no-minify` | `PASS`, 40 static routes | Export/bundle, không chứng minh authenticated Gateway flow. `.env` chỉ được Expo load theo config hiện có; không ghi giá trị. |
| Native availability | `adb devices` | ADB có sẵn nhưng không có device | Chưa có native harness/device được phép. |
| E2E harness availability | `rg --files apps/mobile | Select-String -Pattern 'playwright|detox|maestro|e2e'` | Không tìm thấy harness mobile tương ứng | Không tự thêm tooling/dependency. |
| Live runtime | Kiểm tra listener các port `3000,5173,8081-8085` | Không có listener trong lần kiểm tra này; không có approved test session | Không thực hiện live authenticated request/upload/profile mutation. |
| Diff check | `git diff --check` và focused untracked-file `git diff --no-index --check` | Không có whitespace error; chỉ có cảnh báo CRLF/LF của Git | Worktree vẫn dirty bởi nhiều đợt/concurrent change ngoài scope. |

### Phân biệt evidence

- `17/17`, typecheck và Expo export là fixture/state/compile/export evidence.
- Không có native evidence và không có live authenticated evidence trong đợt này.
- Không chạy lại full mobile suite hay suite Web/backend không liên quan.

## 7. Bảng gap Mobile hiện tại

| Capability | Implemented theo source/log | Đã verify trong evidence | Còn lại / giới hạn |
| --- | --- | --- | --- |
| Identity + profile/session | HTTP current-user GET/PATCH, auth lifecycle và native SecureStore refresh material đã nối | Profile contract/session state `17/17`, typecheck, Expo export; source xác nhận Home/Profile đồng bộ user | Chưa có native device và live Identity/Gateway account proof; lint baseline thiếu config theo log 11B |
| Workspace | List/detail/switch/create/rename/members read đã có trong mobile | Các focused harness/typecheck/export tương ứng ở các log trước | Chưa có native/live authenticated proof trong workspace test context |
| Notification | HTTP list/pagination/unread/read paths đã có theo log đợt 4 | Focused contract/query evidence và mobile compile/export ở log trước | Chưa có live Notification account proof; push/realtime ngoài scope |
| OCR | Chưa triển khai mobile OCR integration | Không có evidence mobile OCR | Còn toàn bộ mobile OCR; không mở trong 12B |

## 8. Rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng / xử lý |
| --- | --- | --- |
| Cao | Native/live profile-session chưa được chứng minh | Không có ADB device, mobile E2E harness hoặc approved authenticated test session; chỉ claim fixture/compile/export. |
| Trung bình | GitNexus không resolve ba symbol mobile | `risk: UNKNOWN`; đã xác minh callers bằng source, không dùng UNKNOWN làm all-clear. |
| Thấp | Mobile lint baseline thiếu config | Giữ nguyên limitation của đợt 11B; không cài tooling hoặc sửa lockfile. |

## 9. Checklist user review / bàn giao

1. Review hai test bổ sung trong `auth-session.coordinator.test.cjs` và `profile.utils.test.cjs`.
2. Review `useProfile.ts`, `auth.store.ts`, Home/Profile để xác nhận một source-of-truth và user-scoped current-user cache.
3. Tái chạy focused command, typecheck và Expo export khi review nếu cần.
4. Nếu cần live/native sign-off, cung cấp device/native harness và approved test account/session; không dùng dữ liệu người dùng thật không liên quan.
5. Giữ nguyên các thay đổi Web/mobile khác, examples untracked và hai stash; lane này không stage/commit/merge/push.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22` / `Asia/Saigon` |
| Worktree | Dirty với thay đổi trước/concurrent; chỉ hai test mobile và log này thuộc 12B. |
| Commit/PR | `Chưa tạo` |
| Người cập nhật | Luna Max |
| Tiếp theo | User review; chờ `work done`, không tự mở task khác. |
