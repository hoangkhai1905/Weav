# Nhật ký đợt 6 - Web OCR integration hardening

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-22` |
| Múi giờ | `Asia/Saigon` |
| Repository / branch | `D:\End\Weav` / `api-gateway` |
| Người thực hiện | `Luna Max` |
| Người review | `User / Astra` |
| Trạng thái | `Đang triển khai` |
| Phạm vi | Web chọn workspace thật → multipart OCR qua Gateway → hiển thị response/error |

## 2. Gate trước đợt 6

- Đợt 5 Mobile Workspace create/rename đã có work log và không còn blocker chức năng chưa xử lý trong phạm vi đợt trước.
- Git worktree đang giữ toàn bộ thay đổi cũ, untracked và hai stash; không restore/pop/drop stash, reset, stage-all, commit, merge hoặc push.
- Status đầu đợt: `45` entries (`22` tracked modified, `23` untracked), `0` staged; stash chỉ đọc.

## 3. Bounded plan / acceptance

### Trong phạm vi

1. Đối chiếu `ocr.api.ts`, Workflow Builder, Gateway controller/proxy và OpenAPI multipart/error contract.
2. Bổ sung Playwright fixture kiểm tra network/UI thật: route/auth/multipart, no-selection/no-request, duplicate submit, retry chủ động, status errors và stale result sau scope đổi.
3. Chỉ sửa production code nếu baseline/fixture chứng minh gap: request abort/scope guard, auth lifecycle 401, retry UI hoặc response/error safety.
4. Chạy focused Playwright, workspace/OCR regression, web build/lint, diff-check; thử live authenticated browser nếu runtime/session được cấp.

### Ngoài phạm vi

- Không sửa mobile, backend OCR engine, Gateway/backend contract, Workflow execution, AI, Bot, storage redesign hoặc tạo active workspace source thứ hai.
- Không fallback HTTP sang mock; mock/fixture không được coi là live proof.
- Không dùng dữ liệu thật không liên quan, không đọc/in secrets, không bật JWT bypass.

### Tiêu chí chấp nhận

- [ ] Multipart POST đúng `/api/v1/workspaces/{workspaceId}/ocr/extractions`, auth transport đúng, browser không set `Content-Type` boundary thủ công.
- [ ] No-selection không gửi request; file/size/fields theo contract; pending/duplicate submit đúng.
- [ ] Success hiển thị response thật; lỗi an toàn, retry chỉ do user, không success giả.
- [ ] 401 theo auth lifecycle; 403/413/422/429/503 theo error envelope/status contract.
- [ ] Workspace/user đổi hoặc logout trong lúc request không áp result cũ; request được abort nếu hỗ trợ.
- [ ] Fixture UI/network + workspace/OCR regression, build/lint và diff-check có bằng chứng.

## 4. Contract/source findings

- Public route: `POST /api/v1/workspaces/{workspaceId}/ocr/extractions`, BearerAuth, multipart fields `file` bắt buộc, `language` enum `vi|en|vi+en`, `detectTables` boolean; file tối đa 10 MiB/10 pages; `Content-Type` boundary do browser tự sinh.
- Public status contract: `200`, `400`, `401`, `403`, `404`, `413`, `415`, `422`, `429`, `500`, `502`, `503`, `504`, tất cả lỗi dùng `ApiErrorEnvelope`; `429/503` có thể có `Retry-After`.
- Existing client correctly uses selected workspace ID and `FormData`, but source review identified gaps to verify: no request-scope abort/stale-result guard, no explicit user retry control, and 401 does not currently call the existing auth lifecycle.

## 5. GitNexus pre-edit impact

- `ocrApi`: `UNKNOWN` because module/object property edges are unresolved; source confirms only `WorkflowBuilderPage` calls `ocrApi.extractText`.
- `WorkflowBuilderPage`: `UNKNOWN` with no resolved callers; source confirms route import in `App.tsx` and direct `useWorkspaceContext`/OCR UI flow.
- `mapStatusToErrorMessage`, `getStoredAuthToken`, `useWorkspaceContext`: `UNKNOWN`/collision-prone; source search confirms callers in OCR, auth, workspace and notification adapters. No HIGH/CRITICAL source impact found.
- `ocrApi.extractText` exact symbol was not resolved by index; source inspection is the verification for the object method boundary. No edit proceeds on UNKNOWN alone.

## 6. TDD / verification plan

- RED: extend `apps/web/e2e/ocr-builder.spec.ts` with fixture UI/network cases for no-selection, one request under duplicate click, retry action, 401 lifecycle, and late result after workspace/account scope changes; add a focused pure helper test only if production extraction logic must be split.
- GREEN: make the smallest production changes in `apps/web/src/api/ocr.api.ts` and `apps/web/src/pages/WorkflowBuilderPage.tsx`; preserve existing workspace/client/query boundaries.
- Regression commands from `apps/web/package.json`:
  - `pnpm --dir apps/web test:e2e -- e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000`
  - `pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000`
  - `pnpm --dir apps/web build`
  - `pnpm --dir apps/web lint`
  - focused `pnpm --dir apps/web exec eslint ...` only for changed files if full lint remains baseline-blocked.

## 7. Implementation và files thuộc đợt 6

### Code/hành vi

- `apps/web/src/pages/WorkflowBuilderPage.tsx`: thêm request scope theo `userId` + `activeWorkspaceId`, `AbortController`, abort khi scope đổi/unmount, bỏ qua stale success/error, duplicate-submit guard, 401 gọi `useAuthStore.logout()`, retry chỉ do user click, khóa file input trong lúc chạy, và ẩn result/error không còn thuộc scope hiện tại.
- Không sửa `apps/web/src/api/ocr.api.ts`: contract client hiện đã gửi `FormData` đúng, để browser tự sinh `Content-Type` boundary, dùng Bearer token + `X-Request-ID`, route đúng và map status/error envelope theo OpenAPI. Chỉ harden caller/lifecycle vì đây là gap có bằng chứng.
- `apps/web/e2e/ocr-builder.spec.ts`: thêm fixture UI/network cho multipart boundary, retry thủ công, duplicate events, 422/429, 401 auth lifecycle, late result sau logout và no-selection; giữ regression response rendering/file limits/403/503.

### Contract và quyết định

- Đã đối chiếu `packages/contracts/http/ocr/openapi.yaml`, `services/api-gateway/src/ocr/ocr.controller.ts`, proxy/service source và OCR route. Public route là `POST /api/v1/workspaces/{workspaceId}/ocr/extractions`; multipart `file` bắt buộc, `language` chỉ `vi|en|vi+en`, `detectTables` boolean; file tối đa 10 MiB/10 pages.
- Không set `Content-Type` thủ công trong production; fixture assert header có `multipart/form-data; boundary=...`.
- Không invent mapping status: `413/415/422/429/503` dùng client mapping/API envelope hiện hữu; `429/503` chỉ hiện retry khi envelope nói `retryable`; `401` đi qua auth store lifecycle.
- Không tạo active-workspace source mới, không fallback HTTP→mock, không lưu file/result mới vào storage/localStorage.

## 8. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế | Giới hạn |
| --- | --- | --- | --- |
| TDD RED retry/status/401/stale | `pnpm --dir apps/web test:e2e -- e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000 --grep "retries a retryable|maps Gateway|routes OCR 401|late OCR|no workspace"` trước sửa | 4 gap tests fail đúng: thiếu retry control, 401 không chuyển login; no-selection pass; late test hit pending path | Baseline server không ổn định ở lần chạy đầu nên ghi riêng dưới đây |
| TDD RED duplicate | Tạm bỏ request guard rồi chạy grep `one OCR request` | `FAIL`, received 2 requests, expected 1 | Guard được khôi phục ngay sau RED |
| TDD GREEN focused | Cùng grep sau sửa | `PASS 5/5`; duplicate riêng `PASS 1/1` | Chromium fixture, không phải live |
| Full OCR Playwright | `$env:CI='1'; pnpm --dir apps/web test:e2e -- e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` | `PASS 13/13` | CI-isolated Vite + controlled Gateway fixture |
| Workspace regression | `$env:CI='1'; pnpm --dir apps/web test:e2e -- e2e/workspace-read-switch.spec.ts --project=chromium --workers=1 --retries=0 --timeout=30000` | `PASS 14/14` | Regression fixture, gồm workspace/OCR binding của đợt trước |
| Web build | `pnpm --dir apps/web build` | `PASS`; còn cảnh báo bundle >500 kB hiện hữu | Không phải lỗi compile |
| Focused lint | `pnpm --dir apps/web exec eslint src/api/ocr.api.ts src/pages/WorkflowBuilderPage.tsx e2e/ocr-builder.spec.ts` | `PASS` | Files đợt 6 sạch |
| Full lint | `pnpm --dir apps/web lint` | `FAIL baseline ngoài scope`: `SettingsPage.tsx:76,82` errors `react-hooks/set-state-in-effect`, line 106 missing `t` warning | Không sửa SettingsPage |
| Runtime read-only | `Test-NetConnection localhost -Port 3000/5173/8000`; `docker compose ps` | Ports `False`; Docker service list rỗng | Không có Gateway/Identity/Workspace/OCR runtime |
| Diff check | `git diff --check` | Chạy ở handoff; chỉ ghi warning CRLF nếu có, không có whitespace error | Không stage/commit |

### Baseline test incident

- Lần chạy đầu không đặt `CI=1`: OCR fixture chạy được 2 test rồi Vite webServer rơi, 5 test nhận `ERR_CONNECTION_REFUSED`. Đây là lỗi harness/runtime process, không phải assertion production; toàn bộ fixture được chạy lại với CI-isolated server và đạt `13/13`.

### Live/native evidence

- Chưa có live authenticated browser proof: Gateway/Identity/Workspace/OCR không chạy (`docker compose ps` rỗng; ports 3000/5173/8000 không mở), và không có approved test session được cung cấp.
- Fixture đã kiểm tra UI interaction + intercepted network route/body/header/response; không được coi là live PASS. Không seed/chạm dữ liệu thật và không bật JWT bypass.

## 9. Rủi ro, blocker và handoff

| Mức độ | Vấn đề | Xử lý / bước tiếp theo |
| --- | --- | --- |
| Trung bình | Full lint còn baseline errors ngoài scope tại `SettingsPage.tsx` | User/team xử lý riêng khi mở slice lint; đợt 6 không sửa file này |
| Trung bình | Live Gateway/authenticated OCR chưa kiểm chứng | Cần bật đúng Gateway + Identity + Workspace + OCR và approved session; sau đó chạy browser upload tài liệu test không nhạy cảm |
| Thấp | Worktree có thay đổi cũ/untracked/stash | Giữ nguyên; không restore/pop/drop stash, reset, stage-all, commit, merge hoặc push |

### Checklist user review

1. Review [WorkflowBuilderPage.tsx](<D:/End/Weav/apps/web/src/pages/WorkflowBuilderPage.tsx>) phần OCR: scope guard, abort, 401 logout, retry và result/error scope.
2. Review [ocr-builder.spec.ts](<D:/End/Weav/apps/web/e2e/ocr-builder.spec.ts>) để xác nhận fixture kiểm tra network/UI thật, không chỉ gọi helper.
3. Review [2026-09-22-web-ocr-integration.md](<D:/End/Weav/docs/work_logs/2026-09-22-web-ocr-integration.md>) và phân biệt `13/13` fixture với live blocker.
4. Khi runtime sẵn sàng, chạy live authenticated upload và ghi network/result evidence trước khi coi OCR integration production-verified.

## 10. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-22 01:29 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; status cuối `46` entries (`22` tracked modified, `24` untracked), `0` staged; giữ mọi thay đổi cũ/untracked/stash |
| Commit/PR | Chưa tạo |
| Người cập nhật log | Luna Max |
| Việc tiếp theo | Chờ user review và `work done`; không tự mở đợt 7 |
