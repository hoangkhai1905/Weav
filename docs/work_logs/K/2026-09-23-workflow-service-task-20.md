# Nhật ký ngày `2026-09-23` — Workflow Service Task 20

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` / `T:\Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / chưa commit |
| Người thực hiện | Codex GPT-6 worker |
| Người review / nhận bàn giao | `/root` |
| Trạng thái cuối session | Task 20 và readiness/execution-feedback follow-up đã hoàn tất; persistence/reload của draft cũ chưa có trong builder hiện tại |
| Phạm vi session | Đồng bộ Workflow V1 catalog, builder config/readiness, truthful canvas/telemetry, visual preview và Playwright browser checks. |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Task 20; `docs/superpowers/specs/workflow-service-spec.md` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Catalog và palette dùng chính xác 13 loại node V1; mặc định không còn node `agent.task`, `google.docs`, `logic.filter`, `$json`, Google connection UUID giả hoặc public webhook path do người dùng chọn.
- Builder có cron sáu trường/timezone, condition khai báo với sáu operator và true/false source handles; còn hỗ trợ lưu draft cấu hình chưa hoàn chỉnh nhưng chặn publish khi integration hoặc prerequisite chưa sẵn sàng.
- Thêm trạng thái rõ cho Telegram, email, AI, OCR và Google Sheets; OCR source chọn đúng một `artifactId`/`fileUrl` và production gate vẫn đóng.
- Canvas mặc định không còn giả trạng thái webhook thành công hoặc timing mẫu; node AI/condition hiển thị unavailable/not configured. Hành động `Preview flow` chỉ animate kết nối, ghi rõ không gọi Workflow Service/provider và không đặt node thành success.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | `CI=true pnpm --dir apps/web build`; có cảnh báo bundle JS lớn hơn 500 kB. |
| Unit / integration test | `PASS trong phạm vi web` | Follow-up: catalog + Workflow UI 33/33 qua Chromium; OCR builder 7/7 ở lượt Task 20 trước đó. |
| Migration / database | `Không áp dụng` | Không sửa database hoặc API backend. |
| Health check | `Chưa kiểm tra` | Không cần cho thay đổi local builder; backend không được chạy trong browser suite. |
| Review thay đổi | `Đã kiểm tra` | `git diff --check -- apps/web` sạch; ESLint scoped pass. |
| Commit / PR | `Chưa tạo` | Không stage/commit/push. |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Chỉ cung cấp node choices/defaults được Workflow Service V1 hỗ trợ.
2. Giữ node legacy trong draft mà không xóa hoặc chuyển đổi config, cảnh báo và không cho publish.
3. Cung cấp UI khai báo an toàn, readiness rõ ràng và Playwright bằng chứng trên Vite/Chromium.

### Trong phạm vi

- `apps/web/src/lib/constants/nodeCatalog.ts`, `apps/web/src/types/workflow.types.ts`.
- `apps/web/src/lib/nodeReadiness.ts`, `apps/web/src/pages/WorkflowBuilderPage.tsx`, `apps/web/src/components/builder/CustomWorkflowNode.tsx`.
- `apps/web/e2e/workflow-catalog-v1.spec.ts` và các Playwright assertions liên quan trong `apps/web/e2e/workflow-ui.spec.ts`.
- K work log và ignored scratch handoff.

### Ngoài phạm vi / chủ động chưa làm

- Không sửa Workflow/Gateway/Compose/config/backend/API contract trong session này.
- Không bổ sung persistence, API load/save/reload, local-storage workflow API mới hoặc sản phẩm authoring đầy đủ.
- Không bật OCR production path và không giả định verifier, URL allowlist, artifact resolver hoặc descriptor contract đã sẵn sàng.

### Tiêu chí hoàn thành

- [x] Catalog và palette khớp đúng 13 node V1, không có defaults code-like/fake identifiers.
- [x] Condition có config declarative/operator/true-false ports; schedule có cron/timezone sáu trường.
- [x] Unconfigured integration/readiness hiển thị và publish bị chặn; draft vẫn lưu được.
- [x] Playwright, build, scoped lint và diff check đã chạy.
- [ ] Mở một draft legacy đã persist trong UI và reload một condition graph đã lưu trên backend: builder hiện chưa có luồng load/save persistence, vì vậy kiểm tra thật hai luồng này còn chờ integration authoring sau.

