# Nhật ký làm việc - 2026-09-22

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `api-gateway` / `7e14de0` |
| Người thực hiện | `Luna Max` |
| Người review / nhận bàn giao | `Người dùng / Astra` |
| Trạng thái cuối ngày | `Hoàn thành trong phạm vi; live/full-lint còn blocker` |
| Phạm vi session | Web Notification list/cursor/unread/read/delivery verification và bounded fixes |
| Liên kết liên quan | Batch 6 Web OCR; Gateway Notification proxy; Notification service HTTP contract |

## 2. Tóm tắt điều hành

### Kết quả chính

- Đã xác minh bằng UI/network fixture list + cursor, unread count, read-one/read-all, delivery status, lỗi 429/503, retry và account-switch late response.
- RED chứng minh hai gap: query chạy trước khi Identity trả user gây request `anonymous` che lỗi 429; double-click read-one tạo hai PATCH. Đã sửa tối thiểu và GREEN 5/5.
- Giữ nguyên mobile/Web OCR và stash/untracked cũ; không mở rộng push/realtime, notification creation, backend domain, Workflow/AI/Bot.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | `pnpm --dir apps/web build`; chỉ cảnh báo bundle >500 kB |
| Unit / integration test | `PASS` trong fixture | Notification 5/5; Workspace/OCR regression 27/27; Gateway route suite 7/7 |
| Runtime/live | `BLOCKED` | Ports 3000/5173/8000 đều `False`, Compose không có service |
| Review thay đổi | `PASS` bounded | Focused ESLint + `git diff --check` PASS; full lint còn baseline SettingsPage |
| Commit / PR | Chưa tạo | Không commit/merge/push trong đợt này |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Xác minh Web Notification dùng đúng Gateway routes, query cursor, response mapping và auth transport theo source thật.
2. Kiểm tra UI list/pagination/unread count/read-one/read-all, lỗi/retry, pending/double-submit và account/logout isolation.
3. Sửa tối thiểu các bug có bằng chứng; không refactor phần đang đúng.

### Trong phạm vi

- `apps/web/src/api/notification.api.ts`, `apps/web/src/hooks/useNotifications.ts`, `apps/web/src/pages/NotificationsPage.tsx`, `apps/web/src/components/layout/Topbar.tsx` nếu test chứng minh cần.
- Playwright fixture test trong `apps/web/e2e` và work log này.
- Regression workspace/OCR chỉ khi thay đổi shared auth/query ảnh hưởng trực tiếp.

### Ngoài phạm vi / chủ động chưa làm

- Không triển khai push/realtime, tạo notification, mobile, Workflow/AI/Bot hoặc backend contract/domain.
- Không fallback HTTP sang mock; mock chỉ chạy khi `VITE_API_MODE=mock`.
- Không restore/pop/drop stash, reset, stage-all, commit, merge hoặc push; không dùng dữ liệu thật không liên quan.

### Tiêu chí hoàn thành

- [x] Fixture UI/network chứng minh list + cursor, refresh, dedupe, empty/error/retry và auth header.
- [x] Fixture chứng minh read-one/read-all/count consistency, pending/double-click và lỗi không success giả.
- [x] Fixture chứng minh user/logout late-response isolation; query không chạy trước khi user identity sẵn sàng.
- [x] Build, focused lint/test, `git diff --check` và live/fixture limitations được ghi rõ.
- [x] Bảng trạng thái Identity/Workspace/Notification/OCR Web/Mobile được cập nhật tại handoff.

## 4. Contract/source findings

- Gateway controller [`services/api-gateway/src/notifications/notifications.module.ts`] có protected canonical routes `/api/v1/notifications`, `/api/v1/notifications/unread-count`, `PATCH /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`; alias `/api/notifications` cũng được proxy và giữ backward compatibility.
- Notification controller [`services/notification-service/src/presentation/http.ts`] xác nhận list `limit` 1..100, opaque `cursor`, `unreadOnly=true|false`, exact `eventType`/`status`, response `{items,nextCursor}`; unread `{count}`; read-one `{item}`; read-all `{updatedCount}`.
- Notification README xác nhận ordering newest `createdAt,id`, read operations idempotent, foreign/missing IDs 404, lỗi envelope an toàn; Gateway có thể trả 429/503 và `Retry-After`.
- Web dùng Axios HTTP khi không explicit mock, bearer token từ `weav_token`, và không fallback mock khi request lỗi. Alias `/api/notifications` hiện là route hợp lệ của Gateway; không đổi sang route mới chỉ để tạo diff.
- `NotificationItem` mapping hiển thị `SENT` thành delivery status `Delivered`; fixture kiểm tra notification thật qua UI, không chỉ gọi helper.

