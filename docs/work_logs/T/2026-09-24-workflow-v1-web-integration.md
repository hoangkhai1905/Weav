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

## 16. Main fast-forward and overlap recovery stop

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Target | `D:\End\Weav`, branch `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Merge commit | `b44332d93057dac01d1bb2657bc37868a2bbeb27`, parents `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02` and `688eb6d8cceb58a2feb59048afd819496ca3102d` |
| Trạng thái | Full ancestry fast-forward đã vào target. Dừng trước khi resolve ba content conflicts lúc reapply local overlap changes. Không push. |

### Preservation và recovery

- Trước stash và merge, đối chiếu đầy đủ 160 path-level status/hash entries của main với baseline; tất cả khớp. Sau path-limited stash, 152 non-overlap entries tiếp tục khớp; sau fast-forward và stash apply, cả 152 non-overlap entry này vẫn khớp. Directory untracked `examples/motion-primitives-website/` được kiểm tra đúng là directory (mode `16822`), không bị xem nhầm như file.
- Recovery stash mới: `af82524c6c695d6425119a135810c6cdf0673cb4`, message `pre-workflow-full-merge-overlaps-20260925`. Diff tree chứa đúng 8 overlap paths; patch fingerprints của cả tám khớp baseline; hai stash objects cũ vẫn còn, tổng stash count `3`. Không drop stash.
- Với `.env.example`, stash blob raw hash khác raw working-tree hash baseline, đồng thời Git báo `LF will be replaced by CRLF`; patch fingerprint vẫn khớp. Do line-ending/filter behavior chưa chứng minh được byte-identical restoration, không tuyên bố khôi phục byte-for-byte file này.

### Trạng thái reapply

- `git merge --ff-only b44332d93057dac01d1bb2657bc37868a2bbeb27` fast-forward thành công; HEAD main có source commit `688eb6d` là ancestor. Không có `MERGE_HEAD`, không có unmerged path do fast-forward.
- `git stash apply af82524c6c695d6425119a135810c6cdf0673cb4` tự apply được `.env.example`, `CreateWorkflowPage.tsx`, `ExecutionsPage.tsx`, `workflow.types.ts`, `compose.dev.yml`. Git báo content conflicts ở `ExecutionDetailPage.tsx`, `WorkflowBuilderPage.tsx`, `WorkflowsPage.tsx`. Recovery stash vẫn còn nguyên.
- Dừng ở đúng state Git này: không resolve/unstage/retry/drop. Ba path trên đang unmerged; năm path tự apply đang staged theo output Git. Sau khi append mục work log này, main status là 147 compact / 161 expanded entries (146 original entries + 1 work-log entry); toàn bộ 152 non-overlap baseline entries vẫn khớp hash/status. Tám overlap patch đã lưu trong stash; không khẳng định byte-identical cho `.env.example` như ghi ở trên. Không chạy build/Playwright trên main khi ba path còn conflict.
- Cần reviewer xem xét ba conflict và quyết định cách giữ thay đổi local cùng Workflow integration; sau quyết định mới tiếp tục reconciliation và main-checkout verification. Isolated checks vẫn là: Web typecheck/build pass, mock UI 33/33, API fixture 4/4, Gateway focused 4/4/build pass, Java 25 focused fixtures 9/9. Full Maven/Testcontainers suite không xanh/không xác minh; 116 Testcontainers cases còn unverified.

## 17. Main overlap conflicts reconciled — review pending

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\End\Weav`, branch `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Trạng thái | Đã resolve ba content conflicts và giữ toàn bộ thay đổi overlap ở trạng thái unstaged; chưa commit/push. |

### Hòa giải ba file

- `apps/web/src/pages/ExecutionDetailPage.tsx`: giữ router real-mode sang live execution detail cùng translations/localized ReactFlow accessibility cho mock view.
- `apps/web/src/pages/WorkflowBuilderPage.tsx`: giữ Workflow Service thật cho load/save/publish/manual run và phần local workspace/auth/i18n. Giữ OCR theo workspace snapshot, abort signal, reset/status/result guards, save config và logout khi 401. Không phục hồi simulator giả cho execution/provider status, bởi nó có thể hiển thị thành công giả và xung đột với V1 chưa thực thi node.
- `apps/web/src/pages/WorkflowsPage.tsx`: giữ trạng thái và dữ liệu từ API làm nguồn thật; unknown stats hiện `—`, không tạo số liệu execution giả; giữ localization/local card behavior và yêu cầu publish trước khi chạy.
- `git ls-files -u`: 0. Quét `<<<<<<<`, `=======`, `>>>>>>>` trong ba file: 0 markers.

### Kiểm tra bảo toàn và trạng thái Git

- Đối chiếu manifest/fingerprint đã lưu: 152/152 non-overlap dirty/untracked entries khớp status và SHA-256 trước khi reconcile; không có path bất ngờ. `examples/motion-primitives-website/` vẫn là untracked directory.
- Cả 8 overlap paths còn ở working tree và đều unstaged: `.env.example`, năm page Workflow/Create/Executions, `workflow.types.ts`, `compose.dev.yml`. `git diff --cached --name-only` rỗng. Thay đổi người dùng còn uncommitted để review.
- `.env.example` kiểm tra không in giá trị nhạy cảm: hiện có đủ 165 keys của HEAD và 113 keys từng nằm trong recovery stash; không thiếu key stash, giá trị common khớp stash. Khác biệt giá trị so HEAD duy nhất là `GOOGLE_OAUTH_FRONTEND_RETURN_URL`, giữ URL local `5173` từ stash. Raw bytes không giống: working copy CRLF, stash blob LF; ngoài khác line ending còn có keys Workflow từ merge. Không tuyên bố byte-identical.
- Recovery stash `af82524c6c695d6425119a135810c6cdf0673cb4` còn ở `stash@{0}`; hai stash cũ vẫn nguyên, tổng 3. Không drop stash, không commit/push.
- `git diff --check`: exit 0; chỉ có warning line-ending CRLF của `apps/mobile/src/app/(app)/workspace/index.tsx`. TypeScript `pnpm --dir apps/web exec tsc -b`: PASS. Vite `pnpm --dir apps/web exec vite build --outDir <external temp>`: PASS (2,516 modules); có cảnh báo bundle JS >500 kB.

### Browser/runtime verification và giới hạn

- Chạy thử Chromium với `WEAV_E2E_PORT` riêng cho từng suite, không reuse dev server. Các Playwright process không đưa ra kết quả cuối ổn định và phải dừng; không tính các lượt này là PASS. Một lỗi cụ thể ở API fixture test `workflow-api-v1.spec.ts:159`: `getByRole('status')` strict-mode match đồng thời execution status và topbar “Loading workspaces…” từ thay đổi workspace/localization có sẵn. Không sửa selector hoặc UI trong lượt reconcile này.
- Lượt UI/catalog dừng trước summary; console/error context cho thấy một số builder assertions tìm label English trong khi app đang dùng locale VI. OCR-builder exploratory suite bị disabled palette tại các test đòi OCR active; V1 catalog hiện thể hiện gate chưa bật. Đây không chứng minh production regression và test/user files không bị sửa.
- Không chạy Docker/live Gateway+Workflow trên main; không có live API/browser proof ở checkout này. Full Maven/Testcontainers còn nguyên gap: 116 Testcontainers cases chưa xác minh; không dùng Testcontainers Cloud/socket.

### Bước review

- Reviewer xem diff tám overlap paths, nhất là semantic choices ở builder (không mang simulator giả trở lại) và `.env.example` line endings. Các thay đổi vẫn unstaged để review/reconcile.
- Sau review, có thể sửa riêng test selector/localization assumptions nếu user yêu cầu; cần chạy lại Playwright tuần tự khi browser runner ổn định. Không coi test suite bị dừng là xanh. Chạy live smoke chỉ khi được phép dùng một stack test cô lập.

## 18. Main focused browser diagnosis — deterministic test setup

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\End\Weav`, `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Trạng thái | Đã sửa hai lỗi test-only hẹp; chưa commit/push. Production locale/readiness gate không đổi. |

### Root cause và thay đổi test

- `apps/web/e2e/workflow-api-v1.spec.ts:159`: RED tái hiện với focused Chromium test. `getByRole('status')` khớp hai element: execution toast và `topbar-workspace-loading`; lỗi là strict-mode locator ambiguity. GREEN thay bằng cùng role nhưng filter theo execution ID, chỉ sửa assertion test.
- `apps/web/e2e/workflow-ui.spec.ts`: RED tái hiện trong nhóm `workflow builder execution motion`. Artifact DOM cho thấy locale VI thật (`Quy trình`, `Trích xuất dữ liệu bằng AI`) trong khi assertions dùng English (`AI Extract Core`). Nhóm này không có setup locale; thêm `beforeEach` chỉ cho nhóm test để đặt `weav_lang_v1=EN`. Không ép production default, không đổi assertion semantics.
- GitNexus impact cho filename test không tìm thấy target (`UNKNOWN`, 0 callers); đã xác nhận bằng text search rằng thay đổi không chạm production symbol. Không sửa shared i18n hook/component.

### Fresh Playwright evidence

- Focused API RED: `workflow-api-v1.spec.ts` history test fail đúng strict-mode ambiguity ở line 159.
- Focused API after test fix: test body `1 passed`; process exit `1` vì runner teardown `Timed out waiting 30s for the teardown for plugin setup to run`.
- Focused UI locale after setup: test body `1 passed`; cùng teardown timeout 30s.
- Full `workflow-catalog-v1.spec.ts`, Chromium serial, mock mode, isolated port: **8 passed** test bodies; process exit `1` vì `Timed out waiting 60s for the teardown for plugin setup to run`.
- Full `workflow-api-v1.spec.ts`, Chromium serial, HTTP fixture mode with unreachable gateway, isolated port: **4 passed** test bodies; process exit `1` vì cùng teardown timeout 60s. Đây là fixture/contract tests, không live Gateway.
- Relevant `workflow-ui.spec.ts` groups (`workflow builder execution motion|OCR workflow node`), Chromium serial, mock mode, isolated port: **9 passed** test bodies; process exit `1` vì cùng teardown timeout 60s. Không coi các suite này là process-level green do runner teardown lỗi.

### OCR builder diagnosis — not a production regression

- Fresh HTTP-mode focused OCR test (isolated port, gateway deliberately unreachable) failed at click because the OCR palette button was disabled. Artifact DOM proves the cause: alert `Workflow service is temporarily unavailable`, disabled Save/Publish/palette, and no loaded workflow. The palette code disables items only while `isLoadingWorkflow || !workflow`; the OCR readiness function independently marks `ocr.extract` as `unavailable` but does not disable the palette.
- The OCR fixture does not route the Workflow Service detail request in HTTP mode, so the test cannot reach the inspector. Mock mode loads a different mock workspace (`ws-main`) than the fixture's expected ID and then fails URL assertion. This is test setup/environment mismatch, not evidence that the production OCR readiness gate is wrong.
- `apps/web/e2e/ocr-builder.spec.ts` was not changed in this session. No production gate was changed and no mock fallback was introduced. A future fix needs an explicit choice: add a Workflow Service detail fixture for HTTP mode or run against an approved isolated live stack.

### Verification limits and handoff

- Web TypeScript/build must be rechecked after these test-only edits; no Docker/live Gateway smoke was run on main. Full Maven/Testcontainers remains unverified, including 116 Testcontainers cases.
- Existing user dirties and recovery stash were preserved. Recheck `git ls-files -u`, conflict markers, `git diff --check`, the 152-entry baseline, and stash list before handoff.

## 19. Windows Playwright webServer teardown — direct Vite entrypoint

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\End\Weav`, `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Phạm vi | Chỉ `apps/web/playwright.config.ts` và verification/work log; không đổi production Workflow/OCR hoặc test fixture OCR. |
| Trạng thái | Đã sửa tối thiểu, focused teardown GREEN; chưa commit/push. |

### RED và root cause

- Repro tối giản trước sửa: `VITE_API_MODE=http VITE_API_GATEWAY_URL=http://127.0.0.1:1 WEAV_E2E_PORT=4210 pnpm --dir apps/web exec playwright test e2e/workflow-api-v1.spec.ts --grep "workflow list comes from" --project=chromium --workers=1 --reporter=line --timeout=10000 --global-timeout=15000`. Test body `1 passed`, nhưng Playwright exit lỗi `Timed out waiting 15s for the teardown for plugin setup to run` sau log `Terminating the WebServer`.
- Trong run RED, port cô lập `4210` còn LISTEN bởi Vite PID `31032`; PID `32688` là Node process thứ hai sinh cùng run. Cả hai không nằm trong baseline Node PID trước test. Chỉ sau khi xác nhận port/PID thuộc run này, đã dừng đúng `31032,32688`; không đụng process user có trước.
- Đọc Playwright 1.62.1 local cho thấy `webServer` dùng `shell: true`; Windows cleanup gọi `taskkill /pid <spawned shell> /T /F` rồi chờ `close`. Command cũ `pnpm dev` tạo process lồng `pnpm -> vite`, nên Vite có thể sống sau cleanup của shell. Đây là process-tree leak, không phải reporter hay test body.
- GitNexus impact trước edit cho `File:apps/web/playwright.config.ts`: `risk LOW`, `impactedCount 0`, không có caller/process/module trực tiếp. `context` tìm thấy file với incoming/outgoing/processes rỗng. `query Playwright` chạy được nhưng cảnh báo FTS index thiếu, keyword search degraded; không dùng kết quả rỗng đó để suy luận an toàn. Text search xác nhận config chỉ được tham chiếu bởi tsconfig và Playwright runtime.

