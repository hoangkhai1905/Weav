# Workflow Service V1 detailed record — acceptance and release

> Historical task notes recovered from commit 18b6dfa. The source records below retain their original decisions, file inventories, test commands, and handoff details. Their test counts are milestone snapshots; the final integrated release evidence is in workflow-service-v1.md.

Source notes are grouped here to keep the K folder navigable while retaining implementation detail.

---

### Source record: 2026-09-23-workflow-service-task-20.md


#### 1. Metadata

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

#### 2. Tóm tắt điều hành

##### Kết quả chính

- Catalog và palette dùng chính xác 13 loại node V1; mặc định không còn node `agent.task`, `google.docs`, `logic.filter`, `$json`, Google connection UUID giả hoặc public webhook path do người dùng chọn.
- Builder có cron sáu trường/timezone, condition khai báo với sáu operator và true/false source handles; còn hỗ trợ lưu draft cấu hình chưa hoàn chỉnh nhưng chặn publish khi integration hoặc prerequisite chưa sẵn sàng.
- Thêm trạng thái rõ cho Telegram, email, AI, OCR và Google Sheets; OCR source chọn đúng một `artifactId`/`fileUrl` và production gate vẫn đóng.
- Canvas mặc định không còn giả trạng thái webhook thành công hoặc timing mẫu; node AI/condition hiển thị unavailable/not configured. Hành động `Preview flow` chỉ animate kết nối, ghi rõ không gọi Workflow Service/provider và không đặt node thành success.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | `CI=true pnpm --dir apps/web build`; có cảnh báo bundle JS lớn hơn 500 kB. |
| Unit / integration test | `PASS trong phạm vi web` | Follow-up: catalog + Workflow UI 33/33 qua Chromium; OCR builder 7/7 ở lượt Task 20 trước đó. |
| Migration / database | `Không áp dụng` | Không sửa database hoặc API backend. |
| Health check | `Chưa kiểm tra` | Không cần cho thay đổi local builder; backend không được chạy trong browser suite. |
| Review thay đổi | `Đã kiểm tra` | `git diff --check -- apps/web` sạch; ESLint scoped pass. |
| Commit / PR | `Chưa tạo` | Không stage/commit/push. |

#### 3. Mục tiêu và phạm vi

##### Mục tiêu đầu session

1. Chỉ cung cấp node choices/defaults được Workflow Service V1 hỗ trợ.
2. Giữ node legacy trong draft mà không xóa hoặc chuyển đổi config, cảnh báo và không cho publish.
3. Cung cấp UI khai báo an toàn, readiness rõ ràng và Playwright bằng chứng trên Vite/Chromium.

##### Trong phạm vi

- `apps/web/src/lib/constants/nodeCatalog.ts`, `apps/web/src/types/workflow.types.ts`.
- `apps/web/src/lib/nodeReadiness.ts`, `apps/web/src/pages/WorkflowBuilderPage.tsx`, `apps/web/src/components/builder/CustomWorkflowNode.tsx`.
- `apps/web/e2e/workflow-catalog-v1.spec.ts` và các Playwright assertions liên quan trong `apps/web/e2e/workflow-ui.spec.ts`.
- K work log và ignored scratch handoff.

##### Ngoài phạm vi / chủ động chưa làm

- Không sửa Workflow/Gateway/Compose/config/backend/API contract trong session này.
- Không bổ sung persistence, API load/save/reload, local-storage workflow API mới hoặc sản phẩm authoring đầy đủ.
- Không bật OCR production path và không giả định verifier, URL allowlist, artifact resolver hoặc descriptor contract đã sẵn sàng.

##### Tiêu chí hoàn thành

- [x] Catalog và palette khớp đúng 13 node V1, không có defaults code-like/fake identifiers.
- [x] Condition có config declarative/operator/true-false ports; schedule có cron/timezone sáu trường.
- [x] Unconfigured integration/readiness hiển thị và publish bị chặn; draft vẫn lưu được.
- [x] Playwright, build, scoped lint và diff check đã chạy.
- [ ] Mở một draft legacy đã persist trong UI và reload một condition graph đã lưu trên backend: builder hiện chưa có luồng load/save persistence, vì vậy kiểm tra thật hai luồng này còn chờ integration authoring sau.

#### 4. Bối cảnh và ràng buộc

- **Bối cảnh hệ thống:** Builder hiện khởi tạo graph demo từ `INITIAL_NODES`; route không tải một persisted workflow hay khôi phục saved draft. Mapper riêng vẫn đổi `WorkflowDefinition` sang React Flow và ngược lại.
- **Nguồn sự thật:** Task 20 và spec Workflow V1. Node type/edge source handle được giữ đúng contract `WorkflowNode`/`WorkflowEdge`; không đưa screen coordinates vào executable schema.
- **Giả định đã dùng:** Catalog là nguồn node choices/defaults; phần trình bày palette chỉ bổ sung tên/icon/dịch và không duy trì danh sách type riêng.
- **Ràng buộc:** Integration readiness là trạng thái chưa cấu hình/chưa có contract, không phải lời hứa runtime. OAuth/provider execution không được giả lập là sẵn sàng.
- **GitNexus:** MCP impact cho builder/test target trả `UNKNOWN` vì database schema 43 không tương thích runtime storage 42. Không có HIGH/CRITICAL verdict; source search/manual inspection đã xác nhận route dùng `WorkflowBuilderPage`, palette lấy `NODE_CATALOG`, mapper giữ type/config và `CustomWorkflowNode` là renderer trong builder/ExecutionDetail. UNKNOWN không được coi là all-clear.