## 4. Bối cảnh và ràng buộc

- **Bối cảnh hệ thống:** Builder hiện khởi tạo graph demo từ `INITIAL_NODES`; route không tải một persisted workflow hay khôi phục saved draft. Mapper riêng vẫn đổi `WorkflowDefinition` sang React Flow và ngược lại.
- **Nguồn sự thật:** Task 20 và spec Workflow V1. Node type/edge source handle được giữ đúng contract `WorkflowNode`/`WorkflowEdge`; không đưa screen coordinates vào executable schema.
- **Giả định đã dùng:** Catalog là nguồn node choices/defaults; phần trình bày palette chỉ bổ sung tên/icon/dịch và không duy trì danh sách type riêng.
- **Ràng buộc:** Integration readiness là trạng thái chưa cấu hình/chưa có contract, không phải lời hứa runtime. OAuth/provider execution không được giả lập là sẵn sàng.
- **GitNexus:** MCP impact cho builder/test target trả `UNKNOWN` vì database schema 43 không tương thích runtime storage 42. Không có HIGH/CRITICAL verdict; source search/manual inspection đã xác nhận route dùng `WorkflowBuilderPage`, palette lấy `NODE_CATALOG`, mapper giữ type/config và `CustomWorkflowNode` là renderer trong builder/ExecutionDetail. UNKNOWN không được coi là all-clear.

## 5. Nhật ký theo session / thời gian

### Session 1 — 2026-09-23

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Đầu session | Đọc AGENTS, plan/spec, Task 18 context, work log template và cấu hình web | Chốt phạm vi apps/web; builder chưa có draft load/reload path. | Xong |
| Trong session | Thay catalog/palette/defaults và builder inspector/readiness | Exact V1 set; schedule, webhook, condition, Telegram, Google Sheets, OCR và integration gates thể hiện theo contract. | Xong |
| Trong session | Cập nhật custom node + mapper-related Playwright checks | Unsupported renderer có warning; mapper regression giữ legacy type/name/config; condition source ports round-trip thành sourcePort. | Xong |
| Trong session | Chạy Chromium catalog suite và xem screenshot | 7 tests passed; screenshot tại `apps/web/test-results/workflow-catalog-v1-condit-fcf98-rvive-editor-reload-mapping-chromium/workflow-condition-v1.png` (ignored). | Xong |
| Trong session | Chạy Workflow UI/Responsive/OCR node subset | 11 tests passed sau khi test click blank canvas tránh node Manual Trigger mới thêm. | Xong |
| Trong session | Chạy OCR builder suite | 7 tests passed với OCR response routes được fixture trong test. | Xong |
| Trong session | Chạy build, lint và diff check | Build/scoped ESLint/diff check pass; full lint gặp sẵn hai lỗi React effect trong `SettingsPage.tsx`. | Xong; blocker ngoài scope được ghi lại |

### Session 2 — 2026-09-23 (readiness follow-up)

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Đầu session | Xem lại báo cáo review Chromium và kiểm tra source hiện tại | Xác nhận badge `Ready`, `120ms` và telemetry đầu trang là dữ liệu hard-coded; `handleRunExecution` gán success giả cho AI/condition/email. | Xong |
| Trong session | Thêm readiness badge theo node type/config và làm rõ OCR test riêng | Webhook draft, AI/email/Telegram/OCR unavailable, condition/HTTP/schedule chưa cấu hình và Google authorization được phân biệt; OCR test dùng trạng thái `Test passed`. | Xong |
| Trong session | Thay Run Test mô phỏng bằng `Preview flow` chỉ animate edge | Banner persistent và telemetry nói không gọi Workflow Service/node integrations; không thay đổi node status hay tạo success telemetry. Input/output/log tab không hiển thị payload mẫu giả. | Xong |
| Cuối session | Chromium, build, scoped lint, diff check | Hai spec `workflow-catalog-v1` + `workflow-ui` pass 33/33; focused readiness/preview regression pass lại 4/4 sau chỉnh text; build, scoped lint, diff check pass. | Xong |