### GREEN fix và runtime evidence

- Thay đúng một dòng `webServer.command` từ `pnpm dev ...` thành `node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${webPort} --strictPort`. Path `apps/web/node_modules/vite/bin/vite.js` đã tồn tại; không dùng `require.resolve('vite/bin/vite.js')` vì package export chặn subpath đó.
- Focused regression sau sửa cùng test: `WEAV_E2E_PORT=4211`, `1 passed (6.6s)`, exit `0`; log có `Terminated the WebServer`; port `4211` không còn LISTEN và không còn Node PID mới sau teardown.
- Chromium serial, isolated port, không reuse dev server: API fixture `workflow-api-v1.spec.ts` **4/4, exit 0, port 4212 đóng**; catalog mock `workflow-catalog-v1.spec.ts` **8/8, exit 0, port 4213 đóng**; nhóm builder + OCR UI `workflow-ui.spec.ts --grep "workflow builder execution motion|OCR workflow node"` **9/9, exit 0, port 4214 đóng**.
- Full `workflow-ui.spec.ts`, Chromium serial, mock, port `4215`: **20 passed, 5 failed test bodies, process exit 1**, nhưng teardown hoàn tất và port đóng. Năm failure là assertion UI đã tồn tại ngoài phạm vi teardown (logo/navigation, language-switch control, responsive workflow row, workspace invite); không có `Timed out waiting ... teardown`. Không sửa chúng trong task này.