#### 5. Nhật ký theo session / thời gian

##### Session 1 — 2026-09-23

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Đầu session | Đọc AGENTS, plan/spec, Task 18 context, work log template và cấu hình web | Chốt phạm vi apps/web; builder chưa có draft load/reload path. | Xong |
| Trong session | Thay catalog/palette/defaults và builder inspector/readiness | Exact V1 set; schedule, webhook, condition, Telegram, Google Sheets, OCR và integration gates thể hiện theo contract. | Xong |
| Trong session | Cập nhật custom node + mapper-related Playwright checks | Unsupported renderer có warning; mapper regression giữ legacy type/name/config; condition source ports round-trip thành sourcePort. | Xong |
| Trong session | Chạy Chromium catalog suite và xem screenshot | 7 tests passed; screenshot tại `apps/web/test-results/workflow-catalog-v1-condit-fcf98-rvive-editor-reload-mapping-chromium/workflow-condition-v1.png` (ignored). | Xong |
| Trong session | Chạy Workflow UI/Responsive/OCR node subset | 11 tests passed sau khi test click blank canvas tránh node Manual Trigger mới thêm. | Xong |
| Trong session | Chạy OCR builder suite | 7 tests passed với OCR response routes được fixture trong test. | Xong |
| Trong session | Chạy build, lint và diff check | Build/scoped ESLint/diff check pass; full lint gặp sẵn hai lỗi React effect trong `SettingsPage.tsx`. | Xong; blocker ngoài scope được ghi lại |

##### Session 2 — 2026-09-23 (readiness follow-up)

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Đầu session | Xem lại báo cáo review Chromium và kiểm tra source hiện tại | Xác nhận badge `Ready`, `120ms` và telemetry đầu trang là dữ liệu hard-coded; `handleRunExecution` gán success giả cho AI/condition/email. | Xong |
| Trong session | Thêm readiness badge theo node type/config và làm rõ OCR test riêng | Webhook draft, AI/email/Telegram/OCR unavailable, condition/HTTP/schedule chưa cấu hình và Google authorization được phân biệt; OCR test dùng trạng thái `Test passed`. | Xong |
| Trong session | Thay Run Test mô phỏng bằng `Preview flow` chỉ animate edge | Banner persistent và telemetry nói không gọi Workflow Service/node integrations; không thay đổi node status hay tạo success telemetry. Input/output/log tab không hiển thị payload mẫu giả. | Xong |
| Cuối session | Chromium, build, scoped lint, diff check | Hai spec `workflow-catalog-v1` + `workflow-ui` pass 33/33; focused readiness/preview regression pass lại 4/4 sau chỉnh text; build, scoped lint, diff check pass. | Xong |

##### Diễn giải quan trọng

Chromium chạy Vite thật với `VITE_API_MODE=mock` để đi qua protected app shell; OCR builder network response được Playwright route-fixture. Catalog suite theo dõi page errors, console errors và failed requests; không có runtime/console/network errors. Vite in console warning về reduced-motion từ media emulation, không phải error.

Condition suite kiểm tra hai handles trên DOM và dùng workflow mapper lưu/reload mapping cho `sourcePort: true|false`. Đây chưa phải browser drag-connect và reload từ backend. Builder hiện không tải saved draft nên không thể kiểm tra một workflow legacy đã persist qua UI mà không mở rộng ngoài phạm vi.

#### 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Lấy palette choices/defaults trực tiếp từ catalog | Tránh palette/catalog lệch node types và default config. | Duy trì thêm một danh sách type trong builder. | Presentation metadata chỉ map label/icon/category; catalog điều khiển choices. |
| Chỉ render condition bằng left/operator/right và hai source handles | Contract là declarative; không nhận arbitrary code. | Giữ JavaScript/JSON expression editor. | Chỉ sáu operator được đưa ra; default left/right rỗng. |
| Giữ renderer cho node không hỗ trợ nhưng cảnh báo | Draft cũ không được âm thầm mất dữ liệu; unsupported không được publish V1. | Xóa node/config khi mở hoặc đưa lại vào palette. | Mapper test xác nhận type/name/config còn nguyên; UI load thật chờ persisted-draft integration. |
| Hiện unavailable integration thay vì chọn credentials giả | Contract/provider authorization còn thiếu. | UUID mẫu hoặc fake successful execution. | Google connection unselected; Telegram/AI/email/OCR readiness chặn publish; OCR production gate tách biệt. |
| Chỉ preview đường nối, không giả lập workflow execution | Workflow Builder chưa gọi Workflow Service; status/telemetry demo gây hiểu nhầm về AI/email/webhook success. | Giữ packet animation như visualization. | Button/banners ghi rõ preview-only; node readiness không thay đổi và không ghi success. |

#### 7. Thay đổi đã thực hiện

##### 7.1. Code và hành vi