## 5. GitNexus pre-edit impact

- Đã chạy `pnpm dlx gitnexus@latest query` cho flow Web Notification và `impact --direction upstream` cho `notificationApi`, `useNotifications`, `useNotificationUnreadCount`, `NotificationsPage`, `Topbar`.
- Kết quả phần lớn `risk: UNKNOWN`/collision do index có symbol trùng với `apps/mobile` và thư mục `examples/3dviz-pro-max`; UNKNOWN không được coi là unused.
- Một kết quả `CRITICAL` cho `Topbar` là false collision ngoài Weav Web; chạy lại theo file cho symbol Web vẫn `UNKNOWN`, source xác minh `AppLayout` gọi `Topbar`, `Topbar` gọi unread hook.
- Source verification callers: `App.tsx` route `NotificationsPage`; `NotificationsPage` gọi list/count/read mutations; `Topbar` gọi unread count; hook gọi `notificationApi`. Không có HIGH/CRITICAL impact đáng tin cậy trong Web source, nhưng `Topbar`/shared hook là boundary rủi ro cao nếu sửa.

## 6. Bounded TDD plan

### RED

1. Thêm `apps/web/e2e/notification-integration.spec.ts` với controlled Gateway fixtures đi qua `/notifications`: route/auth/query/response mapping, cursor pages, empty/error/retry, read-one/read-all/count, duplicate mutation, late response sau logout/account switch.
2. Chạy focused Chromium fixture trước production edit; ghi fail đúng theo acceptance, không coi lỗi harness/live là product failure.

### GREEN

1. Sửa nhỏ nhất trong API/hook/page nếu RED chứng minh: canonical route/contract mapping, mutation pending/invalidation, account query lifecycle hoặc stale response guard.
2. Giữ mock explicit, `retry: false` cho mutation, không thêm cache/store thứ hai và không thay đổi backend.

### VERIFY

- Commands lấy từ `apps/web/package.json`: `test:e2e`, `build`, `lint`; focused eslint chỉ cho file đợt 7 nếu full lint còn baseline ngoài scope.
- Chạy focused E2E trước, regression Workspace/OCR nếu shared code đổi, sau đó build/lint/diff-check; live authenticated browser chỉ khi Gateway + Identity + Notification + approved test account sẵn sàng.

## 7. Nhật ký session

### Session 1 - Khảo sát contract/graph và chuẩn bị TDD

| Việc đã thực hiện | Kết quả | Trạng thái |
| --- | --- | --- |
| Đọc status/AGENTS/Batch 6 log | Worktree dirty với thay đổi các đợt trước; hai stash giữ nguyên | Xong |
| Đọc Gateway/Notification source | Route, query, response và error contract đã xác nhận | Xong |
| GitNexus query/context/impact | UNKNOWN/collision đã source-verify; không dùng false CRITICAL ngoài scope | Xong |
| Viết bounded plan | Chỉ Web Notification integration verification + bounded fixes | Xong |

### Session 2 - RED, bounded fixes và verification

| Việc đã thực hiện | Kết quả | Trạng thái |
| --- | --- | --- |
| RED Playwright | `3` lỗi có ý nghĩa: read-one `2` PATCH; 429 bị query anonymous/user overwrite; locator login thiếu association | Xong |
| Sửa query/auth lifecycle | Chỉ enable HTTP notification query khi có `userId`; dọn query theo user tại `AppLayout` khi logout/đổi user | Xong |
| Sửa mutation lifecycle | Ref gate UI chống double-submit; lỗi mutation invalidate lại list/count; vẫn `retry: false` | Xong |
| GREEN focused Notification | Chromium fixture `5/5 PASS` | Xong |
| Regression shared Web | Workspace + OCR `27/27 PASS` | Xong |
| Build/lint/contract | Build PASS; focused ESLint PASS; Gateway notification suite `7/7 PASS`; full lint baseline fail ngoài scope | Xong |
| Runtime/status/log | Live prerequisites thiếu; status 50 entries, 24 tracked modified, 26 untracked, 0 staged; stash untouched | Xong |