### Build, preservation và giới hạn

- `pnpm --dir apps/web exec tsc -b`: PASS, exit 0.
- `pnpm --dir apps/web exec vite build --outDir <TEMP>`: PASS, 2,516 modules; chỉ còn warning bundle JS lớn hơn 500 kB. Build output nằm ngoài repository.
- `git diff --check`: exit 0; Git chỉ cảnh báo line-ending CRLF đã có trên `apps/mobile/src/app/(app)/workspace/index.tsx`.
- Baseline bảo toàn: **152/152** non-overlap entries khớp status và SHA-256; cả 8 overlap paths vẫn unstaged. `git ls-files -u` rỗng, không còn conflict marker. Recovery stash `af82524c6c695d6425119a135810c6cdf0673cb4` vẫn `stash@{0}`, hai stash cũ vẫn tồn tại; không drop/stash/reset/commit.
- Không chạy Docker/live Gateway, không dùng Testcontainers/socket, không chạm OCR Colab. Full UI vẫn chưa xanh do 5 body failures nêu trên; đây không phải bằng chứng thất bại của webServer teardown. Không chạy `detect_changes` vì chưa commit và user yêu cầu giữ diff để review.

### Next review step

- Reviewer xem một-line config diff và quyết định có chấp nhận direct Vite entrypoint. Nếu cần làm xanh full UI, đó là task riêng để xử lý 5 assertion/setup failures; không nên trộn vào teardown fix.