- `nodeCatalog.ts`: exact 13 V1 nodes; schedule default `0 0 9 * * *` / `Asia/Ho_Chi_Minh`; blank webhook `POST`, Google connection ID, email/Telegram/HTTP fields; condition `{left:'', operator:'eq', right:''}` với true/false ports; OCR language `vi+en`, `detectTables=true`.
- `workflow.types.ts`: thêm category `logic` và tùy chọn `sourcePorts` mà không đổi `WorkflowEdge` contract.
- `WorkflowBuilderPage.tsx`: palette derive catalog; inspector condition/schedule/webhook/manual/Telegram/HTTP/email/AI/Google/OCR theo V1. Initial telemetry/status fake được xóa; action `Preview flow` chỉ animate edge và không đổi node status. Input/output/log tab không còn mẫu giả.
- `CustomWorkflowNode.tsx` + `nodeReadiness.ts`: badge theo readiness của config/type; unavailable/unconfigured/draft/authorization/unsupported đều rõ. OCR direct test được gọi `Test passed`, không workflow `success`.
- `workflow-catalog-v1.spec.ts`: exact supported catalog/palette, safe defaults, readiness badges and visual-preview behavior, schedule/webhook inputs, declarative condition/source-port mapping, OCR source behavior, legacy mapper preservation.
- `workflow-ui.spec.ts`: preview-only state regressions và reduced-motion behavior cùng checks trước đó về layout/inspector; không có fake node success.

##### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không đổi.
- **Migration:** Không áp dụng.
- **Dữ liệu seed/test:** Legacy fixture là test-only (`google.docs`, `agent.task`) để xác nhận mapper không đổi `id/type/name/config`.
- **Tính tương thích:** Các type cũ vẫn được map/render và cảnh báo; không còn là lựa chọn tạo node mới.

##### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi cấu hình, dependency hoặc hạ tầng.
- Browser test mode `VITE_API_MODE=mock` chỉ dùng để render protected shell trong Vite suite; OCR extraction e2e dùng route fixtures.

##### 7.4. API, bảo mật và quan sát hệ thống

- **Route/contract:** Không đổi API.
- **Security/readiness:** Google connection unselected; Telegram/Bot, AI provider, email delivery và OCR prerequisites được đánh dấu unavailable. Publish bị disable, draft Save vẫn khả dụng.
- **OCR:** `artifactId` và `fileUrl` mutually exclusive ở UI; URL allowlist, claim verification và artifact resolver còn chưa xác minh nên execution gate tiếp tục đóng.
- **Webhook:** Không có path/endpoint caller input; endpoint key/secret và public path do hệ thống provisioning quản lý.

#### 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `apps/web/src/lib/constants/nodeCatalog.ts` | Catalog/defaults đúng V1 | Palette đọc catalog. |
| `Sửa` | `apps/web/src/types/workflow.types.ts` | Thêm logic/source ports | Existing edge schema giữ nguyên. |
| `Sửa` | `apps/web/src/pages/WorkflowBuilderPage.tsx` | Catalog inspector, gates, telemetry, preview-only animation | Builder chưa có persistence/real V1 execution. |
| `Sửa` | `apps/web/src/components/builder/CustomWorkflowNode.tsx` | Readiness badge, unsupported warning, condition handles | Existing `success`/`error` execution statuses remain supported. |
| `Thêm` | `apps/web/src/lib/nodeReadiness.ts` | Badge state derive từ catalog/config | Không tạo runtime integration contract. |
| `Thêm` | `apps/web/e2e/workflow-catalog-v1.spec.ts` | 8 Playwright contract/browser checks | Chromium + Vite. |
| `Sửa` | `apps/web/e2e/workflow-ui.spec.ts` | Preview-only regressions và prior layout checks | Chromium + Vite. |

#### 9. Kiểm tra và bằng chứng

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

##### Điều chưa được kiểm tra

- Không có API persistence hiện tại để mở một saved legacy draft hoặc refresh một saved condition graph trong browser. Legacy data retention được kiểm tra qua actual Vite-imported mapper round-trip; warning/publish blocker cho loaded node được implement trong renderer/builder source nhưng chưa test bằng backend-loaded draft.
- Condition handles verified in DOM; test mapper round-trip sinh source handles `true`/`false`, chưa kéo connector vật lý trên canvas.
- Không kiểm tra live backend/provider readiness hoặc authenticated API request vì đây là catalog/editor scope.

#### 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | Không thể kiểm thử load/reload draft thật | WorkflowBuilderPage chỉ khởi tạo `INITIAL_NODES`, không có fetch/save adapter | Không phát minh persistence/API; giữ mapper checks | Task authoring/persistence sau tích hợp backend. |
| Thấp | Full app lint fail | Hai hook setState effect errors sẵn ở `SettingsPage.tsx` | Scoped lint của toàn bộ file scope pass | Chủ sở hữu SettingsPage quyết định xử lý riêng. |
| Thấp | GitNexus impact `UNKNOWN` | Stored graph schema 43/runtime storage 42 mismatch | Đã corroborate bằng source searches; không coi là no-impact | Re-index khi GitNexus runtime/storage đồng bộ trước commit/review graph. |

##### Lỗi có thể tái lập

```text
pnpm --dir apps/web lint
SettingsPage.tsx:76,82 react-hooks/set-state-in-effect; line 106 exhaustive-deps warning.
```

#### 11. Trạng thái bàn giao

##### Có thể tiếp tục ngay

1. Review diff trong `apps/web/src/pages/WorkflowBuilderPage.tsx`, catalog, custom node và `workflow-catalog-v1.spec.ts`.
2. Khi Workflow backend authoring API được tích hợp, thêm browser test mở persisted unsupported draft, assert warning/publish disabled, save/reload condition edges và drag-connect true/false.

##### Cần quyết định / quyền truy cập từ người khác

