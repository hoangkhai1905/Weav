# Nhật ký ngày `2026-09-24` — Workflow Service merge và Web integration

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày / múi giờ | `2026-09-24` / `Asia/Saigon` |
| Repository | `Weav` |
| Nhánh kiểm tra | `codex/workflow-service-merge-check` |
| Điểm bắt đầu / nguồn | `api-gateway` @ `7e14de0` / `origin/feature/workflow-service` @ `688eb6d` |
| Người thực hiện / reviewer | Worker / User |
| Trạng thái | Sẵn sàng review; merge chưa commit |
| Phạm vi | Merge cô lập Workflow Service và nối Web Workflow/Executions tới Workflow API V1 |

## 2. Tóm tắt điều hành

- Merge `origin/feature/workflow-service` vào worktree cô lập từ `api-gateway`; merge sạch, không conflict. Checkout ban đầu `D:\End\Weav` không bị sửa.
- Web gọi API thật theo mặc định; mock canvas/API chỉ hoạt động khi `VITE_API_MODE=mock`. Workflow list/builder/draft/publish/pause/resume/run và executions/history/detail dùng contract V1.
- Xác nhận runtime bằng Docker Java `25.0.4`: readiness Identity/Workspace/Workflow `200`; Gateway auth/workspace và Workflow V1 smoke đi qua API thật.
- Chromium live browser, `VITE_API_MODE=http`, Vite proxy trỏ Gateway Docker, không `page.route`: create `201` → save `200` → publish `200` → manual run `202` → history `200` → detail `200/SUCCESS`. Execution chỉ có manual trigger; không gọi OCR/AI hoặc outbound HTTP.
- Maven full suite đã được phân loại cụ thể: 116 lỗi Testcontainers do container test không discover được Docker; 1 lỗi và 1 failure khác do Docker build context không có `packages/contracts`. Focused Java 25 suite với contracts mount read-only PASS `226/226`; full suite vẫn chưa PASS.
- Không thay đổi mobile. Tạo ba schema Neon có tên smoke ngẫu nhiên riêng và dữ liệu acceptance trong đó; giữ schema/volume để review, không reset DB hoặc xóa volume.
- Chưa commit: merge và phần tích hợp để ở worktree riêng cho user review; chưa chạy GitNexus detect-changes vì index chỉ có ở checkout ban đầu vốn đang dirty và command đó sẽ không đại diện cho diff cô lập.

## 3. Phạm vi, tiêu chí và quyết định

### Trong phạm vi

- Workflow Service, contract/OpenAPI và API Gateway proxy được đưa vào nhánh kiểm tra.
- Tích hợp Web Workflow list, builder, workflow create/save/publish/status/manual run, execution history và execution detail.

### Ngoài phạm vi

- Mobile, triển khai service/DB, live OCR/AI/Bot flows, production credentials và commit/PR.

### Quyết định

| Quyết định | Lý do | Hệ quả |
| --- | --- | --- |
| Dùng worktree riêng | Checkout người dùng đang có nhiều thay đổi chưa commit | Review tại `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav`; không merge vào checkout dirty |
| API thật mặc định; mock chỉ explicit | Không để mock che lỗi backend | `VITE_API_MODE=mock` giữ demo/test; mode mặc định gọi gateway thật |
| Không có nút Cancel thật | Workflow V1 hiện không có cancel endpoint | UI không giả lập hủy execution |
| Danh sách executions toàn cục gom từ workflow | Contract V1 chỉ có executions dưới từng workflow | Màn global giới hạn 100 lượt gần nhất mỗi workflow và ghi rõ giới hạn; màn theo workflow tự refresh mỗi 5 giây |

## 4. Contract V1 đã nối

- `POST/GET /api/v1/workspaces/{workspaceId}/workflows`
- `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}`
- `PUT .../{workflowId}/draft`; `POST .../{workflowId}/publish|pause|resume`
- `POST .../{workflowId}/executions` với `{ "input": {} }`; trả receipt `202/QUEUED`
- `GET .../{workflowId}/executions?page=&size=`; `GET .../{workflowId}/executions/{executionId}?logPage=&logSize=`
- Workspace được lấy từ Workspace API và lựa chọn `weav_active_workspace_id`; không gửi workspace giả `ws-main` trong real mode.
- Draft lưu executable `definition` tách khỏi `editorState` (tên/vị trí node). Webhook secrets từ publish chỉ giữ trong memory để hiển thị một lần.

## 5. Thay đổi chính

- `services/api-gateway/src/workflow/workflow.module.ts`, `services/api-gateway/src/app.module.ts`, `services/api-gateway/src/workflow/workflow.module.spec.ts`: proxy và test cho Workflow Service.
- `apps/web/src/api/workflow-v1.api.ts`, `workflow.api.ts`, `execution.api.ts`: client/adapters thật, map response/request V1; lỗi API không fallback âm thầm sang mock.
- `apps/web/src/pages/WorkflowsPage.tsx`, `CreateWorkflowPage.tsx`, `WorkflowBuilderPage.tsx`: màn Workflow dùng dữ liệu API; mock canvas preset chỉ bật trong mock mode; ID node mới tránh trùng node đã tải.
- `apps/web/src/pages/LiveWorkflowExecutionsPage.tsx`, `LiveExecutionDetailPage.tsx` và wrapper pages: history/detail thật, rerun gọi manual execution API, logs/nodes từ API.
- `apps/web/e2e/workflow-api-v1.spec.ts`: browser contract tests có route fixtures; không thay cho live service test.
- `apps/web/playwright.config.ts`: test server cổng riêng `4175`, không tái sử dụng server dev đang chạy của user.

## 6. GitNexus và bảo toàn thay đổi

