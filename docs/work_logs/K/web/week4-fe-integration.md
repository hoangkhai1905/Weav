# Week 4 FE integration (staging + dev)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-10-06` → `2026-10-07`, Asia/Saigon |
| Nhánh | `feat/week4-fe-integration`, tạo từ `staging` (`c366fbe`), đã gộp `dev` (`991aa12`) |
| Người thực hiện | K + AI agent |
| Trạng thái | Đang tiếp tục: (a) và (b) xong (commit, chưa push); (c) trợ lý AI chưa làm |
| Phạm vi | Đưa các node và trợ lý AI Week 1–4 của backend (`staging`) lên giao diện web |

## 2. Bối cảnh

- `staging` là nhánh tích hợp backend Week 1–4 (tác giả Nguyễn Hoàng Khải, 89 commit chưa có trong `dev`): node Google Calendar/Drive; Telegram trigger + send chuyển vào workflow-service (bỏ bot-service); `logic.switch`, `data.set`, `ai.generate`, `trigger.gmail`; trợ lý AI (ai-service, `ai_db`, Gateway SSE + lịch sử); kho file workflow trên R2; email cc/bcc/HTML/reply/đính kèm; Sheets `lookup`; Calendar `list`; điều kiện AND/OR. Gần như không đụng `apps/web`; commit ghi "FE integration left to the FE owner".
- Tài liệu bàn giao FE (đọc trước khi làm): `docs/api/week4-node-contracts.md`. Nguồn chuẩn của config node: `packages/workflow-schema/nodes/*.json`. Thêm: `docs/superpowers/specs/2026-10-06-email-attachments-design.md`, `docs/superpowers/specs/2026-10-04-messaging-nodes-and-ai-assistant-design.md`, `docs/work_logs/K/workflow/attachments.md`, `node-polish.md`.
- User chọn cách 3: gộp `dev` vào nhánh mới từ `staging` trước, rồi làm FE trên nền đã gộp.

## 3. Gộp `dev` vào nhánh (đã làm)

- Xung đột 1: `compose.dev.yml` (mem_limit api-gateway/notification). Giữ bản `staging`: cả hai `1g` (phía `dev` chỉ đổi đúng 2 dòng này).
- Xung đột 2: `services/workflow-service/.../acceptance/WorkflowV1AcceptanceTest.java`: hai bên cùng thêm test ở một chỗ. Giữ cả `dataSetFeedsSwitchOverRealHttpWithNumericAndNestedManualInput` (staging) và `deleteHidesTheWorkflowAndStopsItsTriggers` (dev) thành hai method.
- Kiểm tra trên cây đã gộp: `pnpm install --frozen-lockfile` qua; web `tsc --noEmit` + `build` qua; api-gateway `test` 9 suite / 112 test qua, `build` qua; `docker compose ... config -q` qua; workflow-service `mvnw clean verify`: xem mục 6.
- Chưa kiểm: ai-service, workspace-service, notification-service (chỉ `staging` đổi, `dev` không đụng); Playwright web; stack thật.

## 4. Kiểm kê FE còn thiếu

So `packages/workflow-schema/nodes/` (20 node) với `apps/web/src/lib/constants/nodeCatalog.ts` (13 node):

- Node backend chưa có trên FE: `trigger.gmail`, `google.drive`, `google.calendar`, `logic.switch`, `data.set`, `ai.generate`.
- Node đã có nhưng thiếu trường mới (chi tiết trong `week4-node-contracts.md`):
  - `email.send`: `cc`, `bcc`, `replyTo`, `bodyType` (text/html), `senderName`, `replyToMessageId`, `attachments` (`{url|fileId, filename?}`, tối đa 5, hoặc template).
  - `google.sheets`: thao tác `lookup` (thêm `read/append/update`).
  - `logic.condition`: AND/OR nhiều điều kiện; schema đã nới `required`, UI phải tự áp quy tắc bắt buộc theo dạng.
  - `telegram.send_message`: tùy chọn mới.
  - `google.calendar`: requiredness theo thao tác.