- Cần upstream persisted draft load/save behavior trước khi có thể xác nhận UI round-trip thật; không tạo contract mới trong Task 20.
- Full lint issue ở SettingsPage thuộc owner của file đó.

##### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, Task 20/spec và `git status` trước khi sửa.
- `apps/web/test-results/.../workflow-condition-v1.png` là local ignored artifact.
- Chạy direct Playwright CLI từ `apps/web` khi Vite đã sẵn sàng; cấu hình CI/no-TTY trước pnpm để tránh package-manager interactive cleanup.
- Không stage/commit/push; checkout có thay đổi song song ngoài apps/web.

#### 12. Tham chiếu

- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Task 20.
- `docs/superpowers/specs/workflow-service-spec.md` — Workflow V1 node/definition contract.
- `apps/web/test-results/workflow-catalog-v1-condit-fcf98-rvive-editor-reload-mapping-chromium/workflow-condition-v1.png` — ignored browser screenshot.

#### 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-23 20:27 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; chỉ phần web scope được ghi trong mục 8, các thay đổi khác thuộc worker song song. |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex GPT-6 worker |
| Cần đọc trước khi tiếp tục | Mục 9 (kiểm chứng/giới hạn) và Task 20 trong plan. |
---

### Source record: 2026-09-23-workflow-service-task-21.md


#### 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ | `Asia/Saigon` |
| Dự án / repository | `Weav` (`T:\Weav`) |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex worker — Task 21 |
| Người review / nhận bàn giao | Root agent |
| Trạng thái | Đang chờ review; live Gateway stack chưa kiểm tra |
| Phạm vi | Workflow V1 acceptance, runtime configuration, operational docs |
| Liên kết | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, `docs/superpowers/specs/workflow-service-spec.md` |

#### 2. Tóm tắt

##### Kết quả chính

- Added real HTTP + PostgreSQL + RabbitMQ acceptance over manual, webhook, schedule, immutable publication, pause/resume, multi-root branching/join, version pinning, capability boundaries, and connection-usage HTTP.
- Added safe contract fixtures and a Gateway smoke script that requires an explicit disposable-workspace switch, reads a process-only access token, and never prints token or one-time webhook credentials.
- Wired Workflow limits and service keys through `application.properties`, `.env.example`, and the dev Compose overlay. Readiness now includes PostgreSQL and RabbitMQ while liveness remains process-local; health details are hidden.
- Updated Workflow operational and HTTP contract docs. Existing runtime metrics are not exposed; the README names persisted evidence and present warning events without claiming missing counters.

##### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Build / compile | PASS | Workflow `verify` compiled main/test sources and packaged the executable JAR |
| Unit / integration test | PASS | Full Workflow `verify`: 354 tests, 0 failures/errors/skips; includes Testcontainers PostgreSQL/RabbitMQ acceptance |
| Workspace inter-service/security selectors | PASS | Task 21 selector set: 63 tests, 0 failures/errors/skips |
| Migration / database | PASS | Acceptance context migrated schema through V4 on its disposable PostgreSQL container |
| Health check | PASS | Acceptance HTTP verifies health, readiness, and liveness return 200 without components or service keys |
| Script and contract fixtures | PASS | PowerShell AST parser and JSON parsing for schema + all three examples passed; service acceptance consumed the fixtures and Workspace contract selector parsed OpenAPI |
| Compose validation | Chưa chạy | Docker, docker-compose, and Podman commands are unavailable; Testcontainers reached the Docker Desktop named pipe |
| Live Gateway stack | Chưa chạy | `WORKFLOW_TEST_ACCESS_TOKEN`, `WORKFLOW_TEST_WORKSPACE_ID`, and `WORKFLOW_GATEWAY_URL` were absent from process environment |
| Diff check | PASS | `git diff --check` returned no errors |
| Commit / PR | Chưa tạo | No stage, commit, or push per task instructions |

#### 3. Mục tiêu và phạm vi

##### Trong phạm vi

- Workflow service Testcontainers acceptance test and public contract fixtures.
- Root Gateway smoke script, Workflow README and contract docs, runtime property/env wiring, `.env.example`, `compose.dev.yml`, and K member log.

##### Ngoài phạm vi

- `apps/web` Task 20, Gateway Task 19 source, OCR implementation, NodeExecutorRegistry, migrations, and production data were not changed.
- No live Gateway/Identity/Workspace/Workflow stack credentials or disposable Workspace were available.

##### Tiêu chí hoàn thành

- [x] Persisted HTTP acceptance for trigger lifecycle, parallel branch/join states, immutable versions, and connection usage.
- [x] Configuration and operations documentation use named nonsecret placeholders and preserve disabled integration gates.
- [x] Full Workflow `verify`, focused Workspace contract/security selectors, script parser, and fixture checks pass.
- [ ] Docker Compose config and authenticated live Gateway smoke remain for an environment with Docker CLI, a controlled stack, and short-lived test access.

#### 4. Bối cảnh và quyết định

- **Nguồn sự thật:** Task 21 plan and Workflow Service spec. Test fixtures under `packages/contracts/http/workflow/examples` are public inert samples; automated tests substitute the HTTP condition to prove the active parallel branch without making outbound network requests.
- **Test isolation:** Random workspace IDs and Testcontainers keep state out of production. V1 has no workflow-delete endpoint, so the external smoke script requires `-ConfirmDisposableWorkspace` and records created IDs only.
- **Secrets:** `.env.example` keeps all service keys, JWT signing material, and OCR signing file path empty. The script reads `WORKFLOW_TEST_ACCESS_TOKEN` from process environment and does not write or print it.
- **GitNexus:** `impact(OutboundHttpProperties, upstream)` returned `UNKNOWN` because the local index uses Ladybug storage v43 while the installed runtime is v42. Source inspection confirmed the configuration-properties prefix and setters. This change adds property bindings and does not edit the Java symbol.