- Impact trước sửa: `WorkflowBuilderPage`, `WorkflowsPage`, `CreateWorkflowPage`, `ExecutionsPage`, `ExecutionDetailPage` LOW; `useAuthStore` HIGH, nên store dùng chung đó không bị sửa.
- Checkout gốc giữ nguyên branch `api-gateway` và thay đổi người dùng. Merge không conflict nhưng đang ở trạng thái `--no-commit` trên worktree riêng.
- Chưa commit, vì vậy chưa chạy `detect_changes`; không dùng index của checkout gốc để khẳng định graph diff cho worktree.

## 7. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| Docker images / Java | `docker compose ... build workflow-service api-gateway`; `docker compose ... run ... java -version` | PASS; Workflow image chạy OpenJDK `25.0.4`; Workflow, Gateway image build thành công | Dùng project/worktree cô lập; không dùng JDK local |
| Web build + TypeScript | `pnpm --dir apps/web run build` | PASS; bundle JS `1,025.12 kB` minified, cảnh báo >500 kB | Lần chạy đầu bị EPERM ở TypeScript cache; elevated rerun thành công; không sửa source |
| API contract Playwright fixtures | `VITE_API_MODE=http; VITE_API_GATEWAY_URL=http://127.0.0.1:1; pnpm --dir apps/web exec playwright test e2e/workflow-api-v1.spec.ts --project=chromium --workers=1 --reporter=line --output=.pw-rerun-workflow-api-serial` | PASS 4/4 | Fixture tests, không phải live service E2E; gateway proxy cố ý unreachable để bảo đảm requests phải được route fixture xử lý. Lượt 4-worker trước đó có 3 lỗi test/harness và 1 pass; chưa xác định root cause chung ngoài việc serial rerun sạch |
| Mock UI/catalog regression | `VITE_API_MODE=mock; pnpm --dir apps/web exec playwright test e2e/workflow-ui.spec.ts e2e/workflow-catalog-v1.spec.ts --project=chromium --workers=1` | 32/33 PASS; 1 FAIL | `shows an active connection while previewing an edge`: máy có `prefers-reduced-motion=reduce`, component chủ động bỏ preview animation; test không override media preference. Không sửa test/source trong phạm vi này |
| API Gateway | focused Jest 4/4; Gateway build | PASS | Bằng chứng từ bước kiểm tra Gateway trong session này |
| Maven full suite (Docker Java 25) | `./mvnw -B -DtrimStackTrace=false test` trong container | Compile PASS (`--release 25`); `354 run, 1 failure, 117 errors, 3 skipped` | 116 errors: Spring contexts dùng PostgreSQL/Rabbit Testcontainers; representative chain `workflowDraftPostgres → GenericContainer.start → DockerClientProviderStrategy` báo không tìm thấy Docker environment. Không mount host Docker socket/privileged DinD theo giới hạn an toàn |
| Maven non-Docker errors | Surefire XML/stack traces trong `services/workflow-service/target/maven-diagnostic/` | 1 error: `OcrClientContractTest.postsPrivateServiceJwtRequestAndReturnsCheckedContractFixture` thiếu `../../packages/contracts/http/ocr/examples/success-with-tables.json`; 1 failure: `DefinitionJsonCodecTest.schemaListsTheSameCatalogAndDraftBoundsAsTheJavaValidator` thiếu `/app/../../packages/contracts/http/workflow/definition.schema.json` | Cùng nguyên nhân cấu hình: Docker build context `services/workflow-service` chỉ copy `.mvn`, wrapper, `pom.xml`, `src`, không có `packages/contracts`; focused test mount contracts read-only đã kiểm chứng hai test này pass |
| Maven focused tests | Docker Java 25 container, Maven offline với explicit `-Dtest` allowlist; contracts mount read-only, network disabled | PASS `226 tests, 0 failures, 0 errors, 0 skipped` | Không bao gồm integration cần Docker daemon; không đại diện cho full suite. Surefire output nằm trong ignored `services/workflow-service/target/maven-diagnostic/` |
| Docker readiness | GET Mailpit `/api/v1/info`; Identity/Workspace/Workflow `/actuator/health/readiness` | Tất cả HTTP `200`; RabbitMQ/Valkey Compose health `healthy` | Môi trường cô lập, các service đã dừng sau smoke |
| Live auth/workspace qua Gateway | Register/login/OTP/workspace create/list | `201 / 200 / 202 / 200 / 200 / 201 / 200` | Tài khoản/workspace disposable trong schema test riêng; secrets không ghi lại |
| Live Workflow API qua Gateway | Create, save draft, detail, list, publish, manual admission, execution detail | `201 / 200 / 200 / 200 / 200 / 202 / 200`; execution `SUCCESS`; HTTP nodes bị skip, outbound HTTP calls `0` | Fixture được xác nhận có false branch an toàn |
| Live history/detail qua Gateway | GET executions history + GET execution detail | HTTP `200 / 200`; execution có trong history ở `SUCCESS`, version pin khớp | Đã kiểm tra response service thật, không dùng fixture |
| Browser Playwright live full flow | Chromium, `VITE_API_MODE=http`, `VITE_API_GATEWAY_URL=http://127.0.0.1:52509`; không đăng ký `page.route` | PASS: auth/workspace setup qua Gateway; UI create `201`, save draft `200`, publish `200`, run `202`, history GET `200`, detail GET `200`; detail UI/API `SUCCESS`, manual node `SUCCESS`, attempt `0` | Đọc trạng thái ở detail sau đó; run còn `RUNNING` tại lần poll đầu trong 60 giây rồi hoàn tất `SUCCESS`. `GET /api/notifications/unread-count` ngoài phạm vi trả `503` vì Notification không nằm trong smoke stack; Workflow API đều thành công |
| `git diff --check` + `git diff --cached --check` | Chạy trong worktree sau thay đổi | PASS; không có whitespace errors | Kiểm tra cả phần tích hợp và merge staged |

## 8. Rủi ro / việc tiếp theo

