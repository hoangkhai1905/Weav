# Nhật ký ngày `2026-09-22`

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `api-gateway` / `7e14de0` |
| Người thực hiện | `Hubble / Luna Max` |
| Người review / nhận bàn giao | `User qua Astra` |
| Trạng thái cuối ngày | `Hoàn tất bounded closure; live/native chưa xác minh` |
| Phạm vi session | Khép integration Mobile Identity/Workspace/Notification/OCR đã nối; recheck và sửa conditional P1 error envelope. |
| Liên kết liên quan | `docs/work_logs/2026-09-22-fe-integration-coverage-audit.md`, bàn giao Mobile đợt 15 |

## 2. Tóm tắt điều hành

### Kết quả chính

- Đối chiếu Gateway-generated error với downstream Identity/Workspace/Notification source và OpenAPI: Mobile trước đó đọc top-level `data.code/message`, trong khi Gateway-generated và Identity/Notification dùng nested `error`; Workspace downstream dùng top-level `code/message/requestId`.
- Sửa `normalizeApiError` để giữ `code`, `message`, `details`, HTTP `status` và `requestId` từ body hoặc request-id headers, không dùng `any`/type assertion để che mismatch.
- Workspace và Notification repository không còn thay envelope bằng lỗi generic/401 giả; vẫn giữ auth-session expiry side effect và không giữ raw Axios response.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Mobile `tsc --noEmit`; Expo Web export 42 routes |
| Unit / integration test | `PASS` | Focused Node harness `62/62` |
| Migration / database | `Chưa áp dụng` | Không sửa backend/database |
| Health / live check | `Chưa xác minh` | Không có approved Gateway/Identity runtime/account; cổng 8081 có Python process sẵn, không đụng |
| Review thay đổi | `Đã kiểm tra` | GitNexus upstream impact, source confirmation, diff check cuối session |
| Commit / PR | `Chưa tạo` | Không stage/commit/merge/push |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Đọc audit, AGENTS, status và bàn giao Mobile gần nhất trước khi sửa.
2. Tái lập conditional P1 error envelope trước sửa, xác minh Gateway-generated và downstream shapes bằng source.
3. Kiểm chứng regression auth/session restore → Workspace selection/members → Notification → logout/account switch và recovery/profile/password/session.

### Trong phạm vi

- `apps/mobile/src/infrastructure/http/http-client.ts`
- `apps/mobile/src/infrastructure/http/http-workspace.repository.ts`
- `apps/mobile/src/infrastructure/http/http-notification.repository.ts`
- `apps/mobile/src/domain/common/error.types.ts`
- Focused error-envelope test và log này.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa Web, backend, shared package, root config/lockfile, Connections/Erdos, Workflow, AI, Bot, OCR Mobile hoặc OAuth migration.
- Không restore/pop/drop stash, không stage toàn bộ, commit, merge hoặc push.
- Không bật bypass auth, seed production, migration, gửi notification, đổi password hoặc thao tác account thật.

### Tiêu chí hoàn thành

- [x] Gateway và downstream error envelopes được đối chiếu bằng source; HIGH/CRITICAL được rà soát và UNKNOWN được source-confirm.
- [x] Regression helper test bao phủ nested Gateway, top-level Workspace và request-id header downstream.
- [x] Mobile focused tests, typecheck, Expo Web export và diff check có kết quả thực.
- [x] Fixture/source evidence tách khỏi live/native evidence; blocker runtime ghi rõ.

## 4. Bối cảnh và nguồn sự thật

- **Audit:** `docs/work_logs/2026-09-22-fe-integration-coverage-audit.md` ghi conditional P1 tại `normalizeApiError`, chưa sửa trước khi Hubble re-audit.
- **Gateway-generated:** `services/api-gateway/src/common/gateway-exception.filter.ts` trả `{ error: { code, message, details }, requestId }` và HTTP status; proxy fail paths cũng trả nested `error` cùng requestId.
- **Downstream Workspace:** `services/workspace-service/.../ApiErrorResponse.java` và `GlobalExceptionHandler.java` trả `{ code, message, requestId }`; Gateway Workspace proxy forward body và giữ request-id header.
- **Downstream Identity/Notification:** Identity public error schema và Notification `ApiErrorFilter` trả nested `error`; Gateway/Identity transport có request-id header. Schema `packages/contracts/http/gateway/openapi.yaml` cho phép cả Gateway envelope và Workspace top-level response.
- **Runtime limitation:** Mobile không có native E2E harness trong repository; live authenticated proof cần runtime/account được phê duyệt.