#### 5. Thay đổi

| File | Thay đổi |
| --- | --- |
| `services/workflow-service/src/test/java/com/weav/workflow/acceptance/WorkflowV1AcceptanceTest.java` | Real HTTP + Testcontainers tests: v1/v2 queued version pinning, pause/resume, webhook secret storage/404 behavior, paused schedule suppression, manual/webhook/schedule runs, condition branches and join attempts, capability and workspace scoping, hidden health details, fail-closed dependency, and draft/version connection usage. |
| `packages/contracts/http/workflow/examples/manual-http-condition.json` | Safe false branch by default for manual Gateway smoke; graph has manual/webhook/schedule roots, two parallel HTTP nodes, condition, inactive path, and join. |
| `packages/contracts/http/workflow/examples/google-sheets-read.template.json` | Google Sheets sample with explicit connection and spreadsheet replacement placeholders. |
| `packages/contracts/http/workflow/examples/manual-unconfigured-dependency.json` | Public inert fail-closed Email dependency sample. |
| `scripts/test-workflow-v1.ps1` | Gateway smoke; validates create/draft/list/publish/admission/SUCCESS/branch state and prints safe IDs/correlation only. Requires a disposable workspace and process env token. |
| `services/workflow-service/src/main/resources/application.properties` | Hide health details, readiness checks DB + Rabbit, keep liveness local, expose ingress limits and outbound HTTP bounds. |
| `services/workflow-service/src/test/resources/application.properties` | Match safe health detail/readiness settings; existing OCR test gates remain disabled. |
| `.env.example`, `compose.dev.yml` | Add nonsecret Workflow limits, Workspace client settings, worker/outbox/schedule settings, outbound bounds, and closed OCR defaults. Keys remain empty placeholders. |
| `services/workflow-service/README.md` | Runtime config, security, readiness, recovery, side-effect semantics, integration matrix, observability limits, and local smoke instructions. |
| `packages/contracts/http/workflow/README.md`, `openapi.yaml` | Mark webhook/schedule implementation live; describe one-time secrets, generic 404, schedule coalescing; correct local Workflow server port to 8080. |

#### 6. Verification evidence

| Check | Command / action | Result |
| --- | --- | --- |
| Workflow verify | `Set-Location services/workflow-service`; `$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'`; cached Maven 3.9.16 with `-Dmaven.repo.local=C:\Users\nhoan\.m2\repository verify` | PASS, `Tests run: 354, Failures: 0, Errors: 0, Skipped: 0`; executable JAR packaged; Testcontainers connected through Docker Desktop named pipe |
| Workspace inter-service/security selectors | `Set-Location services/workspace-service`; cached Maven 3.9.16 with UTC and `-Dtest=WorkspaceHttpSecurityIntegrationTest,WorkspaceConnectionHttpIntegrationTest,InternalConnectionUseCasesTest,ConnectionUsageProtectionTest,WorkflowContractValidationTest test` | PASS, `Tests run: 63, Failures: 0, Errors: 0, Skipped: 0` |
| Script and fixtures | PowerShell `Parser.ParseFile` for `scripts/test-workflow-v1.ps1`; `ConvertFrom-Json` for Workflow schema and all JSON examples; covered fixtures in Workflow acceptance and OpenAPI in `WorkflowContractValidationTest` | PASS; schema and three examples parse, acceptance and contract tests pass |
| Compose tool check | `Get-Command docker,docker-compose,podman -ErrorAction SilentlyContinue`; checked standard Docker Desktop CLI paths | No Compose-capable CLI found; no installation or runtime changes attempted |
| Live config check | `Test-Path Env:WORKFLOW_TEST_ACCESS_TOKEN`, `...WORKFLOW_TEST_WORKSPACE_ID`, `...WORKFLOW_GATEWAY_URL` | All false; no live Gateway request attempted |
| Git diff | `git diff --check` | PASS |

The repository's `mvnw.cmd` wrapper did not start in this managed PowerShell shell (`Cannot start maven from wrapper`); the runs used the installed cached Maven binary and existing local Maven repository. An initial sandboxed compiler attempt was denied while resolving a cached Tomcat JAR; the full `verify` then passed with Maven cache access enabled. No Maven process remains active, and the Task20 peer confirmed its Maven slot was free.

#### 7. Risks and blockers

| Mức độ | Vấn đề | Bằng chứng | Bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | Compose interpolation was not validated with Docker Compose | Docker CLI absent, although Java Testcontainers connected to the Docker Desktop daemon | Run `docker compose --env-file .env.example -f compose.yml -f compose.dev.yml config --quiet` when CLI is installed |
| Trung bình | Authenticated Gateway-to-Workflow smoke was not run | No controlled Gateway URL, workspace UUID, or process token was provisioned | Run script only against a controlled disposable Workspace with a short-lived scoped token |
| Thấp | Workflow-specific Micrometer metrics do not exist | Source search found no `MeterRegistry`/counter/gauge instrumentation; actuator exposes only health/info | README documents persisted evidence and existing warnings; add instrumentation in a separately scoped task before production dashboards |