- Trợ lý AI: chưa có UI (Gateway có route lịch sử + SSE; xem spec messaging-nodes-and-ai-assistant).
- Template: `{{ trigger.input.attachments[0].fileId }}`, chỉ số `[n]`; biểu thức trọn vẹn giữ kiểu gốc.

Cấu trúc FE hiện tại: form inspector viết tay cho từng node trong `apps/web/src/pages/WorkflowBuilderPage.tsx` (2.386 dòng; nhánh `selectedNodeType === '...'` quanh dòng 1608–1830). Liên quan: `lib/constants/nodeCatalog.ts` (catalog + `catalogDefaultConfig`), `lib/nodeReadiness.ts` (trường bắt buộc), `components/builder/CustomWorkflowNode.tsx` (icon), map node ở đầu `WorkflowBuilderPage.tsx` (~dòng 88), `lib/i18n/translations.ts` (vi + en, phải đủ cả hai).

## 5. Quyết định đang chờ user

**Đã chốt (2026-10-06): cách 3, kết hợp.**

Cách dựng form inspector:
1. Viết tay tiếp từng node trong `WorkflowBuilderPage.tsx`.
2. Sinh form từ JSON Schema của `packages/workflow-schema/nodes/*.json` (bộ render chung; trường đặc biệt như chọn kết nối, cột Sheets, điều kiện vẫn viết tay).
3. Kết hợp (agent đề xuất): bộ render theo schema cho 6 node mới và trường mới; giữ form viết tay đang chạy của node cũ, chuyển dần sau.

Thứ tự đề xuất: (a) trường mới của node đã có → (b) 6 node mới → (c) trợ lý AI. Mỗi phần kiểm trên stack thật rồi commit riêng.

## 6. Kiểm tra workflow-service trên cây đã gộp

- Chạy `mvnw clean verify` trong container `eclipse-temurin:25-jdk` (máy chỉ có JDK 21), mount repo + `/var/run/docker.sock`, `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`, `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`, cache Maven ở volume `weav-m2-tmp`; chép `mvnw` + `.mvn` ra `/tmp/w` và bỏ CRLF trước khi chạy.
- Kết quả: **qua** (chỉ còn lỗi môi trường đã biết).
  - Lần 1 (2026-10-06 23:55): Docker Desktop chết giữa lần chạy (mọi API trả 500; ổ C còn 23 GB; khoảng 39 cặp postgres/rabbitmq Testcontainers bị bỏ lại, nhiều khả năng làm cạn RAM). Có báo cáo 103/106 class: 819 test, 0 failure, 3 error, đều là lỗi môi trường (`HttpTransportIntegrationTest` x2, `WorkflowNotificationLifecyclePersistenceIntegrationTest` x1).
  - Lần 2 (2026-10-07 00:07, sau khi user restart Docker và agent xóa 39 container Testcontainers còn sót): `mvnw test -Dtest=WorkflowJsonbRoundTripTest,WorkflowPersistenceIntegrationTest,WorkflowPersistenceTest`: `WorkflowJsonbRoundTripTest` 1/1 qua, `WorkflowPersistenceTest` 2/2 qua; `WorkflowPersistenceIntegrationTest.java` là file rỗng 0 byte từ commit scaffold `05ecdf4`, không có test.
  - Ghi chú: hook chặn lệnh docker làm thay đổi trạng thái trong Bash; chạy qua PowerShell sau khi user đồng ý. `weav-rabbitmq` của stack dev đang Exited sau restart, cần `up` lại trước khi kiểm stack thật.

## 6a. Phần (a): trường mới của node đã có (2026-10-07)

Cách làm (chốt cách 3): bộ render theo schema cho trường đơn giản, viết tay cho phần đặc thù.