## 5. Nhật ký theo session

### Session 1 - Re-audit và tái lập

| Việc | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- |
| Đọc `AGENTS.md`, `apps/mobile/AGENTS.md`, audit và log Mobile gần nhất | Shared worktree dirty; giữ mọi thay đổi cũ/stash/untracked | Xong |
| GitNexus query/impact graph-first | `normalizeApiError`, `requestWorkspace`, `requestNotification` trả ambiguous/`UNKNOWN` do nhiều candidate/dynamic import; không có HIGH/CRITICAL. Text search và source đã xác nhận consumers/call chain. | Xong |
| Reproduce trước sửa | Gateway-style `403` bị hạ thành `FORBIDDEN` + Axios message và giữ raw envelope trong `details`; top-level Workspace mất `requestId`; nested downstream mất header requestId | Xong |

### Session 2 - Minimal fix và verification

| Việc | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- |
| Test-first error envelope cases | Thêm test cho nested Gateway, top-level Workspace và nested downstream/header; RED trước production fix, GREEN sau fix | Xong |
| Sửa Mobile error normalization/repositories | Parse bằng type guards; giữ code/message/details/status/requestId; không raw Axios; Workspace/Notification rethrow normalized error | Xong |
| Focused regression | `62/62 PASS` gồm auth/session/profile/password/recovery, Workspace, Notification và error envelope | Xong |
| Compile/export/runtime gate | `tsc PASS`; Expo Web export `PASS`, 42 routes; không có ADB device, không có Gateway/Identity/... listener; không có mobile E2E harness | Xong / live bị chặn |

### Diễn giải quan trọng

