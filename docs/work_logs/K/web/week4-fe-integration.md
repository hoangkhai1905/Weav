# Week 4 FE integration (staging + dev)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-10-06`, Asia/Saigon |
| Nhánh | `feat/week4-fe-integration`, tạo từ `staging` (`c366fbe`), đã gộp `dev` (`991aa12`) |
| Người thực hiện | K + AI agent |
| Trạng thái | Đang tiếp tục: đã gộp và kiểm tra; chưa làm phần FE |
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

Cách dựng form inspector (đã hỏi, chưa trả lời):
1. Viết tay tiếp từng node trong `WorkflowBuilderPage.tsx`.
2. Sinh form từ JSON Schema của `packages/workflow-schema/nodes/*.json` (bộ render chung; trường đặc biệt như chọn kết nối, cột Sheets, điều kiện vẫn viết tay).
3. Kết hợp (agent đề xuất): bộ render theo schema cho 6 node mới và trường mới; giữ form viết tay đang chạy của node cũ, chuyển dần sau.

Thứ tự đề xuất: (a) trường mới của node đã có → (b) 6 node mới → (c) trợ lý AI. Mỗi phần kiểm trên stack thật rồi commit riêng.

## 6. Kiểm tra workflow-service trên cây đã gộp

- Chạy `mvnw clean verify` trong container `eclipse-temurin:25-jdk` (máy chỉ có JDK 21), mount repo + `/var/run/docker.sock`, `TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`, `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`, cache Maven ở volume `weav-m2-tmp`; chép `mvnw` + `.mvn` ra `/tmp/w` và bỏ CRLF trước khi chạy.
- Kết quả: PENDING (đang chạy khi ghi log; agent cập nhật dòng này).

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