- `apps/web/src/lib/nodeSchemas.ts`: nạp `packages/workflow-schema/nodes/*.json` bằng `import.meta.glob` (Vite; không cần package mới). Dùng lại được cho phần (b).
- `components/builder/SchemaField.tsx`: một field theo schema property (enum → select có "Mặc định", boolean → checkbox, integer → ô chữ lưu số khi là số nguyên, còn lại là text; `x-weav-connection` → select kết nối). Để trống = xóa key. Nhãn lấy từ `builder.field.<type>.<name>`, gợi ý từ `..._hint`; thiếu key thì dùng `title` của schema.
- `components/builder/ConditionEditor.tsx` (viết tay): chuyển giữa dạng một điều kiện và nhiều điều kiện AND/OR (1–10), khi chuyển thì xóa key của dạng kia (tránh `CONDITION_FORM_CONFLICT`). **Sửa lỗi cũ**: với `gt/gte/lt/lte`, toán hạng là số được lưu dạng số (trước đây lưu `"500"` nên publish bị `NUMERIC_OPERAND_REQUIRED`).
- `components/builder/AttachmentsEditor.tsx` (viết tay): `email.send.attachments` dạng danh sách (tối đa 5, mỗi mục URL hoặc file ID + tên tệp) hoặc một biểu thức mapping.
- `WorkflowBuilderPage.tsx`: email thêm `bodyType`, `cc`, `bcc`, đính kèm, mục "Tùy chọn nâng cao" (`senderName`, `replyTo`, `replyToMessageId`); Sheets thêm thao tác `lookup` (`lookupColumn`, `lookupValue`, `limit`) và `valueInputOption` khi ghi; Telegram send **bật lại** (trước bị đánh dấu "Chưa khả dụng" và chặn publish): chọn kết nối TELEGRAM, `parseMode`, `disableNotification`, `replyToMessageId`. Thông báo readiness của node có kết nối gom vào `CONNECTION_STEP_MESSAGES`.
- `lib/nodeReadiness.ts`: lookup cần cột + giá trị; `values` chỉ bắt buộc khi append/update; điều kiện dùng `isConditionComplete` (cả hai dạng); Telegram send cần kết nối + `chatId` + `text`.
- i18n: thêm 62 key vi + en, sửa 4 key, xóa `builder.cfg.msg_tg_send` (không còn dùng). Mô tả catalog của 4 node cập nhật.
- Chưa làm trong (a): `trigger.telegram` vẫn "Chưa khả dụng" (cần kết nối + webhook công khai); `google.calendar` là node mới, sang (b).

Kiểm tra:
- `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json`: qua. `pnpm --dir apps/web build`: qua.
- eslint các file đã đổi: chỉ còn lỗi `react-hooks/set-state-in-effect` có sẵn ở HEAD (`WorkflowBuilderPage.tsx`, effect tải workflow), không do thay đổi này.
- Playwright (`VITE_API_MODE=http`, chromium), 4 test mới trong `workspace-connections.spec.ts` ("workflow builder Week 4 node fields"): lookup, email (cc/html/đính kèm/mapping/giới hạn 5), điều kiện AND/OR + số, Telegram: qua; cùng 12 test builder cũ: 16/16 qua.
- Chạy đủ `localization`, `workflow-catalog-v1`, `workspace-connections`: 54 qua, 11 fail; chạy cùng 3 spec trên HEAD (tạm trả 5 file về HEAD rồi khôi phục): đúng 11 test đó cũng fail (lỗi có sẵn: chuỗi localization, palette catalog-v1, 401 adapter). Không có regression.
- Stack thật (2026-10-07 00:50): `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build` (code đã gộp, bật lại `weav-rabbitmq`); Vite 5173 (của phiên khác, cùng thư mục). Tạo workflow thử `bf546b65-c350-48a4-b310-441ba10aa9c2` qua UI, thêm điều kiện AND/OR (`gt 500` + `eq paid`), Sheets lookup (bảng tính thử, cột A, `limit` 5), email (html, cc 2 địa chỉ, 1 đính kèm URL, `senderName`), Telegram (HTML, im lặng, reply 42; workspace chưa có kết nối TELEGRAM nên form hiện gợi ý + link). `PUT .../draft` → 200 cả hai lần, server trả lại đúng config (`right: 500` là số, `limit: 5`, `replyToMessageId: 42`, `disableNotification: true`). Badge: điều kiện/Sheets/email "Sẵn sàng", Telegram "Chưa cấu hình" (thiếu kết nối). Console: chỉ có `ERR_EMPTY_RESPONSE`/503 từ lần tải đầu khi stack vừa khởi động; document hiện tại không có request lỗi.
- Lỗi tìm thấy khi kiểm stack thật và đã sửa: hàng đính kèm, `select` nguồn có cả `w-full` và `w-28` nên ô URL chỉ còn 21px (tràn panel). Tách class; đo lại ô URL 200px. Thêm assertion độ rộng > 150px vào e2e email; 4/4 qua.
- Chưa làm: chạy thật (publish + run) workflow với Sheets lookup/email gửi thật; publish, gửi Telegram cần kết nối bot.
- Workflow thử `bf546b65…`: user đồng ý, đã xóa qua UI (DELETE 204).