## 20. Five locale/vocabulary assertions — partial GREEN, next stale assertion blocked

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\End\Weav`, `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Phạm vi | Chỉ `apps/web/e2e/workflow-ui.spec.ts` và work log; không đổi production UI/i18n, Playwright config, OCR hoặc Workflow integration. |
| Trạng thái | 4/5 mục tiêu pass; mục tiêu thứ năm lộ thêm một assertion locale ngoài phạm vi; chưa commit/push. |

### Pre-edit evidence and bounded changes

- GitNexus `context`/`impact` cho `apps/web/e2e/workflow-ui.spec.ts` trả `UNKNOWN`/không tìm thấy symbol file trong index. Không coi đây là an toàn; đã targeted-search và đọc trực tiếp test, `Logo`, topbar language toggle, workspace member action và translation keys trước khi sửa.
- Đã sửa tối thiểu năm giả định stale: dùng locale EN + accessible name chính xác cho logo/navigation; dùng locale VI + cả hai hướng language switch (`Chuyển sang tiếng Anh`/`Switch to Vietnamese`); dùng `/^Chọn /` cho checkbox workflow row trong VI; dùng nút `Thêm thành viên` trong VI. Các assertion vẫn kiểm tra đúng control/behavior, không dùng selector chung.

### Focused verification and blocker