#### 8. Trạng thái bàn giao

- Ready for root review. The full Workflow `verify` passed 354/354 after the health configuration changes, and the focused Workspace inter-service/security selectors passed 63/63.
- No files were staged or committed. Shared worktree remains dirty with other task owners' changes; this log describes Task 21 files only.

#### 9. Scratch report

Detailed compact handoff is stored at `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-21-report.md`. The path is ignored by `.superpowers/sdd/.gitignore` and must remain untracked.

#### 10. Kết thúc

| Trường | Giá trị |
| --- | --- |
| Thời điểm bàn giao | `2026-09-23 20:05 Asia/Saigon` |
| Worktree | Dirty shared branch; Task 21 changes uncommitted |
| Commit / PR | Chưa tạo |
| Người cập nhật | Codex worker — Task 21 |
| Cần đọc trước khi tiếp tục | This log, Workflow Task 21 section in the plan, and the acceptance test |
---

### Source record: 2026-09-23-workflow-service-direct-smoke.md


#### 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-23 / Asia/Saigon |
| Repository / branch | Weav / `feature/workflow-service` |
| Owner / reviewer | Codex coordinator / user |
| Status | Workflow direct live smoke passed; Gateway handoff pending partner |
| Scope | Workflow-only smoke tooling, plan scope note, and verification |

#### 2. Outcome

- User moved Gateway integration to their partner. The earlier Task 19 Gateway changes were discarded by the user; this session did not edit those shared files. The plan now labels Task 19 as partner-owned.
- Reworked `compose.workflow-smoke.yml`, `scripts/start-workflow-v1-live-smoke.ps1`, `scripts/test-workflow-v1.ps1`, and the Workflow README local acceptance section to call Workflow Service directly. No Gateway container is started by the smoke.
- Direct live acceptance passed with Identity registration/OTP/login, public Workspace creation, Workflow draft create/save/get/list, publish, manual execution admission, and persisted successful node states. The safe fixture skipped both outbound HTTP nodes and the join; reported outbound HTTP calls: zero.
- Isolated Compose project, network, containers, and RabbitMQ volume were removed after the pass. Test schemas and their records remain in the shared databases for explicit review; the helper never drops schemas.

#### 3. Decisions and boundaries

- Local smoke uses service-specific test schemas, process-only credentials, loopback ports, local Valkey/RabbitMQ/Mailpit, and direct Neon endpoints for test processes because the configured pooled hosts did not accept the bootstrap search-path setting. Root `.env` was not edited or printed.
- The partner owns Gateway routes, tests, and contract. Gateway forwarding is not included in the Workflow completion claim. Earlier Gateway test results remain historical evidence only.
- PowerShell's omitted typed `Body` parameter was interpreted as an empty string. The smoke now checks whether the parameter was bound before attaching a request body, fixing the GET `ProtocolViolationBodyOnVerb` failure. A temporary connection-closing change was reverted after diagnosis.

#### 4. Changed files

| File | Change |
| --- | --- |
| `compose.workflow-smoke.yml` | Removed Gateway service; exposed Workflow on a random loopback-only port. |
| `scripts/start-workflow-v1-live-smoke.ps1` | Validates/starts the Workflow-only stack and calls the direct service smoke. |
| `scripts/test-workflow-v1.ps1` | Uses `-WorkflowUrl` and service paths, fixes bodyless GET, retains redacted failure classification. |
| `services/workflow-service/README.md` | Documents direct Workflow acceptance and retained schema cleanup policy. |
| `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` | Marks Gateway as partner-owned and direct service smoke as this branch's gate. |

#### 5. Verification

| Check | Result |
| --- | --- |
| PowerShell parse of both scripts | PASS |
| `start-workflow-v1-live-smoke.ps1 -ValidateOnly` | PASS; no schema/container creation |
| `start-workflow-v1-live-smoke.ps1 -TestSchemaSuffix '20260923_a256bb0427d1'` | PASS; create 201, draft/get/list/publish 200, admission 202, detail 200, execution SUCCESS |
| Node states | `condition` and `inactive-branch`: SUCCESS, 1 attempt; `left-http`, `right-http`, `join-http`: SKIPPED, 0 attempts |
| Compose cleanup | PASS; project `weav-workflow-smoke-20260923-17e274c98b1e` and its volume removed |
| `git diff --check` | PASS; existing LF/CRLF notices only |
| Existing Workflow/Workspace/web suites | Prior results recorded in `2026-09-23-workflow-service-smoke-handoff.md`; not rerun for this test-tooling change |

The passing run retained these task-owned schemas: `weav_workflow_smoke_identity_20260923_a256bb0427d1`, `weav_workflow_smoke_workspace_20260923_a256bb0427d1`, and `weav_workflow_smoke_workflow_20260923_a256bb0427d1`. Earlier failed/bootstrap attempts and their possible schema names are recorded in `2026-09-23-workflow-service-live-smoke.md`; check exact ownership and existence before any manual cleanup. No schema was dropped in this session.

#### 6. Handoff

- Workflow Service's direct runtime path is verified. The partner still needs to integrate and test Gateway forwarding against it.
- Real provider Sheets/OCR acceptance remains gated by approved credentials/contracts; disabled adapters are not claimed as operational.
- The branch remains uncommitted. GitNexus change detection remains unresolved because the local index storage version does not match the installed engine; do not commit until that gate passes.
---