## 8. Thay đổi đã thực hiện

- `apps/web/src/hooks/useNotifications.ts`: không request khi chưa có `userId`; thêm `notificationKeys` và cleanup query theo account/logout; invalidate list/count cả khi mutation lỗi, giữ mutation `retry: false`.
- `apps/web/src/pages/NotificationsPage.tsx`: ref gate chống hai read mutation đồng thời trước khi React kịp render trạng thái disabled.
- `apps/web/src/components/layout/AppLayout.tsx`: gọi notification session cleanup cạnh cleanup Workspace hiện có; các thay đổi Workspace cũ trong file được giữ nguyên.
- `apps/web/e2e/notification-integration.spec.ts`: fixture UI/network cho cursor, refresh/dedupe, delivery status, read-one/read-all/count, 429/503 retry, duplicate click và account-switch late response.
- `apps/web/src/api/notification.api.ts`: chỉ đọc/kiểm chứng, không cần sửa vì routes, auth, mapping và mock boundary hiện đúng source contract.
- `docs/work_logs/2026-09-22-web-notification-integration.md`: plan, bằng chứng và handoff.

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| RED | `$env:CI='1'; pnpm --dir apps/web test:e2e -- notification-integration.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` trước sửa | `2 passed, 3 failed`: duplicate read `2` calls; 429/error overwritten by anonymous query; account test locator không tìm label | Đây là RED có kiểm soát; locator được sửa trong test, hai lỗi đầu là production gaps |
| Focused Notification E2E | Cùng command sau sửa | `5 passed` | Chromium controlled HTTP fixture + UI, không phải live |
| Workspace/OCR regression | `$env:CI='1'; pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` | `27 passed` | Web fixture regression, không phải live Gateway |
| Build | `pnpm --dir apps/web build` | `PASS`; Vite cảnh báo bundle JS `>500 kB` | Không phải compile failure |
| Focused lint | `pnpm --dir apps/web exec eslint src/hooks/useNotifications.ts src/pages/NotificationsPage.tsx src/components/layout/AppLayout.tsx e2e/notification-integration.spec.ts` | `PASS` | Chỉ file đợt 7 |
| Full lint | `pnpm --dir apps/web lint` | `FAIL baseline ngoài scope`: `SettingsPage.tsx:76,82` errors `react-hooks/set-state-in-effect`, line 106 warning thiếu `t` | Không sửa SettingsPage |
| Gateway contract | `pnpm --dir services/api-gateway test -- --runInBand src/notifications/notifications.module.spec.ts` | `1 suite, 7 tests PASS`; log ERROR upstream failure là case sanitize đã test | Gateway fixture, không phải live Notification DB |
| Runtime read-only | `Test-NetConnection localhost -Port 3000/5173/8000`; `docker compose ps` | Cả ba port `False`; Compose chỉ có header, không có service | Chưa có Gateway/Identity/Notification/approved account |
| Diff/status | `git diff --check`; `git status --short`; `git stash list --date=local` | Diff check PASS, chỉ CRLF warning cũ; `50` entries = `24` tracked modified + `26` untracked, `0` staged; hai stash không đổi | Không stage/commit/merge/push |

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Dấu hiệu | Xử lý hiện tại |
| --- | --- | --- | --- |
| Trung bình | GitNexus index có collision với thư mục example/mobile | Impact theo tên symbol có kết quả ngoài scope/UNKNOWN | Đã dùng file disambiguation và source search; không sửa dựa trên UNKNOWN trống |
| Chưa xác định | Live Gateway/Identity/Notification và approved account | Chưa kiểm tra runtime ở phase plan | Kiểm tra read-only sau fixture; nếu thiếu ghi prerequisites cụ thể |
| Thấp | Full lint có baseline `SettingsPage` từ Batch 6 | Đã ghi trong Batch 6 log | Không sửa file ngoài scope; chạy focused lint |
| Trung bình | Chưa có live authenticated browser proof | Gateway/Identity/Notification không chạy và chưa có approved test account | Không seed dữ liệu; fixture PASS không được gọi là live PASS |