- Command: `$env:VITE_API_MODE='mock'; Remove-Item Env:VITE_API_GATEWAY_URL -ErrorAction SilentlyContinue; $env:WEAV_E2E_PORT='4218'; pnpm --dir apps/web exec playwright test e2e/workflow-ui.spec.ts --grep "uses the refreshed WEAV mark|shows readable navigation|translates the dashboard shell|keeps selected workflow actions|keeps workspace, profile settings" --project=chromium --workers=1 --reporter=line --output=$env:TEMP\weav-ui-five-fix-20260925 --global-timeout=240000`.
- Result: **4 passed, 1 failed**, process exit **1**. The fifth test passed the repaired `Thêm thành viên` assertion, then failed at line 461 on `getByRole('link', { name: /open guide/i })`.
- Failure artifact `C:\Users\nguye\AppData\Local\Temp\weav-ui-five-fix-20260925\workflow-ui-workspace-acco-c492f--help-surfaces-discoverable-chromium\error-context.md` shows the actual VI link `Mở hướng dẫn`; `apps/web/src/pages/HelpPage.tsx` and the VI translation confirm this is a sixth stale locale assertion. Per the approved bounded scope, no sixth assertion was edited and no broader failure was hidden.
- Full `workflow-ui.spec.ts`, typecheck and build were intentionally not rerun after this red focused run; they must not be reported as green. The direct-Vite webServer teardown remained clean: no timeout, and port `4218` had no listener after the run.

### Preservation and follow-up

- Existing one-line `apps/web/playwright.config.ts` teardown fix, production files, OCR/Colab path, dirty user files, and recovery stash `af82524c6c695d6425119a135810c6cdf0673cb4` were untouched. No process outside this test run was stopped; no commit/push.
- Independent `LiveExecutionPanel` SVG console error (`<circle>` `cx` undefined) remains noted for later and was not changed in this task.
- Next step requires reviewer authorization for the separate Help-page locale assertion, followed by a fresh full-file serial run; do not broaden this task silently.

## 21. Help-page locale assertion — GREEN

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\End\Weav`, `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Phạm vi | Chỉ `apps/web/e2e/workflow-ui.spec.ts` và work log; không đổi production UI/i18n, Playwright config, OCR hoặc Workflow integration. |
| Trạng thái | Đã sửa assertion locale stale và xác minh full file GREEN; chưa commit/push. |

### RED evidence and root cause

- GitNexus `context`/`impact` cho test file vẫn trả `UNKNOWN`/không tìm thấy file symbol; đã xác nhận bằng targeted search và đọc trực tiếp DOM/source trước edit. Không có HIGH/CRITICAL risk được báo; UNKNOWN không được coi là all-clear.
- Focused RED trên port `4220`: `keeps workspace, profile settings, and help surfaces discoverable` **1 failed**, exit **1**, đúng line 461 với `getByRole('link', { name: /open guide/i })`.
- Failure artifact DOM hiển thị link `Mở hướng dẫn`; `HelpPage.tsx` render `t('help.open_guide')`, và `translations.ts` xác nhận VI `Mở hướng dẫn` / EN `Open guide`. Đây là stale locale assertion, không phải product/API failure.

### Minimal fix and verification

- Đổi duy nhất locator thành `getByRole('link', { name: 'Mở hướng dẫn', exact: true })`, giữ nguyên semantic assertion về đúng Help guide link.
- Focused GREEN trên port `4221`: **1 passed**, exit **0**; không còn listener sau teardown.
- Full `workflow-ui.spec.ts`, Chromium serial, mock mode, port `4222`: **25 passed**, exit **0**; không còn listener sau teardown. Không có failure tiếp theo cần phân loại hoặc sửa.
- `pnpm --dir apps/web exec tsc -b`: exit **0**. `pnpm --dir apps/web exec vite build --outDir <external temp>`: exit **0**, 2,516 modules; chỉ warning bundle JS >500 kB. Một lệnh cleanup temp trước đó bị shell policy từ chối trước khi chạy, không tác động checkout; build rerun dùng thư mục temp mới.

### Preservation and known follow-up

- `apps/web/playwright.config.ts`, production UI/i18n, OCR/Workflow behavior, user dirty files và recovery stash `af82524c6c695d6425119a135810c6cdf0673cb4` không bị thay đổi. Không commit/push.
- Independent `LiveExecutionPanel` SVG console warning (`<circle>` `cx` undefined) vẫn chỉ được ghi nhận, không sửa trong task này.