### Source record: 2026-09-23-workflow-service-live-smoke.md


#### 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-23 / Asia/Saigon |
| Repository / branch | Weav / `feature/workflow-service` |
| Owner / reviewer | Codex worker / coordinator |
| Final status | Blocked before application startup |
| Scope | Isolated local smoke tooling and attempted live Workflow acceptance |

#### 2. Outcome

- Added a dedicated Compose file and PowerShell launcher for the real Identity → Workspace → Gateway → Workflow acceptance path. The launcher uses new random database schema names, loopback-only ports, local Valkey/RabbitMQ/Mailpit, and generated process-only credentials.
- PowerShell syntax and the isolated Compose model passed validation. Source and migration inspection found schema selection through `DB_SCHEMA`/JDBC `currentSchema`, with no hardcoded Identity, Workspace, Workflow, or `public` relation qualifiers in the reviewed application paths.
- The live run stopped at Identity schema bootstrap. The PostgreSQL client exited with status 2; a separate read-only `SELECT current_schema()` probe also exited 2. PostgreSQL documents status 2 as a failed connection for a non-interactive session. No application container, API account/workspace, or Gateway workflow was started.

#### 3. Scope and decisions

##### In scope

- `compose.workflow-smoke.yml`
- `scripts/start-workflow-v1-live-smoke.ps1`
- The Workflow README local-acceptance section
- This new K work log

##### Out of scope

- Application business code, migrations, root `.env`, the existing acceptance script, other work logs, and the member T logs.
- Stage, commit, push, external AI CLI use, or further agents.

##### Isolation decisions

- Reuse the authorized root database connections only with freshly generated service-specific schemas. Bootstrap is the only database operation; it creates a schema and asks `current_schema()` to verify the search path before app startup.
- Never fall back to default schemas. Stop if a schema connection or verification fails.
- Use local broker/cache/email services, and do not send mail outside the local sink.
- Retain any created test schema for coordinator cleanup review; never drop database schemas from this helper.

#### 4. Changes

| File | Change |
| --- | --- |
| `compose.workflow-smoke.yml` | Added isolated schema-bootstrap profiles and the minimal local Workflow smoke services with project-scoped resources and loopback bindings. |
| `scripts/start-workflow-v1-live-smoke.ps1` | Added safe Compose validation, unique schema generation, local-service/API smoke orchestration, secret-suppressed diagnostics, and cleanup after Compose resource attempts. |
| `services/workflow-service/README.md` | Documented the isolated live acceptance launcher and the existing direct Gateway smoke entry point. |
| `docs/work_logs/K/2026-09-23-workflow-service-live-smoke.md` | Recorded this attempt, its evidence, and the blocker. |

#### 5. Verification

| Check | Command / evidence | Result |
| --- | --- | --- |
| PowerShell parse | `[void][scriptblock]::Create((Get-Content .\scripts\start-workflow-v1-live-smoke.ps1 -Raw))` | PASS |
| Smoke Compose config | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-workflow-v1-live-smoke.ps1 -ValidateOnly` | PASS; standalone config, schema-bootstrap profile, resolved service routing, and loopback/resource assertions; no schema or container created. |
| Repository Compose overlay | `docker compose --env-file .env -f compose.yml -f compose.dev.yml --profile app config --quiet` | PASS; no services started and resolved values were not printed. |
| Live database bootstrap | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-workflow-v1-live-smoke.ps1` | BLOCKED at `schema-bootstrap-identity`; `psql` exit 2. |
| Read-only connection probe | `SELECT current_schema()` with the generated test schema first in `search_path` | BLOCKED; `psql` exit 2, so schema isolation could not be established. |
| Docker cleanup | Inspected project-labeled networks and removed only unattached networks from this task’s smoke/probe projects | PASS; 4 removed, 0 attached. No app service or volume was started. |
| Existing automated suites | Prior results recorded in `2026-09-23-workflow-service-smoke-handoff.md` | Not rerun; this slice changed test tooling and documentation only. |
| Diff check | `git diff --check` plus a trailing-whitespace scan of the four owned files | PASS; Git emitted only existing LF/CRLF notices for unrelated `.env.example` and Workflow application property files. |

The PostgreSQL exit status is documented at [psql exit status](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-EXIT-STATUS). The connection attempt failed before application startup; no normal-schema fallback or table read/write was performed.

#### 6. Database and local-resource state

Identity schema names attempted, with creation status unconfirmed because the database connection could not be established or verified:

- `weav_workflow_smoke_identity_20260923_be8760492d00`
- `weav_workflow_smoke_identity_20260923_25bd95e0888a`
- `weav_workflow_smoke_identity_20260923_c9ac2730e1e5`
- `weav_workflow_smoke_identity_20260923_1f1ae75c5636`

Workspace and Workflow schema bootstrap did not run. No schema was intentionally dropped. Review the four Identity names before any cleanup; do not assume their creation state from the helper’s `confirmedSchemas=none` field alone.

Compose projects used for failed bootstrap attempts were `weav-workflow-smoke-20260923-be8760492d00`, `weav-workflow-smoke-20260923-25bd95e0888a`, `weav-workflow-smoke-20260923-c9ac2730e1e5`, and `weav-workflow-smoke-20260923-1f1ae75c5636`. A separate read-only probe project used the `weav-workflow-schema-probe-` prefix. The exact probe suffix was not retained; its project-labeled network was included in the cleanup sweep. Four unattached networks were removed, and no attached containers remained. No application service, RabbitMQ volume, local port binding, SMTP message, test account, workspace, or Workflow record was created by the live attempt.