### Diễn giải quan trọng

Chromium chạy Vite thật với `VITE_API_MODE=mock` để đi qua protected app shell; OCR builder network response được Playwright route-fixture. Catalog suite theo dõi page errors, console errors và failed requests; không có runtime/console/network errors. Vite in console warning về reduced-motion từ media emulation, không phải error.

Condition suite kiểm tra hai handles trên DOM và dùng workflow mapper lưu/reload mapping cho `sourcePort: true|false`. Đây chưa phải browser drag-connect và reload từ backend. Builder hiện không tải saved draft nên không thể kiểm tra một workflow legacy đã persist qua UI mà không mở rộng ngoài phạm vi.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Lấy palette choices/defaults trực tiếp từ catalog | Tránh palette/catalog lệch node types và default config. | Duy trì thêm một danh sách type trong builder. | Presentation metadata chỉ map label/icon/category; catalog điều khiển choices. |
| Chỉ render condition bằng left/operator/right và hai source handles | Contract là declarative; không nhận arbitrary code. | Giữ JavaScript/JSON expression editor. | Chỉ sáu operator được đưa ra; default left/right rỗng. |
| Giữ renderer cho node không hỗ trợ nhưng cảnh báo | Draft cũ không được âm thầm mất dữ liệu; unsupported không được publish V1. | Xóa node/config khi mở hoặc đưa lại vào palette. | Mapper test xác nhận type/name/config còn nguyên; UI load thật chờ persisted-draft integration. |
| Hiện unavailable integration thay vì chọn credentials giả | Contract/provider authorization còn thiếu. | UUID mẫu hoặc fake successful execution. | Google connection unselected; Telegram/AI/email/OCR readiness chặn publish; OCR production gate tách biệt. |
| Chỉ preview đường nối, không giả lập workflow execution | Workflow Builder chưa gọi Workflow Service; status/telemetry demo gây hiểu nhầm về AI/email/webhook success. | Giữ packet animation như visualization. | Button/banners ghi rõ preview-only; node readiness không thay đổi và không ghi success. |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `nodeCatalog.ts`: exact 13 V1 nodes; schedule default `0 0 9 * * *` / `Asia/Ho_Chi_Minh`; blank webhook `POST`, Google connection ID, email/Telegram/HTTP fields; condition `{left:'', operator:'eq', right:''}` với true/false ports; OCR language `vi+en`, `detectTables=true`.
- `workflow.types.ts`: thêm category `logic` và tùy chọn `sourcePorts` mà không đổi `WorkflowEdge` contract.
- `WorkflowBuilderPage.tsx`: palette derive catalog; inspector condition/schedule/webhook/manual/Telegram/HTTP/email/AI/Google/OCR theo V1. Initial telemetry/status fake được xóa; action `Preview flow` chỉ animate edge và không đổi node status. Input/output/log tab không còn mẫu giả.
- `CustomWorkflowNode.tsx` + `nodeReadiness.ts`: badge theo readiness của config/type; unavailable/unconfigured/draft/authorization/unsupported đều rõ. OCR direct test được gọi `Test passed`, không workflow `success`.
- `workflow-catalog-v1.spec.ts`: exact supported catalog/palette, safe defaults, readiness badges and visual-preview behavior, schedule/webhook inputs, declarative condition/source-port mapping, OCR source behavior, legacy mapper preservation.
- `workflow-ui.spec.ts`: preview-only state regressions và reduced-motion behavior cùng checks trước đó về layout/inspector; không có fake node success.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không đổi.
- **Migration:** Không áp dụng.
- **Dữ liệu seed/test:** Legacy fixture là test-only (`google.docs`, `agent.task`) để xác nhận mapper không đổi `id/type/name/config`.
- **Tính tương thích:** Các type cũ vẫn được map/render và cảnh báo; không còn là lựa chọn tạo node mới.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi cấu hình, dependency hoặc hạ tầng.
- Browser test mode `VITE_API_MODE=mock` chỉ dùng để render protected shell trong Vite suite; OCR extraction e2e dùng route fixtures.

### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không đổi API.
- **Security/readiness:** Google connection unselected; Telegram/Bot, AI provider, email delivery và OCR prerequisites được đánh dấu unavailable. Publish bị disable, draft Save vẫn khả dụng.
- **OCR:** `artifactId` và `fileUrl` mutually exclusive ở UI; URL allowlist, claim verification và artifact resolver còn chưa xác minh nên execution gate tiếp tục đóng.
- **Webhook:** Không có path/endpoint caller input; endpoint key/secret và public path do hệ thống provisioning quản lý.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `apps/web/src/lib/constants/nodeCatalog.ts` | Catalog/defaults đúng V1 | Palette đọc catalog. |
| `Sửa` | `apps/web/src/types/workflow.types.ts` | Thêm logic/source ports | Existing edge schema giữ nguyên. |
| `Sửa` | `apps/web/src/pages/WorkflowBuilderPage.tsx` | Catalog inspector, gates, telemetry, preview-only animation | Builder chưa có persistence/real V1 execution. |
| `Sửa` | `apps/web/src/components/builder/CustomWorkflowNode.tsx` | Readiness badge, unsupported warning, condition handles | Existing `success`/`error` execution statuses remain supported. |
| `Thêm` | `apps/web/src/lib/nodeReadiness.ts` | Badge state derive từ catalog/config | Không tạo runtime integration contract. |
| `Thêm` | `apps/web/e2e/workflow-catalog-v1.spec.ts` | 8 Playwright contract/browser checks | Chromium + Vite. |
| `Sửa` | `apps/web/e2e/workflow-ui.spec.ts` | Preview-only regressions và prior layout checks | Chromium + Vite. |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Compile/build | `$env:CI='true'; pnpm --dir apps/web build` | `PASS`; tsc và Vite build xong | Vite báo bundle JS ~1.07 MB, >500 kB warning. |
| Catalog browser | `playwright.cmd test e2e/workflow-catalog-v1.spec.ts --project=chromium --workers=1 --retries=0 --reporter=line` | `PASS 7/7` | Chạy Vite thật trong mock auth mode; backend không chạy. |
| UI builder subset | `playwright.cmd test e2e/workflow-ui.spec.ts --project=chromium --workers=1 --retries=0 --reporter=line --grep "workflow builder execution motion|workflow responsive layout|OCR workflow node"` | `PASS 11/11` | Responsive/builder interactions và OCR node UI. |
| OCR builder | `playwright.cmd test e2e/ocr-builder.spec.ts --project=chromium --workers=1 --retries=0 --reporter=line` | `PASS 7/7` | OCR HTTP responses được stub bằng Playwright routes. |
| Scoped lint | `eslint.cmd src/lib/constants/nodeCatalog.ts src/types/workflow.types.ts src/pages/WorkflowBuilderPage.tsx src/components/builder/CustomWorkflowNode.tsx e2e/workflow-catalog-v1.spec.ts e2e/workflow-ui.spec.ts` | `PASS` | Tất cả file thuộc scope. |
| Full lint | `$env:CI='true'; pnpm --dir apps/web lint` | `FAIL` | Lỗi sẵn ngoài scope ở `src/pages/SettingsPage.tsx:76,82` (`react-hooks/set-state-in-effect`), warning thiếu dependency `t` tại line 106. Không chỉnh SettingsPage. |
| Screenshot/runtime | `workflow-catalog-v1.spec.ts` test condition editor | Screenshot hiện graph/inspector tại `apps/web/test-results/workflow-catalog-v1-condit-fcf98-rvive-editor-reload-mapping-chromium/workflow-condition-v1.png`; test hook không ghi pageerror/console error/requestfailed | Screenshot/test-results bị `.gitignore` loại trừ. Vite có reduced-motion warning. |
| Static diff | `git diff --check -- apps/web` | `PASS`, không output | Chỉ xem diff của apps/web. |
| Readiness follow-up Chromium | `playwright.cmd test e2e/workflow-catalog-v1.spec.ts e2e/workflow-ui.spec.ts --project=chromium --workers=1 --retries=0 --reporter=line` | `PASS 33/33`; focused readiness/preview grep `PASS 4/4` after final copy update | Running Vite + Chromium; pageerror/console.error/requestfailed hook stayed empty. Reduced-motion emitted a non-error warning. |
| Follow-up build / scoped lint | `CI=true pnpm --dir apps/web build`; scoped `eslint.cmd` on WorkflowBuilderPage, CustomWorkflowNode, nodeReadiness and the two E2E specs | `PASS`; `git diff --check -- apps/web` `PASS` | JS bundle warning >500 kB remains unchanged. |