## 22. Dashboard HTTP real-data slice — verified

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\End\Weav`, `api-gateway`, HEAD `b44332d93057dac01d1bb2657bc37868a2bbeb27` |
| Phạm vi | Dashboard HTTP mode: workflow list/counts/status/Run thật; mock demo giữ nguyên; không đổi AI/Bot/OCR/Playwright config. |
| Trạng thái | Đã triển khai và kiểm tra; chưa commit/push, dirty user tree giữ nguyên. |

### Quyết định và thay đổi

- GitNexus impact trước edit: `DashboardPage` risk `LOW` (caller/process `App`); translation file risk `LOW` với các consumer hiện hữu; không có `HIGH`/`CRITICAL`. Các file chart/live panel không sửa. Test file mới không có symbol indexed; targeted search xác nhận chỉ là fixture mới.
- RED trước production edit: `VITE_API_MODE=http`, `WEAV_E2E_PORT=4223`, `dashboard-real-data.spec.ts`: 3 test body fail vì các testids HTTP chưa tồn tại (exit 1). Đây là fixture RED dự kiến.
- `apps/web/src/pages/DashboardPage.tsx`: giữ `workflowApi.getWorkflows()` làm nguồn dữ liệu; HTTP mode lưu loading/error/workflows, render total/published derivable counts, localized loading/error/empty, workflow name/real ID/status, và chỉ cho Run với `PUBLISHED`. Execution/activity/metric chưa có API đầy đủ hiện là localized unavailable placeholders. Không fallback sang mock khi HTTP lỗi.
- `apps/web/src/lib/i18n/translations.ts`: thêm cặp VI/EN cho loading/error/retry/empty/unavailable và status `PUBLISHED`/`PAUSED`/`DRAFT`.
- `apps/web/e2e/dashboard-real-data.spec.ts`: thêm fixture browser tests populated/empty/503; populated kiểm tra POST path dùng đúng workflow ID thật, draft không có Run, và demo values không xuất hiện. Sửa assertion harness từ biến callback sang awaited request URL sau red evidence; không đổi production.
- `docs/superpowers/plans/2026-09-25-dashboard-real-data-slice.md`: plan đã lưu trước implementation.

### Verification

- HTTP fixture Playwright: `VITE_API_MODE=http WEAV_E2E_PORT=4226 pnpm --dir apps/web exec playwright test e2e/dashboard-real-data.spec.ts --project=chromium --workers=1` → **3 passed, exit 0**; request evidence xác nhận `POST /api/v1/workspaces/{workspaceId}/workflows/{publishedWorkflowId}/executions`; port `4226` đã đóng.
- Existing mock regression: `VITE_API_MODE=mock WEAV_E2E_PORT=4227 pnpm --dir apps/web exec playwright test e2e/workflow-ui.spec.ts --project=chromium --workers=1` → **25 passed, exit 0**; teardown sạch, port `4227` đã đóng. Có warning reduced-motion đã biết, không có failure.
- `pnpm --dir apps/web exec tsc -b` → **exit 0**.
- `pnpm --dir apps/web run build` → **exit 0**, Vite transformed 2,516 modules; chỉ warning bundle JS >500 kB.
- `git diff --check` → **exit 0**; chỉ warning line-ending đã tồn tại ở mobile workspace file. `git ls-files -u` rỗng.

### Giới hạn, fake surfaces và bảo toàn

- Docker stack được kiểm tra read-only bằng `docker compose -f compose.dev.yml ps`: Gateway `3000`, Workflow `8083`, Identity/Workspace và RabbitMQ đang `Up`; `/health` của Gateway và `/actuator/health` của Workflow trả `200`. GET `/api/v1/workspaces?page=0&size=1` không có auth trả `401`, nên chưa chạy authenticated Dashboard live smoke; không dùng credential/cookie không được cấp và không tạo/xóa dữ liệu.
- Browser fixture evidence ở trên không được gọi là live proof. Không khởi động/dừng Docker stack, không chạm Testcontainers.
- Các demo chart/table/`LiveExecutionPanel` vẫn tồn tại trong code nhưng chỉ render khi `VITE_API_MODE=mock`; HTTP Dashboard không mount chúng. AI preview dùng local `setTimeout` và SVG `cx` warning của `LiveExecutionPanel` vẫn là follow-up riêng, không sửa trong slice này.
- Không commit/push/reset/stash/drop stash. Recovery stash `af82524c6c695d6425119a135810c6cdf0673cb4` vẫn ở `stash@{0}`, hai stash cũ vẫn còn; các dirty user files/8 overlap paths và untracked data được giữ nguyên. Full Maven/Testcontainers gap, gồm 116 cases chưa xác minh, không được coi là pass.

### Bàn giao

- Reviewer kiểm tra 4 file thuộc slice: `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/lib/i18n/translations.ts`, `apps/web/e2e/dashboard-real-data.spec.ts`, và work log này; plan nằm ở `docs/superpowers/plans/2026-09-25-dashboard-real-data-slice.md`.
- Bước tiếp theo nếu cần: live read-only Dashboard smoke trên stack test cô lập với auth/workspace đã cấp; sau đó mới cân nhắc thay thế chart/live panel bằng API đầy đủ. Không mở rộng sang AI/OCR/Bot trong task này.

## 23. Runtime refresh — Gateway Workflow proxy route restored

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\\End\\Weav`, `api-gateway`, HEAD `b44332d` |
| Phạm vi | Chỉ rebuild/recreate Docker Compose service `api-gateway`; không sửa source, Quick Actions, DB, volume hoặc service khác. |
| Trạng thái | Đã hoàn thành runtime fix; chưa commit/push. |