## 11. Trạng thái bàn giao

### Files thuộc đợt 7

- Sửa: `apps/web/src/hooks/useNotifications.ts`, `apps/web/src/pages/NotificationsPage.tsx`.
- Sửa có phần thay đổi cũ cần giữ: `apps/web/src/components/layout/AppLayout.tsx` (đợt 7 thêm notification cleanup; workspace cleanup đã có từ trước).
- Thêm: `apps/web/e2e/notification-integration.spec.ts`, file log này.
- Chỉ đọc, không sửa: `apps/web/src/api/notification.api.ts`, Gateway/Notification controller/service.

### Fixture/live evidence

- Fixture: `5/5` notification E2E và `27/27` Workspace/OCR regression đi qua UI thật + intercepted HTTP route, kiểm tra method/path/query/headers/response và UI state.
- Live: `BLOCKED`. Cần chạy Gateway + Identity + Notification đúng config và approved test account có notification test; không dùng notification production của người dùng, không bật JWT bypass.
- Native/mobile: không thuộc đợt 7; xem Batch 4/5 logs, không suy live/native PASS từ fixture Web.

### Bảng capability để chọn gap đợt sau

| Capability | Web | Mobile | Còn lại có bằng chứng |
| --- | --- | --- | --- |
| Identity/auth lifecycle | Đã nối; fixture auth me/login/logout trong Web E2E; live chưa verify | Đã có shared HTTP/auth lifecycle theo Batch 4/5; tsc/export/contract fixture; native/live chưa verify | Approved runtime + session live cho cả client |
| Workspace list/switch/create/rename | Đã nối; fixture/regression đã verify; live chưa verify | Đã nối list/switch/members/create/rename; Node/tsc/export/Gateway fixture; native/live chưa verify | Live Gateway/Identity/Workspace và native proof |
| Notification list/cursor/unread/read/delivery | Đã nối; đợt 7 fixture `5/5`, Gateway route suite `7/7`; live chưa verify | Đã nối theo Batch 4; focused tests/tsc/export/Gateway/Notification fixture; native/live chưa verify | Live Gateway/Identity/Notification + approved test notification; push/realtime ngoài scope |
| OCR workspace-scoped | Đã nối; Batch 6 fixture `13/13`, regression đợt 7 giữ PASS; live chưa verify | Chưa triển khai, ngoài các đợt hiện tại | Live Gateway/Workspace/OCR; mobile OCR chưa làm |

### Checklist user review

1. Review `useNotifications.ts`: query chỉ chạy sau user identity, query cache bị remove khi logout/đổi user, mutation error invalidate và không auto-retry.
2. Review `NotificationsPage.tsx`: ref gate chỉ bảo vệ UI mutation, không tạo store/cache mới; kiểm tra `read-one`/`read-all` lỗi vẫn giữ UI không success giả.
3. Review `notification-integration.spec.ts`: fixture đi qua UI và network interception; phân biệt `5/5` fixture với live blocker.
4. Review `AppLayout.tsx` cẩn thận vì file đã có Workspace cleanup từ đợt trước; chỉ phần notification import/call thuộc đợt 7.
5. Khi runtime sẵn sàng, chạy live authenticated Notification bằng test notification được phê duyệt rồi cập nhật log; không tự mở đợt 8.

## 12. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 01:56 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; `50` entries (`24` tracked modified, `26` untracked), `0` staged; giữ nguyên thay đổi cũ/untracked/stash |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | `Luna Max` |
| Cần đọc trước khi tiếp tục | Mục 11 files/evidence/capability table, root `AGENTS.md`, Batch 6 log, Gateway/Notification contract; chờ user review và `work done` |