Repository-level CJS probe không chạy được với Node loader hiện có vì package Mobile không khai báo `tsx`/Jest và native `.ts` loader không resolve import extensionless như `stores/auth.store`. Không giữ test đỏ hoặc cài tooling để vượt blocker; Workspace/Notification call-chain đã được source kiểm chứng, còn envelope mapping được test trực tiếp qua shared HTTP normalizer và compile/export thực.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng type guards cho unknown response body/header | Gateway có nhiều envelope hợp lệ; cần phân biệt nested/top-level mà không assertion che mismatch | Ép `AxiosError<{ code; message }>` hoặc `any` | Giữ contract fields an toàn; requestId lấy body trước rồi header |
| Rethrow normalized error ở Workspace/Notification | Repository trước đó làm mất message/status/requestId hoặc thay bằng generic | Giữ generic UI error | UI nhận đúng contract; không lưu raw Axios response/credentials |
| Không đổi auth/session lifecycle | 401 vẫn expire persisted session khi token hiện tại còn khớp; chỉ thay error payload | Thiết kế refresh/retry mới | Không mở rộng scope; live session behavior vẫn cần approved runtime |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `http-client.ts`: nhận nested Gateway/Identity/Notification errors và top-level Workspace errors; lấy status HTTP, requestId body hoặc `x-request-id`/`x-correlation-id` header; fallback status code chỉ khi envelope không có code.
- `error.types.ts`: bổ sung `requestId?: string` cho normalized `ApiError`.
- `http-workspace.repository.ts`: 401 vẫn thực hiện session expiry như trước nhưng trả normalized contract error, không thay bằng object generic.
- `http-notification.repository.ts`: 401 và các lỗi khác trả normalized safe error, không giữ raw Axios response và không làm mất status/requestId/message.
- `http-client.error-envelope.test.cjs`: test ba envelope shapes thực tế và không chứa secret.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không thay đổi.
- **Migration/seed:** Không áp dụng; không đụng dữ liệu thật.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi package manifest, lockfile, Expo config, dependency hoặc service runtime.
- Không dừng/reconfigure process đang nghe cổng 8081.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không đổi route; chỉ map response lỗi của Gateway hiện có.
- **Security:** Không log token/cookie/body raw; không đưa secret vào test/log. `details` chỉ giữ mảng contract từ response.
- **Session:** 401 giữ side effect expire session hiện có, không thêm auto-refresh/retry.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| Sửa | `apps/mobile/src/infrastructure/http/http-client.ts` | Normalize nested/top-level/header error fields | File đã có thay đổi các đợt trước; review đúng hunk envelope |
| Sửa | `apps/mobile/src/infrastructure/http/http-workspace.repository.ts` | Giữ normalized 401 envelope | Không thay routes/cache/membership behavior |
| Sửa | `apps/mobile/src/infrastructure/http/http-notification.repository.ts` | Không làm mất normalized error fields | Không mở push/realtime |
| Sửa | `apps/mobile/src/domain/common/error.types.ts` | Thêm `requestId` optional | Không đổi public backend contract |
| Thêm | `apps/mobile/src/infrastructure/http/http-client.error-envelope.test.cjs` | Gateway/downstream envelope regression | Node CJS helper test; không phải live test |
| Thêm | `docs/work_logs/2026-09-22-mobile-integration-closure.md` | Closure evidence/handoff | Chỉ ghi metadata, không secret |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Reproduce trước sửa | Node probe với Gateway-style `403` | Trước sửa mất nested code/message/requestId, trả Axios message | Đã tái lập source bug, không dùng dữ liệu thật |
| Focused regression | `node --test src/infrastructure/http/http-client.error-envelope.test.cjs src/infrastructure/http/password-recovery.http.contract.test.cjs src/features/auth/password-recovery.utils.test.cjs src/infrastructure/http/password.http.contract.test.cjs src/features/auth/change-password.utils.test.cjs src/features/auth/auth-session.coordinator.test.cjs src/features/profile/profile.utils.test.cjs src/infrastructure/http/profile.http.contract.test.cjs src/infrastructure/http/session.http.contract.test.cjs src/features/auth/session-management.utils.test.cjs src/infrastructure/http/http-client.auth.test.cjs src/infrastructure/http/notification.http.contract.test.cjs src/infrastructure/http/workspace.http.repository.test.cjs src/infrastructure/http/workspace.mutation.http.test.cjs src/stores/workspace.mutation.store.test.cjs src/stores/workspace.store.test.cjs src/features/workspace/workspace.mutations.test.cjs src/features/workspace/workspace.pagination.test.cjs src/features/notifications/notification.query.test.cjs` | `PASS; 62/62` | Fixture/pure contract/state tests; không live Gateway |
| Mobile typecheck | `pnpm --dir apps/mobile exec -- tsc --noEmit --pretty false` | `PASS` | Compile, không chứng minh live auth |
| Expo Web export | `pnpm --dir apps/mobile exec -- expo export --platform web --output-dir <TEMP>/weav-mobile-integration-closure-<id> --no-minify` | `PASS; 42 static routes` | Expo Web/export evidence, không phải native/live |
| Native prerequisite | `adb devices` | Không có device | Chưa có native proof |
| Mobile E2E harness | `rg --files apps/mobile | rg -i '(playwright|detox|maestro|e2e)'` | `NO_MOBILE_E2E_HARNESS` | Không cài dependency mới |
| Runtime listeners | Read-only port check `3000,5173,8081-8085,19000-19002` | Chỉ `8081` có Python process sẵn; không có evidence Gateway/Identity/Workspace/Notification/OCR | Không dừng/reconfigure process |
| GitNexus | `pnpm dlx gitnexus@latest impact ... --direction upstream --repo .` | `UNKNOWN/ambiguous` cho dynamic candidates; không HIGH/CRITICAL; source-confirm bằng Gateway schema/filter + consumer search | Chưa commit nên không chạy detect-changes để commit |
| Diff | `git diff --check` sau khi đóng log | `PASS`; chỉ warning CRLF/LF trên file Mobile cũ ngoài scope | Không có whitespace error |

### Điều chưa được kiểm tra