### Stack và preflight

- Container labels của project `weav` xác nhận working directory `D:\\End\\Weav`, service `api-gateway`, và compose files `compose.yml`, `compose.dev.yml`, `compose.colab-ocr.dev.yml`; cả ba file đều tồn tại. Lệnh mutation dùng đúng stack này với `--profile app`.
- Trước mutation, `api-gateway` là image `weav-api-gateway`, container cũ chạy khoảng 33 giờ; identity, workspace, workflow, notification và RabbitMQ đều đang `Up` (identity/RabbitMQ healthy). Git status và `stash@{0}` recovery `af82524c...` được giữ nguyên.

### Runtime action và evidence

- Build: `docker compose -p weav -f compose.yml -f compose.dev.yml -f compose.colab-ocr.dev.yml --profile app build api-gateway` → **exit 0**; image mới được tạo từ source hiện tại. Không có source edit trong task.
- Recreate: `docker compose -p weav -f compose.yml -f compose.dev.yml -f compose.colab-ocr.dev.yml --profile app up -d --no-deps --force-recreate api-gateway` → **exit 0**. Không chạy `down`, không xóa volume, không recreate dependency.
- Gateway mới chạy với image ID `sha256:b34129c4...`, trạng thái `Up`; startup log có `WorkflowProxyController {/api/v1/workspaces/:workspaceId/workflows}` và các mapping GET/POST/detail/draft/publish/pause/resume/executions.
- `GET http://127.0.0.1:3000/health` → **200**, `application/json`.
- Exact unauthenticated probe `GET /api/v1/workspaces/af71aa56-ad13-43c1-ac7a-1740b077c0c7/workflows?page=0&size=100` → **401**, JSON `UNAUTHORIZED`, `Bearer token required`. Đây là auth response đúng kỳ vọng, không còn Gateway `Cannot GET` 404.
- Sau recreate, identity, workspace, workflow, notification và RabbitMQ vẫn giữ trạng thái `Up`; không có data mutation.

### Giới hạn và bàn giao

- Đây là runtime verification unauthenticated; chưa chứng minh authenticated list data vì không sử dụng token/cookie. Không chạy Quick Actions, không chạy OCR/Colab, không chạy Testcontainers.
- Quick Actions vẫn ở trạng thái partial theo các mục trước; task này chỉ làm mới Gateway image để route Workflow hiện diện. Full Maven/Testcontainers gap vẫn chưa được coi là pass.
- `git diff --check` sau khi cập nhật log: chạy ở bước bàn giao; không commit/push. Recovery stash và toàn bộ dirty/untracked user files phải tiếp tục được giữ nguyên.