## 6b. Phần (b): 6 node mới + provider Drive/Calendar (2026-10-07)

Chia việc: agent chính lên kế hoạch, viết code chính, review, commit; subagent Sonnet làm i18n, e2e và kiểm trên stack thật (user yêu cầu để tiết kiệm token).

- Kết nối: `api/connection.api.ts` thêm `GOOGLE_CALENDAR`, `GOOGLE_DRIVE` (`GOOGLE_PROVIDERS`). **Sửa lỗi ngầm**: `parseConnection` từ chối provider lạ, nên một kết nối Drive/Calendar làm hỏng cả danh sách. `ConnectionsPage` cho tạo 2 provider mới + OAuth.
- Catalog (`nodeCatalog.ts`): `trigger.gmail`, `google.drive`, `google.calendar`, `logic.switch`, `data.set`, `ai.generate` (icon, palette, default config). `nodeSourcePorts`: switch có một cổng mỗi case + `default` (bỏ case trống và `default`); `CustomWorkflowNode` rải cổng đều khi > 2, node cao theo số cổng, `useUpdateNodeInternals` khi cổng đổi, nhãn cổng không xuống dòng.
- Inspector: `SCHEMA_FORMS` trong `WorkflowBuilderPage.tsx` render bằng `SchemaField` theo thao tác (Gmail trigger, Drive upload/list, Calendar create/list, AI generate), kèm chọn kết nối theo provider + nút thêm kết nối. `SchemaField` thêm textarea và mảng chuỗi (attendees: "a, b" → mảng; mapping giữ chuỗi). Viết tay: `SwitchEditor` (value + 1–20 case, báo lỗi trống/`default`/mapping/trùng; đổi hoặc xóa case thì bỏ cạnh của cổng đó), `DataSetEditor` (tên/giá trị, tối đa 100, tên ≤ 128, báo trùng; hoặc mapping).
- Readiness (`nodeReadiness.ts`): Drive upload có `content` cần `name`, `content` + `file` cùng lúc = chưa cấu hình; Calendar create cần summary/start/end; switch/data.set theo `DefinitionValidator`; AI cần prompt. Thông báo inspector + publish blocker cho cả 6.
- i18n: subagent thêm 90 key vi + en (tên node, nhãn field + gợi ý, thông báo, switch, data.set, `port_default`); script kiểm không thiếu key, không trùng.
- Sửa thêm: `ConditionEditor.tsx` export hằng làm eslint `react-refresh/only-export-components` báo lỗi (lọt từ commit `ac03bee`) → bỏ export.