#### 7. Blocker and handoff

The isolated Identity bootstrap could not establish a PostgreSQL connection (`psql` exit 2), and the read-only schema-path probe failed the same way. The server’s exact connection cause is not established; do not infer a schema-permission failure. Do not proceed until a coordinator can verify the authorized database connectivity path. The helper should then be rerun with new unique schemas; review the four names above for possible partial creation before cleanup.

The repository was not committed. GitNexus change analysis remains unresolved per the existing handoff because the local index storage version does not match the installed engine.
---

### Source record: 2026-09-24-workflow-service-release-review.md


#### 1. Metadata and scope

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-24 / Asia/Saigon |
| Repository / branch / base commit | Weav / `feature/workflow-service` / `c836de2` |
| Owner | Codex coordinator |
| Status | Workflow-only release review completed; pre-commit gate checked |
| Reviewed scope | Workflow authoring, publication, execution, persistence, security, Workspace connection contract, and V1 web catalog/builder |
| Excluded by user | API Gateway and Notification source/release gates; OCR production activation review |

#### 2. Outcome and decisions

- No concrete Workflow-core defect was found in the reviewed publication, admission, execution, security, connection-usage, and migration paths. This is a review result, not proof that every possible provider or production path works.
- The direct Workflow live smoke from `2026-09-23-workflow-service-direct-smoke.md` passed against isolated schemas on the shared project database. It covered create, save, list/get, publish, manual admission, persisted execution success, and expected branch skips with zero outbound HTTP calls. Those test schemas remain for explicit cleanup; this review did not modify them.
- The V1 builder work is catalog/configuration alignment. The existing local-storage builder is not connected to the Workflow backend in Task 20; do not claim browser authoring-to-server publication is delivered.
- No code or migration was changed during the review. The two new-document whitespace findings were corrected before staging. No PR was created.

#### 3. Verification

| Check | Result | Limit |
| --- | --- | --- |
| Workflow Surefire reports from fresh test run | 354 tests, 0 failures/errors/skips across 56 suites | Full Maven `verify` process output was not retained; a separate `mvn -DskipTests package` completed successfully and produced the executable JAR. |
| Workspace focused inter-service/security suite | 63 tests, 0 failures/errors/skips, Maven BUILD SUCCESS | First attempt failed because Docker Desktop was stopped; rerun after Docker started passed. |
| Web TypeScript and Vite build | `tsc -b` PASS; `vite build` PASS | Direct installed binaries were used because pnpm attempted a noninteractive dependency purge. |
| Web focused lint | ESLint PASS on changed non-OCR builder/catalog/types and Workflow E2E files | Repository-wide lint was not rerun. |
| Browser | Playwright Chromium 30 passed for Workflow catalog/UI with OCR cases excluded | Real browser in mock API mode; not backend-connected authoring. |
| Direct service live smoke | PASS (prior 2026-09-23 session, cited above) | Controlled fixture did not call real providers. |
| Staged diff whitespace | `git diff --cached --check` PASS | All 241 intended files staged; the Gateway handoff log remains untracked. |
| GitNexus `detect_changes(scope=all)` and CLI rerun | 3,216 changed symbols, 157 affected processes, 241 files, `critical` | Symbol listing was capped at 1,000, but summary counts covered the full staged set. Publication, admission, mapping, execution, and security paths were manually inspected and tested. |
| Staged file/secret scan | No Gateway/Notification paths, `.env`, build output, or known credential shapes staged | PEM markers found only in parser code and tests generating temporary keys. OCR client remains disabled by default. |

#### 4. Review evidence and risks

- Publication validates and authorizes the draft, locks the workflow, snapshots an immutable version, updates the current pointer and trigger registrations in one transaction; concurrent publication/version pinning has a dedicated integration test.
- Manual/automatic admission locks the owning workflow, checks published/active registration and current version, and writes execution, node rows, and outbox intent atomically. Runner writes use a fenced lease and persisted node/attempt transitions. The direct smoke and Testcontainers suite exercise this path.
- JWT and internal-key boundaries, bounded Workspace responses, fail-closed connection authorization/resolution, and connection-usage semantics were inspected. V2–V4 migrations are additive; V4 explicitly fails on pre-existing duplicate webhook keys instead of silently changing them.
- Stored immutable versions count as connection usage even after workflow soft deletion, matching the user's decision. An unknown connection with no references returns `200 {"inUse":false}` under the clarified contract.
- Real Google Sheets provider acceptance, production observability counters/dashboards, and backend-connected browser authoring remain unverified or outside the V1 builder slice. Gateway and Notification were excluded. The staged Workflow OCR adapter is disabled by default; OCR production activation was not reviewed at the user's request.
- GitNexus reports `critical` blast radius because this milestone adds major execution paths; this is not evidence of a failing test or concrete defect. The listing cap prevents claiming every changed symbol was individually inspected. Preserve the excluded Gateway handoff file and any user-owned files.

#### 5. Handoff

1. Commit the staged Workflow milestone after confirming the final staged log update; do not push automatically.
2. If production activation is desired, separately verify real provider credentials and monitoring; the current evidence covers the controlled runtime and closed dependency gates.
3. Preserve the retained shared-database test schemas until their exact ownership and cleanup are approved.

No secrets, token values, raw connection strings, or personal data were recorded.