## 24. Runtime refresh — Workflow Service image and Flyway migrations

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-25 (Asia/Saigon)` |
| Checkout | `D:\\End\\Weav`, `api-gateway`, HEAD `b44332d` |
| Phạm vi | Chỉ build/recreate Docker Compose service `workflow-service`; không sửa source, Quick Actions, Gateway, DB schema thủ công hoặc service khác. |
| Trạng thái | Runtime đã cập nhật và health GREEN; chưa commit/push. |

### Preflight và migration safety

- Target labels của `weav-workflow-service-1` xác nhận project `weav`, working directory `D:\\End\\Weav`, và stack đang chạy bằng `compose.yml, compose.dev.yml`. Mutation dùng đúng hai file này; `compose.colab-ocr.dev.yml` không thuộc labels của target.
- Image cũ trước recreate: `weav-workflow-service`, ID `sha256:868ee68df1a69ee7b9344b756ba6a6335dee6340602339b656405724a0471a20`, tạo `2026-09-15`. Container không mount source.
- Source có migration `V1`–`V4`; runtime cũ chỉ có `V1`, database history read-only là `null:true,1:true`, schema current version `1`.
- V2–V4 được đọc trước startup: chỉ tạo bảng/index, thêm cột có default, và unique index có guard. Không có DROP/TRUNCATE. Read-only DB probe xác nhận `DUPLICATE_ENDPOINT_KEY_GROUPS=0`, nên V4 không bị chặn bởi dữ liệu hiện tại.

### Build, recreate và verification

- Build: `docker compose -p weav -f compose.yml -f compose.dev.yml --profile app build workflow-service` → **exit 0**; Docker build log xác nhận named `contracts` context được nạp.
- Recreate: `docker compose -p weav -f compose.yml -f compose.dev.yml --profile app up -d --no-deps --force-recreate workflow-service` → **exit 0**. Không chạy `down`, `--volumes`, prune, broad restart hoặc schema reset.
- Có outage ngắn trong thời gian container compile/start; app start lúc `16:57:44` và `/actuator/health` → **200**.
- Startup log: validate `5` migrations, migrate lần lượt `V2`, `V3`, `V4`, rồi `Started WorkflowServiceApplication`.
- Runtime có `V1__...` đến `V4__...`; compiled `WorkflowController.class` hiện diện và public method `WorkflowResponse.Page list(...)` hiện diện.
- Read-only DB history sau startup: `null:true,1:true,2:true,3:true,4:true`; duplicate endpoint groups vẫn `0`.
- Gateway exact unauthenticated workflow GET → **401 `UNAUTHORIZED`**; không dùng credential nên chưa chứng minh authenticated response. Các container khác vẫn `Up` (Gateway, Identity, Workspace, Notification, RabbitMQ).

### Recovery, limits và handoff

- Image ID cũ đã được ghi nhận trước mutation nhưng sau build/recreate Docker daemon không còn tra cứu được ID đó (`No such image`); không chạy prune/rollback/workaround. Image mới là `sha256:dcd567b87fa5309ddb2619a6a70ff0fcac16a74e8e7a2ffd25a56d09b037ab38`.
- Không có source edit, không đụng Quick Actions/OCR/Colab, không dùng token/cookie, không commit/push. Nếu authenticated GET vẫn 502, cần response đã redact gồm status, `error.code`, `error.message`, và correlation/request id để tiếp tục chẩn đoán; không suy đoán từ unauthenticated 401.

## 25. Runtime config refresh — Workspace internal service key

| Trường | Giá trị |
| --- | --- |
| Thời điểm ghi | `2026-09-26 (Asia/Saigon)` |
| Checkout | `D:\\End\\Weav`, `api-gateway`, HEAD không đổi |
| Phạm vi | Chỉ recreate `workspace-service` và `workflow-service` để nạp key runtime; không sửa `.env`, source, Quick Actions hoặc DB. |
| Trạng thái | Đã nạp config và xác minh service health; chờ user refresh authenticated Dashboard. |

### Preflight và action

- `.env` được quét theo boolean/count-only: file tồn tại, `WEAV_INTERNAL_SERVICE_KEY` có đúng **1 assignment**, non-empty count **1**, `KEY_VALID=True`; không in giá trị hoặc nội dung `.env`.
- Target stack giữ nguyên `docker compose -p weav -f compose.yml -f compose.dev.yml --profile app`; preflight các service đang `Up`.
- Đã chạy đúng lệnh bounded: `docker compose -p weav -f compose.yml -f compose.dev.yml --profile app up -d --no-deps --force-recreate workspace-service workflow-service` → **exit 0**. Không build, `down`, volume/prune hoặc broad restart.
- Chỉ hai target container đổi ID; `api-gateway`, `identity-service`, `notification-service`, `rabbitmq` giữ nguyên ID và vẫn `running`.

### Verification

- Runtime presence-only: `WEAV_INTERNAL_SERVICE_KEY` là `SET` ở cả Workflow và Workspace; không show/hash value.
- Health: Workspace `8082/actuator/health` → **200**; Workflow `8083/actuator/health` → **200**; Gateway `/health` → **200**.
- Internal route probe từ Workflow với key runtime và dummy UUID → **404** (đã qua key filter, dummy resource không tồn tại); cùng route không header → **401**. Không tạo/sửa DB row.
- Gateway exact unauthenticated Workflow GET → **401** (auth gate bình thường); chưa claim authenticated GET vì user chưa refresh lại browser.
- Sau startup, Workflow/Workspace logs có `0` dòng `WorkspaceDependencyUnavailableException`/dependency failure trong cửa sổ kiểm tra; chưa có authenticated retry mới để correlate.

### Handoff

- User cần refresh Dashboard và kiểm tra lại authenticated Workflow GET. Nếu vẫn lỗi, gửi chỉ HTTP status, `error.code`, `error.message`, `x-request-id`/`x-correlation-id` đã redact; không gửi token/cookie/auth header.
- Quick Actions vẫn paused/untouched; không tiếp tục coding trong session này. No commit/push.