- Maven suite tổng thể chưa xanh: 116 Testcontainers errors cần runner được cấp Docker/Testcontainers theo chính sách an toàn; không mount host socket hoặc bật privileged DinD. Còn 1 fixture error + 1 schema-test failure do Docker context thiếu shared contracts; đây là vấn đề cấu hình/build context, chưa sửa vì chưa có impact analysis và regression change trong phạm vi xác minh.
- Browser Vite mặc định proxy `localhost:3000`; để test smoke stack phải set `VITE_API_GATEWAY_URL=http://127.0.0.1:52509`. Nếu không, FE bị đưa về `/login` trước khi gọi Workflow API. Notification `503` cần Notification service nếu muốn browser console sạch toàn hệ thống; không ảnh hưởng Workflow path đã xác minh.
- Playwright mock regression còn 1 test motion nhạy với OS reduced-motion preference; nên làm test deterministic bằng cách set `page.emulateMedia({ reducedMotion: 'no-preference' })` trong test đó (hoặc kiểm tra trạng thái reduced motion) khi người dùng yêu cầu chỉnh test.
- Global executions hiện cần tải workflow list rồi tối đa 100 summaries cho từng workflow; nếu workspace lớn, nên bổ sung endpoint global/pagination ở service thay vì mở rộng fan-out phía browser.
- Cảnh báo chunk >500 kB hiện có thể ảnh hưởng tải bundle; chưa tối ưu vì nằm ngoài phạm vi.
- Reviewer kiểm tra merge + diff trong worktree cô lập; sau khi chấp thuận, chạy GitNexus `detect_changes` trên đúng repo/index trước commit.

### Runtime smoke resources được giữ lại

- Neon schemas tạo cho lần smoke: `weav_workflow_smoke_identity_20260924_69b1d074d172`, `weav_workflow_smoke_workspace_20260924_69b1d074d172`, `weav_workflow_smoke_workflow_20260924_69b1d074d172`. Chúng còn một số user/workspace disposable (gồm partial auth attempts), workflow và execution; giữ nguyên để review, không xóa schema/reset DB.
- Đã stop các container `weav-workflow-browser-review-*` và Vite; volume không bị xóa. `weav-rabbitmq` gốc vẫn `Up (healthy)`. Không dùng `down --volumes`; ba thư mục output Playwright do lần xác minh này tạo đã được dọn khỏi worktree.
- Lần ghép compose gốc có static container name `weav-rabbitmq` bị Docker từ chối vì trùng container gốc; chuyển qua `compose.workflow-smoke.yml` độc lập. Container `weav-rabbitmq` gốc vẫn `Up (healthy)`.

## 9. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-24 14:32 Asia/Saigon` |
| Worktree | Có thay đổi chưa commit; merge `--no-commit` |
| Commit / PR | Chưa tạo |
| Người cập nhật | Worker |
| Đọc trước khi tiếp tục | `AGENTS.md`; mục contract/kiểm tra/rủi ro trong log này |