- Chưa có authenticated live chain login/session restore → workspace/members → notification → logout/account switch.
- Chưa có native device/harness và approved test account/runtime; Expo Web export và fixture không được coi là native/live PASS.
- Không chạy Gateway suite vì không sửa Gateway/backend contract; source/tests Gateway đã được đọc để xác nhận envelope.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Bằng chứng | Xử lý / bước tiếp theo |
| --- | --- | --- | --- |
| Cao | Live/native integration chưa có evidence | `adb devices` không có device; không có approved account/runtime; mobile không có E2E harness | Reviewer cung cấp device + running services + disposable/approved account nếu cần live sign-off |
| Trung bình | Direct repository CJS test runner không resolve extensionless TS imports | Node native loader fail ở `stores/auth.store`; `tsx`/Jest không có trong manifest | Không cài tooling; giữ focused normalizer tests + source call-chain + tsc/export evidence |
| Thấp | Git worktree shared dirty | Status có thay đổi các đợt/worker cũ và stash; GitNexus overall impact có thể cao | Không restore/pop/drop/stage/commit; reviewer xem đúng files/hunks ownership |

### Lỗi có thể tái lập

Trước fix, normalize Gateway-style `403` trả `code=FORBIDDEN`, message Axios và đặt toàn bộ body vào `details`; sau fix focused test yêu cầu và xác nhận `MEMBERSHIP_FORBIDDEN`, message contract, details array, status 403 và requestId.

## 11. Trạng thái bàn giao

### Có thể review ngay

1. Review các hunk trong `http-client.ts`, `http-workspace.repository.ts`, `http-notification.repository.ts`, `error.types.ts` và test envelope.
2. Đối chiếu log audit với source Gateway/Workspace/Identity/Notification; không mở Connections/Erdos trong lane này.
3. Dùng kết quả `62/62`, `tsc PASS`, Expo export PASS như fixture/compile evidence, không gọi là live/native proof.

### Cần quyết định / quyền truy cập từ người khác

- Nếu cần live closure: cung cấp Gateway + Identity + Workspace + Notification runtime, approved disposable account/session và native device hoặc Expo Web runtime; không bypass auth/seed production.
- Reviewer xác nhận có chấp nhận limitation direct repository harness hay mở task riêng cho test runner/harness.

### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, audit và `git status` trước khi sửa.
- Không mở feature mới; Workflow/AI/Bot, Connections/Erdos, OCR Mobile và OAuth migration vẫn deferred.
- Giữ nguyên stash và thay đổi worker khác; không stage toàn bộ hoặc commit/merge/push trong closure này.

## 12. Tham chiếu

- `AGENTS.md`
- `apps/mobile/AGENTS.md`
- `docs/work_logs/2026-09-22-fe-integration-coverage-audit.md`
- `services/api-gateway/src/common/gateway-exception.filter.ts`
- `services/api-gateway/src/workspace/workspace-proxy.service.ts`
- `services/api-gateway/src/notifications/notifications.module.ts`
- `packages/contracts/http/gateway/openapi.yaml`
- `packages/contracts/http/workspace/openapi.yaml`
- `packages/contracts/http/auth/openapi.yaml`
- `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/web/GlobalExceptionHandler.java`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 Asia/Saigon` |
| Trạng thái worktree | `108` status entries: `39` tracked modified, `69` untracked, `0` staged; package/lockfile không đổi; có thay đổi shared chưa commit |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Hubble / Luna Max` |
| Cần đọc trước khi tiếp tục | Phần 9 evidence, phần 10 blocker, phần 11 handoff; giữ live limitation |

---

## Checklist trước khi đóng log

- [x] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [x] Mọi quyết định ảnh hưởng behavior đều có lý do và source evidence.
- [x] File thay đổi, dependency/config và giới hạn harness đã được nêu.
- [x] Có lệnh tái lập cho test/typecheck/export/runtime checks.
- [x] Rủi ro, blocker và next step có hành động rõ ràng.
- [x] Không có secret, token, password, connection string hoặc PII nhạy cảm.
- [x] Trạng thái commit/PR/worktree chính xác tại thời điểm đóng log: `108` entries, `0` staged, chưa commit/PR.