Kiểm tra:
- `tsc --noEmit -p tsconfig.app.json`, eslint các file đã đổi, `pnpm build`, `git diff --check`: qua (build từng fail vì spec dùng `HTMLOptionElement`, đã đổi sang `getAttribute`).
- Playwright: subagent thêm describe "workflow builder Week 4 new nodes" (8 test: Drive, Calendar, Gmail trigger, AI generate, switch + bỏ cạnh, data.set, Connections page 2 provider, palette). Week 4: 12/12 qua; lặp 3 lần 36/36. Cả spec: 53 qua, 2 fail đúng 2 lỗi có sẵn (401 adapter). Một lần chạy đầu fail 1 test `toContainText` không lặp lại được (nghi Vite biên dịch lần đầu).
- Stack thật (subagent, browser pane): workflow thử `3b2a581f-893f-4ade-b76e-4c963385beea`, thêm cả 6 node, `PUT .../draft` → 200; server trả đúng kiểu (`cases` mảng, `fields` object, `maxLength` 200, `attendees` mảng, `pageSize` 20, `pollIntervalMinutes` 15). Workspace chưa có kết nối Gmail/Drive/Calendar nên inspector hiện gợi ý + nút thêm. Console: chỉ 403 refresh lúc tải trang rồi retry 200. Đã xóa workflow thử (DELETE 204).
- Giới hạn đã biết: `data.set` lưu mọi giá trị dạng chuỗi (`42` → `"42"`); muốn số thì dùng mapping hoặc thêm chọn kiểu sau. Đổi Drive/Calendar sang `list` không xóa các key của `upload`/`create` (vô hại với executor, chưa kiểm). Chưa chạy thật (publish + run), chưa thử OAuth cho 2 provider mới.

## 7. Hướng dẫn cho agent tiếp theo

1. `git status`: phải đang ở `feat/week4-fe-integration`, worktree sạch (trừ `examples/` không thuộc dự án). Kiểm `git log -1` là merge commit "Merge branch 'dev' into feat/week4-fe-integration".
2. Nếu mục 6 còn PENDING: chạy lại `verify` workflow-service, ghi kết quả. Lỗi chỉ được chấp nhận nếu nằm trong danh sách lỗi môi trường ở CLAUDE.md.
3. Hỏi user mục 5 nếu chưa có câu trả lời. Không tự chọn.
4. Đọc `docs/api/week4-node-contracts.md` và schema node tương ứng trước khi làm từng node.
5. Mỗi node/trường: thêm vào catalog, readiness, form inspector, i18n vi+en; e2e trong `apps/web/e2e/workspace-connections.spec.ts` (mẫu stub `page.route`, chạy với `VITE_API_MODE=http`); kiểm trên stack thật (Vite cổng 5173, `docker compose -f compose.yml -f compose.dev.yml --profile app up -d --build`), có console/network.
6. Kho file (đính kèm, Drive bằng file) cần `WORKFLOW_FILES_S3_*` trên workflow-service; thiếu thì node báo `DEPENDENCY_NOT_CONFIGURED`. AI (`ai.generate`, trợ lý) cần ai-service bật (`DEEPSEEK_API_KEY`, `WORKFLOW_AI_ENABLED`, xem CLAUDE.md). Chỉ kiểm tra biến đã đặt, không in giá trị.
7. Không push/merge vào `staging` hay `dev` khi chưa được user đồng ý.

## 8. Việc khác còn mở (từ các phiên trước)

- Nút "Tạo bằng AI": user chọn nối vào luồng thật (tạo bản nháp rồi mở builder với `GenerateWorkflowPanel` bật sẵn), làm sau. `/ai/workflow-generator` (`AiGeneratorPage`) hiện chỉ là demo `setTimeout`.
- Volume tạm `weav-m2-tmp` (cache Maven) còn; hook chặn agent xóa volume, user tự chạy `docker volume rm weav-m2-tmp` khi không cần.
- Stack dev đang chạy bản build từ `dev`; khi chuyển sang code đã gộp cần build lại các service (`--build`).
- Stash `stash@{0}` (`codex/web-session-renewal`) là bản làm dở cũ của tính năng giữ đăng nhập; tính năng đã xong bằng cách khác (xem `web-session-renewal.md`), stash để nguyên.

## 9. Kết thúc phiên

| Trường | Giá trị |
| --- | --- |
| Worktree | Merge đã commit trên `feat/week4-fe-integration` (chưa push) |
| Cần đọc trước | Mục 5, 7 và `docs/api/week4-node-contracts.md` |