## 10. Follow-up — Docker contract context và Playwright motion

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-24 15:20 Asia/Saigon` |
| Worktree / branch | `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav` / `codex/workflow-service-merge-check` |
| Trạng thái | Hai Workflow contract asset tests đã pass sau cấu hình; motion test pass; 1 test OCR file preview còn fail. Chưa commit/merge. |

### Thay đổi trong lượt này

- `compose.dev.yml` và `compose.workflow-smoke.yml`: thêm named BuildKit context `contracts: ./packages/contracts`; primary build context vẫn là `./services/workflow-service`.
- `services/workflow-service/Dockerfile.dev`: copy named context vào `/packages/contracts/`, đường dẫn mà hai test resolve từ `/app`. Không mở rộng context ra repository root.
- `apps/web/e2e/workflow-ui.spec.ts`: test animation-positive đặt `reducedMotion: 'no-preference'` và đợi đủ 4 edge fixture trước preview. Không đổi component production; test reduced-motion hiện hữu tiếp tục xác nhận không hiện active edge.
- Thêm kế hoạch bounded tại `docs/superpowers/plans/2026-09-24-workflow-contract-fixtures-and-motion-test.md`.

### Red/green và verification

| Hạng mục | Lệnh / thao tác | Kết quả | Giới hạn |
| --- | --- | --- | --- |
| Maven red | Build Docker image từ context `services/workflow-service`, rồi chạy `./mvnw -B -Dtest=DefinitionJsonCodecTest,OcrClientContractTest test` | Java `25.0.4`; `9 tests`: schema test FAIL do thiếu `/packages/contracts/http/workflow/definition.schema.json`, OCR fixture test ERROR do thiếu `packages/contracts/http/ocr/examples/success-with-tables.json` | Chỉ service context; không có DB/RabbitMQ/socket/runtime env |
| Compose dev build | `docker compose -p weav-workflow-context-check -f compose.yml -f compose.dev.yml build workflow-service` | PASS; service context `28.18 kB`; named contracts context `247.48 kB`; `COPY --from=contracts` thành công | Chỉ build image; chưa start service |
| Compose smoke model/build | `docker compose -p weav-workflow-smoke-validation -f compose.workflow-smoke.yml config --quiet` và `... build workflow-service` | PASS; smoke model/build dùng named context thành công | Compose cảnh báo một số biến chưa set trong shell; chỉ in tên biến, không có giá trị secret; không start service |
| Maven affected tests | Java `25.0.4`, Maven offline, container `--network none`, Maven repository/wrapper cache mount read-only; `-Dtest=DefinitionJsonCodecTest,OcrClientContractTest` | PASS `9/9`, `0 failures/errors/skips` | Không host JDK, DB, broker, host socket hoặc runtime env |
| Maven focused suite | Cùng container/cache; 31-class `-Dtest` allowlist gồm cả hai class affected | PASS `226/226`, `0 failures/errors/skips` | Không phải full suite; không gồm integration tests cần Testcontainers daemon |
| Reduced-motion red | Tạm emulated `reducedMotion: 'reduce'`, chạy active-edge test | RED đúng kỳ vọng: không có `execution-edge-active`; app báo reduced-motion preference | Production accessibility behavior được giữ nguyên |
| Motion green | Test emulates `no-preference`, chờ 4 `execution-edge-flow` elements; chạy riêng | PASS `1/1`; test này và reduced-motion counterpart đều PASS trong suite đầy đủ | Test-only change |
| UI/catalog suite | `VITE_API_MODE=mock; pnpm --dir apps/web exec playwright test e2e/workflow-ui.spec.ts e2e/workflow-catalog-v1.spec.ts --project=chromium --workers=1 --reporter=line` | `32/33` PASS | Test `OCR workflow node › adds OCR to the canvas and previews extracted document text` còn FAIL: sau `setInputFiles`, không thấy `invoice.png`. Lỗi tái hiện khi isolate; ngoài phạm vi motion nên chưa sửa. Đây là mock UI test, không phải live E2E |

### Audit và blockers

- Dọn đúng 8 thư mục Playwright output do lượt này tạo; giữ nguyên `apps/web/test-results` và các file/output có trước.
- Không start service container, không mount Docker socket, không tạo/xóa volume, không reset DB/schema. Compose build chỉ tạo image với project name riêng.
- Full Maven suite chưa chạy lại và không được coi là xanh. Run trước đó có 116 lỗi Testcontainers do thiếu Docker discovery; 2 lỗi asset/config đã pass ở focused suite sau fix. Testcontainers cần runner được cấp daemon nếu muốn xác nhận full suite; không mở socket/privileged DinD trong task này.
- GitNexus impact trước sửa: `Dockerfile.dev` LOW/0 dependants; `DefinitionJsonCodecTest` và `OcrClientContractTest` LOW/0 callers; `WorkflowBuilderPage` LOW, một route caller từ `App`. Không đổi component/auth store. Graph query cho flow không trả kết quả do FTS index thiếu, không dùng làm kết luận an toàn.
- Audit Git cuối trong worktree: `git status --porcelain=v1` có 303 mục (287 staged, 13 unstaged, 4 mixed; 8 untracked); `git diff --name-only --diff-filter=U` có 0 unmerged path. Untracked gồm hai file API/Gateway spec/module, ba file FE/API page, cùng plan và work log; không có `.env`/credential hay generated test output trong danh sách. Có cảnh báo Git line-ending `LF will be replaced by CRLF` cho `Dockerfile.dev`, không phải lỗi `diff --check`.
- Checkout gốc `D:\End\Weav` vẫn ở `api-gateway` với 146 mục porcelain; không sửa checkout này. Worktree giữ branch `codex/workflow-service-merge-check`, `HEAD 7e14de0`, `MERGE_HEAD 688eb6d`; không có conflict path, nhưng toàn bộ merge/integration vẫn là thay đổi chưa commit để reviewer kiểm tra. Không commit/merge sang checkout gốc.
- Final `git diff --check` và `git diff --cached --check` không báo lỗi; untracked plan/work log cũng không có trailing whitespace. GitNexus `detect_changes` chưa chạy vì không chuẩn bị commit; phải chạy trên đúng repo/index trước bất kỳ commit nào.
- Chưa đủ điều kiện tuyên bố merge-ready: full Maven suite chưa xác minh do Testcontainers cần daemon; UI/catalog Playwright còn một OCR preview assertion fail độc lập. Cả hai được ghi rõ ở trên, không gộp vào pass của focused suites.

## 11. Follow-up — OCR preview retest và phương án Testcontainers an toàn

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-24 15:55 Asia/Saigon` |
| Worktree / branch | `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav` / `codex/workflow-service-merge-check` |
| Trạng thái | Không sửa source; OCR preview pass isolate và full UI/catalog pass `33/33`; chưa commit/merge. |

### OCR preview — chẩn đoán và kết quả