### Điều chưa được kiểm tra

- Không có API persistence hiện tại để mở một saved legacy draft hoặc refresh một saved condition graph trong browser. Legacy data retention được kiểm tra qua actual Vite-imported mapper round-trip; warning/publish blocker cho loaded node được implement trong renderer/builder source nhưng chưa test bằng backend-loaded draft.
- Condition handles verified in DOM; test mapper round-trip sinh source handles `true`/`false`, chưa kéo connector vật lý trên canvas.
- Không kiểm tra live backend/provider readiness hoặc authenticated API request vì đây là catalog/editor scope.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | Không thể kiểm thử load/reload draft thật | WorkflowBuilderPage chỉ khởi tạo `INITIAL_NODES`, không có fetch/save adapter | Không phát minh persistence/API; giữ mapper checks | Task authoring/persistence sau tích hợp backend. |
| Thấp | Full app lint fail | Hai hook setState effect errors sẵn ở `SettingsPage.tsx` | Scoped lint của toàn bộ file scope pass | Chủ sở hữu SettingsPage quyết định xử lý riêng. |
| Thấp | GitNexus impact `UNKNOWN` | Stored graph schema 43/runtime storage 42 mismatch | Đã corroborate bằng source searches; không coi là no-impact | Re-index khi GitNexus runtime/storage đồng bộ trước commit/review graph. |

### Lỗi có thể tái lập

```text
pnpm --dir apps/web lint
SettingsPage.tsx:76,82 react-hooks/set-state-in-effect; line 106 exhaustive-deps warning.
```

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Review diff trong `apps/web/src/pages/WorkflowBuilderPage.tsx`, catalog, custom node và `workflow-catalog-v1.spec.ts`.
2. Khi Workflow backend authoring API được tích hợp, thêm browser test mở persisted unsupported draft, assert warning/publish disabled, save/reload condition edges và drag-connect true/false.

### Cần quyết định / quyền truy cập từ người khác

- Cần upstream persisted draft load/save behavior trước khi có thể xác nhận UI round-trip thật; không tạo contract mới trong Task 20.
- Full lint issue ở SettingsPage thuộc owner của file đó.

### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, Task 20/spec và `git status` trước khi sửa.
- `apps/web/test-results/.../workflow-condition-v1.png` là local ignored artifact.
- Chạy direct Playwright CLI từ `apps/web` khi Vite đã sẵn sàng; cấu hình CI/no-TTY trước pnpm để tránh package-manager interactive cleanup.
- Không stage/commit/push; checkout có thay đổi song song ngoài apps/web.

## 12. Tham chiếu

- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Task 20.
- `docs/superpowers/specs/workflow-service-spec.md` — Workflow V1 node/definition contract.
- `apps/web/test-results/workflow-catalog-v1-condit-fcf98-rvive-editor-reload-mapping-chromium/workflow-condition-v1.png` — ignored browser screenshot.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 20:27 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; chỉ phần web scope được ghi trong mục 8, các thay đổi khác thuộc worker song song. |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex GPT-6 worker |
| Cần đọc trước khi tiếp tục | Mục 9 (kiểm chứng/giới hạn) và Task 20 trong plan. |