- Lần chạy ban đầu không vào test vì sandbox chặn Vite ghi `.vite-temp`/Playwright `.last-run.json`; sau khi giữ test output ở thư mục tạm riêng và được phép chạy test trong worktree, isolate OCR pass `1/1`, rồi `--repeat-each=8` pass `8/8`.
- Đọc Playwright trace và ảnh frame cuối: `invoice.png` hiện trong file input và panel hiển thị OCR result; test đã đi qua đúng mock route fixture `POST /api/v1/workspaces/*/ocr/extractions` có trong test, không gọi OCR service/Colab. Trace ghi response/resource thành công; không có thay đổi mock fallback hay runtime OCR.
- Trong lượt full đầu, OCR test (#29/33) cũng pass. Test #11 breadcrumb fail vì trace ghi `Failed to load resource: net::ERR_NO_BUFFER_SPACE` khi browser tải `/src/App.tsx`; ảnh lỗi là trang trắng. Request document `/executions` trả `200`, nhưng app bundle không mount nên locator breadcrumb không tồn tại. Không sửa UI/route vì đây là lỗi tài nguyên browser/harness ngoài phạm vi, không phải lỗi OCR.
- Chạy riêng breadcrumb pass `1/1`; full serial Chromium suite rerun sau đó pass **33/33**. Vì OCR fail ban đầu không tái hiện trong 9 lần isolate cộng lượt full, chưa xác định được root cause chính xác của lần fail cũ; không có cơ sở để sửa test hoặc production code. Không chạy Web build vì không đổi production code.
- Các trace/screenshot mới nằm ngoài repo trong `C:\Users\nguye\.codex\visualizations\2026\09\20\01a0bfa4-f81b-7651-8930-52885c7d504b\ocr-preview-debug-20260924-*`; không tạo/chỉnh artifact trong checkout gốc. Môi trường hiện bật reduced-motion nên app log warning của Motion; test motion đã tự emulates preference tương ứng và suite vẫn pass.

### Đề xuất — chạy Testcontainers tests trên Java 25 không socket/DinD

- Chưa thực hiện chạy hoặc cấp quyền. Đề xuất ưu tiên: dùng Testcontainers Cloud CI agent cùng Maven test container Java 25; agent mở SSH tunnel tới Docker daemon cloud và Testcontainers chọn endpoint agent, nên không mount host Docker socket và không bật privileged DinD. Tài liệu của Testcontainers nói các test hiện có chạy với Cloud, mô tả tunnel/cleanup, CI token qua secret env và CI flow khởi chạy agent trước `mvn verify` ([Cloud docs](https://testcontainers.com/cloud/docs/), [CI overview](https://testcontainers.com/cloud/ci/), [Java runtime requirements](https://java.testcontainers.org/supported_docker_environment/)). Việc dùng chính image Java 25 của repo là suy luận tương thích ở tầng JVM/Docker API; tài liệu minh họa CI bằng các image Java khác, nên cần xác minh bằng một smoke test trước full suite.
- Thứ tự nếu được chủ dự án duyệt: (1) tạo job/container ephemeral Java 25, không mount socket, không privileged; (2) inject `TC_CLOUD_TOKEN` từ secret store, không ghi log/đưa vào `.env`; (3) cho phép outbound tối thiểu tới agent/cloud và Maven cache/dependency source (không thể giữ `--network none`); (4) chờ agent báo connected, chạy một class Testcontainers nhỏ rồi nhóm 116 errors, cuối cùng full suite; (5) xác minh container cleanup, chi phí/quota và chính sách dữ liệu trước khi gửi fixture/test data lên remote workers.
- Nếu Cloud không được duyệt: dùng ephemeral isolated VM có Java 25 và Docker Engine riêng rồi chạy Maven trực tiếp trên VM (không containerize Maven, không mount socket); hoặc một remote Docker API endpoint private/mTLS chỉ khi security phê duyệt. Không mở Docker TCP API ra Internet. Cả hai chỉ là phương án điều tra, không được thực hiện trong lượt này.

### Phạm vi / trạng thái Git

- Không sửa file code trong lượt này; chỉ cập nhật work log và trạng thái checklist của plan. Không chạy Docker/Testcontainers; không tạo token/cloud worker.
- Checkout gốc `D:\End\Weav` không bị tác động. Worktree tiếp tục ở merge `--no-commit`; không stage, commit hay merge.
- `git diff --check` và `git diff --cached --check` sẽ được chạy lại sau cập nhật tài liệu dưới đây.

## 12. Fresh OCR regression — mock hydration race

> Phần này supersedes nhận định ở mục 11 rằng OCR fail cũ không có root cause tái hiện. User đã chạy độc lập full UI/catalog serial và báo `32/33`, cùng lỗi OCR ở `workflow-ui.spec.ts:408`; không được coi các lượt 33/33 trước đó là bằng chứng bác bỏ repro này.

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-24 (Asia/Saigon)` |
| Worktree / branch | `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav` / `codex/workflow-service-merge-check` |
| Trạng thái | Root cause xác nhận; regression test đỏ/xanh; chưa commit/merge. |

### Evidence và root cause

- Preserved user artifact `apps/web/test-results/workflow-ui-OCR-workflow-n-2dfe1-ews-extracted-document-text-chromium/error-context.md` ghi DOM cuối không có workflow inspector hoặc OCR node; canvas chỉ còn 5 starter nodes. File và artifacts gốc không bị sửa/xóa.
- Trace của lần tái hiện có kiểm soát tại `C:\Users\nguye\.codex\visualizations\2026\09\20\01a0bfa4-f81b-7651-8930-52885c7d504b\ocr-hydration-red-20260924-08\workflow-ui-OCR-workflow-n-2dfe1-ews-extracted-document-text-chromium\trace.zip` ghi trình tự: `Loading workflow…` visible → click palette OCR → `setInputFiles(invoice.png)` → nhả timer `getWorkflow` mock 150 ms → OCR label assert thoáng qua → click `Extract text` timeout vì inspector/node đã mất.
- Source xác nhận mock `getWorkflow` chờ 150 ms; trong lúc đó effect hydrate của `WorkflowBuilderPage` thay nodes bằng `INITIAL_NODES`. Palette trước đây vẫn enabled nên thêm node/OCR trong thời gian chờ; hydrate ghi đè node vừa thêm. Các test builder tương tự chỉ thao tác sau khi xác nhận canvas đã có đủ 5 node, nên không tạo race này.
- TDD RED: thêm assertion rằng OCR palette phải disabled trong lúc loading; focused test fail đúng kỳ vọng `Expected: disabled / Received: enabled`. Không phải chậm render file hoặc lỗi route OCR.

### Thay đổi và verification

- `apps/web/src/pages/WorkflowBuilderPage.tsx`: khóa nút palette bằng `disabled={isLoadingWorkflow || !workflow}`; giữ nguyên handler/OCR API/mock response, thêm trạng thái cursor/opacity disabled.
- `apps/web/e2e/workflow-ui.spec.ts`: giữ mock `getWorkflow` 150 ms để test tải khi loading còn mở, xác nhận palette disabled, nhả load, xác nhận enabled rồi thêm OCR/chọn file/kiểm tra response fixture. File chỉ đổi event dispatch sang string expression để không tham chiếu `window` ở TypeScript Node context.
- GitNexus impact trước sửa: `WorkflowBuilderPage` risk LOW, 1 upstream caller (`App` route); test file risk LOW, 0 upstream callers. Không đổi route hoặc contract.
- Focused OCR sau sửa: PASS `1/1`; full mock UI/catalog, Chromium, `--workers=1`: run 1 PASS `33/33` (`1.3m`), run 2 PASS `33/33` (`1.3m`), final-diff run 3 PASS `33/33` (`1.2m`). Đây là mock UI/catalog, không phải live Workflow/OCR E2E. Reduced-motion warnings của Motion vẫn xuất hiện, tests pass.
- `pnpm --dir apps/web exec tsc -b`: PASS sau khi event dispatch được đổi sang string expression. Lần đầu báo `Cannot find name 'window'` trong test callback; đã sửa test-only typing issue và chạy lại xanh.
- `pnpm --dir apps/web exec vite build --outDir=<external temp>`: PASS, 2,511 modules. Bundle JS `1,025.19 kB` minified tiếp tục có cảnh báo vượt 500 kB. Output ở `C:\Users\nguye\.codex\visualizations\2026\09\20\01a0bfa4-f81b-7651-8930-52885c7d504b\workflow-web-dist-20260924`; `apps/web/dist` hiện hữu không bị ghi đè.
- Suite/test artifacts mới đặt ngoài repo trong `C:\Users\nguye\.codex\visualizations\2026\09\20\01a0bfa4-f81b-7651-8930-52885c7d504b\ocr-regression-*` và `mock-ui-catalog-run-*-20260924`; không gọi OCR/Colab thật.
- Không chạy Testcontainers, Testcontainers Cloud, Docker socket hay privileged DinD trong lượt này.

### Phạm vi / trạng thái Git

- Chỉ sửa hai file code/test nêu trên và work log này; checkout `D:\End\Weav` vẫn ở `api-gateway`, không bị tác động.
- Worktree còn merge `--no-commit`; không stage, commit, hoàn tất merge hoặc ghi đè user changes. Maven/Testcontainers full suite vẫn là blocker độc lập đã nêu ở mục trước.
- `git diff --check` và `git diff --cached --check`: cả hai exit `0`; không có whitespace errors. Git chỉ in cảnh báo line-ending `LF will be replaced by CRLF` cho `services/workflow-service/Dockerfile.dev`. Work log không có trailing whitespace.

## 13. Merge-to-main preflight — paused by GitNexus critical/truncated result

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-24 (Asia/Saigon)` |
| Target checkout | `D:\End\Weav`, branch `api-gateway`, HEAD `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02` |
| Isolated source | `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav`, branch `codex/workflow-service-merge-check`, MERGE_HEAD `688eb6d8cceb58a2feb59048afd819496ca3102d` |
| Trạng thái | Chỉ read-only preflight + ghi blocker vào log trong worktree; không backup/stash/merge/commit/push. |

### Preflight evidence

- Checkout đích vẫn ở `api-gateway`; compact porcelain status có 146 entries như user báo (expanded `-uall` hiện 160 vì liệt kê từng untracked path). Tám tracked overlap xác nhận đúng: `.env.example`, năm Workflow pages (`CreateWorkflowPage`, `ExecutionDetailPage`, `ExecutionsPage`, `WorkflowBuilderPage`, `WorkflowsPage`), `apps/web/src/types/workflow.types.ts`, `compose.dev.yml`. Hai stash entries đã tồn tại trước lượt này; không tạo stash/backup mới.
- Isolated worktree: `HEAD=7e14de0`, merge source `688eb6d`; 287 staged paths (`43,274 insertions / 8,162 deletions`), 13 unstaged paths, 8 untracked paths; zero unmerged paths. Untracked paths là Workflow FE/Gateway sources, test, plan, work log. Staged `.env.example` chứa cấu hình rỗng/false-by-default cho signing/OCR gates; manifest scan không thấy `.env`, generated build/target output, key/cert archive hay binary artifact. Staged changes có nhiều tài liệu/work-log move/delete do các commit `c836de2`, `6da2ced`, `688eb6d` (`docs consolidate/organize`), ngoài code Workflow.
- GitNexus CLI/index đúng cho worktree có sẵn (`weav-workflow-isolated`, indexed at `7e14de0`). `node D:\End\Weav\.gitnexus\run.cjs detect-changes --scope all --repo weav-workflow-isolated` exit `0`, nhưng báo **risk CRITICAL**, 266 files, 4,282 symbols, 90 affected flows. CLI output tóm lược bằng `... and 4267 more` và chỉ in một phần flows; không phải report đầy đủ/clean. Theo safety gate của user, dừng trước mọi commit hoặc áp dụng thay đổi lên `D:\End\Weav`; không dùng risk này như all-clear.
- Sau preflight, target branch/HEAD/status/stash không đổi; worktree còn merge `--no-commit`, zero conflict. Không chạy destructive/recovery operations. Full Maven/Testcontainers `116` cases vẫn chưa được xác minh.
- Bước tiếp theo cần review/thu hẹp phạm vi staged changes và có GitNexus report đầy đủ, không partial/truncated, trước khi tiếp tục hoàn tất merge. User cần review quyết định nếu CRITICAL risk còn lại.

## 14. Read-only merge-risk audit — GitNexus output and branch history

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-24 23:08 Asia/Saigon` |
| Target checkout | `D:\End\Weav`, `api-gateway`, `HEAD 7e14de05ec9886db8d9beacf3dc6c69f12a6fd02` |
| Isolated index/worktree | `weav-workflow-isolated`, `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav`, branch `codex/workflow-service-merge-check` |
| Trạng thái | Chỉ đọc hai checkout; append mục audit này vào work log. Không commit/stash/backup/merge; không gọi Testcontainers Cloud/socket. |

### GitNexus: xác minh display abbreviation và dữ liệu thô

- `node D:\End\Weav\.gitnexus\run.cjs detect-changes --help` xác nhận tool hỗ trợ các scope `unstaged`, `staged`, `all`, `compare`; không có cờ JSON/path filter. Lệnh ban đầu `node D:\End\Weav\.gitnexus\run.cjs detect-changes --scope all --repo weav-workflow-isolated` trả `266 files / 4,282 symbols / 90 flows / critical`.
- Kiểm tra `C:\Users\nguye\AppData\Roaming\npm\node_modules\gitnexus\dist\cli\tool.js` cho thấy formatter cố ý chỉ in `changed.slice(0, 15)` và `affected.slice(0, 10)`, rồi thêm `... and N more`. Vì vậy ellipsis là rút gọn CLI; nó không đại diện cho danh sách backend bị cắt.
- Lấy kết quả cấu trúc trực tiếp bằng `LocalBackend.callTool('detect_changes', {scope, repo: 'weav-workflow-isolated'})`, gọi riêng `staged`, `unstaged`, `all`; schema runtime trả các key `summary`, `changed_symbols`, `affected_processes`, không có `partial`/`truncated`.
- Đối chiếu số phần tử mảng với summary: `staged` 257 files / 4,225 symbols / 90 flows / critical (array lengths 4,225 và 90); `unstaged` 13 files / 87 symbols / 0 flows / low (array lengths 87 và 0); `all` 266 files / 4,282 symbols / 90 flows / critical (array lengths 4,282 và 90). Không thấy `error` hay log lỗi query trong các lần lấy report. Caveat: backend có catch/log lỗi truy vấn nhưng không trả partial flag, vì vậy kết luận chỉ dựa trên lượt chạy không ghi nhận query error. Diff dựa trên Git nên 8 file untracked không được phân tích; chúng cần review riêng.
- `risk_level=critical` là ngưỡng độ rộng của tool: `processCount > 15` được gán critical; đây không phải severity riêng cho từng symbol và không tự chứng minh có bug. Các symbol trả về có `type` null trong adapter hiện tại, nên audit không suy luận theo loại symbol.

### Phạm vi tác động và đánh giá

- `all` theo khu vực symbol: `workflow-service` 4,101; `apps-web` 150; `contracts` 10; `workspace-service` 16; `api-gateway` 1; `other` 4. `staged` chứa 4,101 symbol Workflow Service, 94 web, 10 contracts, 16 Workspace và 4 other; `unstaged` chủ yếu là 86 web symbols cộng 1 API Gateway symbol, không có process flow trong graph.
- Files có nhiều symbol thay đổi nhất gồm `WorkflowV1AcceptanceTest.java` (126), `ExecutionRunner.java` (122), `ExecutionStateAdapter.java` (106), `PinnedHttpTransport.java` (94), `DefinitionValidator.java` (93), `ExecutionRuntimeIntegrationTest.java` (93), `OcrClient.java` (92). Đây là thay đổi rộng của service mới cùng test/contracts, cần review theo execution, persistence, outbound HTTP/OCR, validation/security; số symbol cao tự thân không phải finding lỗi.
- Flow mẫu do graph báo gồm `Create → Put`, `Create → IsImmutableNumber`, `Create → FreezeArray`, `RecordScheduleFailure → Put`, `CommitCompletion → Put`, `Manual → BadRequestException`, `Publish → Add`, `SaveDraft → Put`. Danh sách có cả các helper/immutable-value steps tổng quát, nên 90 flows phản ánh graph breadth; cần reviewer tập trung vào các flow nghiệp vụ và boundary/service contracts. `unstaged` FE integration không được graph nối thành flow, dù có 87 changed symbols.
- Nhận định: CRITICAL là tín hiệu review phạm vi rất lớn, dự kiến khi thêm Workflow Service V1 và thay đổi contract/UI; không phải cờ có thể bỏ qua. Testcontainers/full Maven vẫn chưa xác minh, nên risk runtime/integration còn mở. Không chạy test trong audit read-only này.

### Lịch sử tài liệu và lựa chọn review

- Lịch sử source: `c836de2 docs: consolidate plans and worklogs` (68 file, khoảng 7,672 additions / 7,488 deletions, phần lớn tổ chức lại docs/work logs), sau đó `18b6dfa Implement Workflow Service V1` (code/service/contracts/UI kèm plan/spec/evidence docs), rồi `6da2ced docs: consolidate Workflow V1 work logs` (30 file; thay nhiều log nhỏ bằng `docs/work_logs/K/workflow-service-v1.md`, xóa khoảng 4,727 dòng log cũ), rồi `688eb6d docs(workflow): Organize workflow service work logs` (7 file; thêm 6 log chi tiết vào `docs/work_logs/K/workflow/` và chuyển log tổng hợp vào thư mục này). Đây là các commit có thật trong ancestry `7e14de0 → c836de2 → 18b6dfa → 6da2ced → 688eb6d`; không âm thầm loại commit nào.
- Lựa chọn A — full merge ancestry: giữ cả service, FE/contracts và toàn bộ lịch sử/docs moves/deletes; chỉ chọn nếu reviewer chấp thuận thay đổi tổ chức/xóa work log. Lịch sử cũ vẫn còn trong Git commits nhưng các file đó không còn trong tree cuối.
- Lựa chọn B — integration thu hẹp: giữ nguyên source branch/ancestry, tạo một integration change riêng chỉ lấy phần code/contract/FE cần thiết từ `18b6dfa` và FE real-API diff hiện có; để `c836de2`, `6da2ced`, `688eb6d` docs refactor thành thay đổi riêng cho reviewer. Cách này không xóa lịch sử source branch nhưng không fast-forward/merge toàn bộ ancestry vào target; cần reviewer duyệt chính xác manifest/file set trước khi thao tác. Chưa thực hiện lựa chọn nào.

### Trạng thái an toàn / bước tiếp theo

- Main checkout kiểm tra lại vẫn `api-gateway` / `7e14de0`, 146 compact porcelain entries, hai stash cũ không đổi; 8 overlap như mục 13. Worktree vẫn `codex/workflow-service-merge-check`, `MERGE_HEAD=688eb6d`, không có unmerged paths. Không có checkout nào được merge hay commit trong lượt này.
- Lượt audit xác nhận ellipsis không phải blocker về truncation, nhưng không thay thế user review cho risk breadth, docs consolidation, 8 file overlap, 8 untracked integration paths và full Maven/Testcontainers chưa xanh. Bước an toàn: reviewer chọn A hoặc B; nếu B, duyệt manifest thu hẹp trước khi thay đổi checkout đích. Giữ nguyên backup/stash/merge safeguards đã đặt ra; không tự áp dụng.
- Bổ sung vào audit docs: 4 symbol của nhóm `other` đến đúng từ `AGENTS.md` và `CLAUDE.md`; mỗi file đổi một dòng quy định work log từ flat path sang `docs/work_logs/K/` hoặc `T/`. Đây là thay đổi hướng dẫn tổ chức log liên quan trực tiếp tới các commit docs, không phải thay đổi logic sản phẩm.

## 15. Full ancestry merge — isolated pre-commit verification

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Target checkout | `D:\End\Weav`, `api-gateway`, HEAD trước merge `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02` |
| Isolated worktree | `C:\Users\nguye\.codex\worktrees\workflow-service-merge-check\Weav`, `codex/workflow-service-merge-check`, merge source `688eb6d8cceb58a2feb59048afd819496ca3102d` |
| Trạng thái | Chọn A: giữ toàn bộ ancestry và docs/work-log reorganizations. Đã hoàn tất pre-commit verification trong worktree; chưa commit, chưa stash/merge vào target. |

### GitNexus và phạm vi

- Đã refresh index chỉ trong worktree bằng `node D:\End\Weav\.gitnexus\run.cjs analyze --index-only --force --name weav-workflow-isolated`; kết quả đầy đủ `19,715 nodes / 49,900 edges / 935 clusters / 300 flows`. Index status xác nhận index đúng repo/worktree và current commit `7e14de0`.
- Sau reindex, chạy `node D:\End\Weav\.gitnexus\run.cjs detect-changes --scope all --repo weav-workflow-isolated`: exit `0`, **275 files / 4,530 symbols / 88 affected flows / CRITICAL**. Đối chiếu `LocalBackend.callTool('detect_changes', {scope:'all', repo:'weav-workflow-isolated'})`: arrays có đúng 4,530 symbols và 88 flows; keys gồm `summary`, `changed_symbols`, `affected_processes`; không có `partial` hoặc `truncated`, không có query error. CLI `... and 4515 more` là giới hạn hiển thị 15 symbol đầu, không phải cắt mảng backend.
- Graph có node cho các file integration mới như `workflow-v1.api.ts` (75 symbols), `workflow-api-v1.spec.ts` (11), hai live pages (20/24), Workflow Gateway module/spec (59/10). Có 24 code paths không có symbol mapping (chủ yếu declaration/record/port/DTO mới và một file chỉ đổi import); đã kiểm tra declarations/imports bằng targeted search/manual inspection, không coi empty graph mapping là all-clear. Docs/plans/work logs thuộc `.gitnexusignore` và được review thủ công qua manifest/diff.
- `CRITICAL` do breadth heuristic (`>15` affected processes), không phải kết luận lỗi trên từng symbol. Đã xem đủ danh sách 88 flow: nhóm chính bao gồm workflow lifecycle/save/publish/pause/resume, workspace/validation/auth errors, execution/manual/retry/recovery/outbox, persistence/definition decode và scheduling; ngoài ra có helper immutable/map flows tổng quát và flow login/path không liên quan trực tiếp. Vẫn yêu cầu review rộng; không hạ mức cảnh báo.
- Staged manifest đầy đủ 305 paths, `45,774 insertions / 8,490 deletions`; gồm service/contract/FE, docs moves/deletions được lựa chọn A chấp thuận, plans/logs và tests. Không thấy `.env`, secret, generated build/target/test output, binary hoặc path ngoài phạm vi. Không còn unstaged/untracked changes trong worktree ở checkpoint này.

### Fresh verification

- `pnpm --dir apps/web exec tsc -b`: PASS. `pnpm --dir apps/web exec vite build --outDir=<external temp>`: PASS, 2,511 modules; bundle cảnh báo hiện có >500 kB, không được coi là lỗi build. Output đặt ngoài repo.
- Playwright API fixture suite với `VITE_API_MODE=http` và gateway deliberately unreachable: PASS `4/4`; đây là contract/fixture tests, không phải live API. Mock UI/catalog Chromium `--workers=1`: PASS `33/33`.
- API Gateway focused `workflow.module.spec.ts`: PASS `4/4`; API Gateway build: PASS.
- Xác nhận Docker image chạy `OpenJDK 25.0.4`. Lệnh offline `./mvnw -o -Dtest=DefinitionJsonCodecTest,OcrClientContractTest test` chạy trong Java 25 container với `--network none`, source/contracts read-only, Maven caches read-only, `target` riêng bên ngoài và không mount socket: PASS `9/9` (codec 5, OCR contract 4). Đây chỉ là focused fixture coverage.
- Full Maven suite **không xanh/không được xác minh**: lần full run trước ghi 354 tests, 1 failure + 117 errors, 3 skipped; 116 Testcontainers cases không tìm thấy Docker, hai fixture/schema errors phụ thuộc contract build context. Fixture/schema classes mục tiêu hiện đã pass với contract mount đúng, nhưng chưa chạy lại full suite và 116 Testcontainers vẫn unverified. Không dùng Testcontainers Cloud, host socket, privileged DinD.
- Real-mode full browser flow đã PASS trong isolated Docker smoke trước đó theo evidence các mục work log trước. Không chạy lại với các dev containers đang hoạt động trong lượt này vì đó là shared user stack và test sẽ tạo tài nguyên; không được diễn giải fixture suite là live E2E.
- `git diff --check` và `git diff --cached --check`: PASS. Docker CLI lần đầu báo permission khi đọc config trong sandbox, sau đó chỉ chạy read-only Docker version/image/runtime checks đã được cấp quyền; không thay đổi containers/volumes/DB.

### Target checkout preservation / bước kế

- Target vẫn `api-gateway` / `7e14de0`, expanded status 160 path entries (146 compact entries), 8 overlaps giữ đúng fingerprint baseline; hai stash objects cũ không đổi. Chưa tạo recovery stash, chưa đổi file target, chưa commit/merge/push.
- Tiếp theo: chạy lại `detect-changes` sau cập nhật plan/log, xác nhận đúng index và structured array counts; commit merge milestone trong isolated worktree. Sau đó mới xác minh lại baseline, tạo path-limited stash cho đúng 8 overlaps, verify object/tree, fast-forward merge vào target, và chỉ reapply/reconcile các overlap sau preservation checks. Tuyệt đối không drop stash. Full Maven/Testcontainers gap phải tiếp tục được báo rõ.
