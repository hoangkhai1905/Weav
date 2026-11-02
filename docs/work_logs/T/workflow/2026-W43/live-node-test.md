# Live test toàn bộ node workflow

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-10-22` |
| Múi giờ ghi log | `Asia/Saigon` |
| Nhánh / commit đầu ngày | `dev` / `e05467f1` |
| Người thực hiện | T (AI agent) |
| Trạng thái | `Hoàn tất` (24/26 loại node PASS; Slack, Teams bỏ qua theo quyết định người dùng) |
| Phạm vi | Chạy toàn bộ dev stack và test end-to-end 26 loại node qua API Gateway, sửa lỗi tìm được |

## 2. Tóm tắt

- 24/26 loại node PASS trên stack thật (`compose.yml` + `compose.dev.yml`, profile `app`, gateway `localhost:3000`, workspace "test 1", tài khoản test `+weavtest`).
- Bug thật đã sửa: `format.text` `number_format` từ chối số được map từ bước trước (`INVALID_FIELD_TYPE@config.value`) và hủy cả execution.
- ai-service crash-loop OOM ở `mem_limit: 384m` (`nest start --watch`); nâng lên `1g` như gateway/notification (commit `dc1d1340`).
- Mô tả cron trong schema đưa ví dụ 5 trường trong khi backend bắt buộc 6 trường (có giây).

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Unit test | PASS | `./mvnw -q -Dtest='NodeConfigSchemasTest,FormatText*Test,ExecutionRunner*Test,DefinitionValidator*Test' test` với JDK 25 |
| Live test | 24/26 PASS | driver Node qua gateway, xem mục 9 |
| `git diff --check` | PASS | |
| Commit | Đã tạo | nhánh `fix/workflow-live-node-test`, sau GitNexus `detect_changes` |

## 7. Thay đổi đã thực hiện

- `workflow-service` `NodeConfigSchema.stringOnlyFields()`: ngoài trường `type: string`, nay gồm cả trường `oneOf` có nhánh string và không có nhánh number/integer/boolean. Runtime (`ExecutionRunner`) ép số/boolean được map vào các trường này thành text. Ảnh hưởng: `format.text.value`, `email.send` `to/cc/bcc/replyTo/attachments`. `format.datetime.value` (string|integer) giữ nguyên số.
- `packages/workflow-schema/nodes/trigger.schedule.json`: mô tả cron ghi rõ 6 trường bắt đầu bằng giây (`0 0 9 * * 1-5`). Chỉ đổi `description`.
- `compose.dev.yml`: ai-service `mem_limit: 1g`.
- Cấu hình cục bộ (không commit): `WORKFLOW_PUBLIC_BASE_URL` trong `.env` trỏ tới quick tunnel mới để test `trigger.telegram`.

## 8. File ảnh hưởng

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/NodeConfigSchema.java` | quy tắc ép kiểu text |
| Sửa | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/NodeConfigSchemasTest.java` | kỳ vọng mới + case `format.text`/`format.datetime` |
| Sửa | `packages/workflow-schema/nodes/trigger.schedule.json` | mô tả cron |
| Sửa | `compose.dev.yml` | ai-service 1g |

## 9. Kiểm tra và bằng chứng

Driver: `run-nodes.mjs` (scratchpad của session, chưa đưa vào repo). Mỗi nhóm tạo workflow `Live test <nhóm> <timestamp>`, publish, chạy, đọc execution detail, cuối cùng pause.

| Nhóm | Node | Kết quả |
| --- | --- | --- |
| core | `trigger.manual`, `data.set`, `format.text` (upper/replace/split/truncate/number_format), `format.datetime` (now/add/format), `logic.switch` (3 nhánh), `logic.condition` (true/false), `http.request` GET/POST | 28/28 PASS sau khi sửa (`1234567` → `1.234.567`) |
| webhook | `trigger.webhook` | PASS; sai `X-Webhook-Secret` → 404, đúng → 202 + run SUCCESS, input map đúng |
| schedule | `trigger.schedule` `0 * * * * *` | PASS, run `SCHEDULE` trong 1 phút |
| event | `trigger.workflow_event` | PASS (cả SUCCEEDED và FAILED) |
| control | `weav.workflow` run/status/pause/resume/list_failures/command | 6/6 PASS |
| ai | `ai.generate`, `ai.summarize`, `ai.classify`, `ai.extract` | 4/4 PASS (DeepSeek thật) |
| ocr | `ocr.extract` fileUrl (`raw.githubusercontent.com`, host duy nhất trong `OCR_URL_ALLOWLIST`) | PASS, đọc đúng chữ |
| google | `google.calendar` create/list, `google.drive` upload/list/download, `google.sheets` read/lookup | 7/7 PASS |
| messaging | `telegram.send_message` (thường + HTML silent), `email.send` | PASS |
| gmail | `trigger.gmail` (mail tự gửi bằng `email.send` cùng hộp thư, subject riêng mỗi lần chạy) | PASS, run `GMAIL` |
| telegram | `trigger.telegram` qua quick tunnel | PASS (trigger ACTIVE, run `TELEGRAM` SUCCESS, bot echo). Driver ghi FAIL do tin tới trễ 3 s sau cửa sổ chờ 300 s; execution xác nhận SUCCESS |
| channels | `discord.send_message` | PASS |

### Chưa kiểm tra

- `slack.send_message`, `teams.send_message`: workspace chưa có connection (cần incoming webhook URL); người dùng quyết định bỏ qua lượt này.
- `google.sheets` append/update: không chạy để tránh ghi vào sheet thanh toán SePay thật.

## 10. Rủi ro và phát hiện

| Mức độ | Vấn đề | Ghi chú |
| --- | --- | --- |
| Trung bình | MEMBER chỉ gắn được connection do chính mình tạo (`AuthorizeConnectionAttachmentUseCase`: OWNER/creator) | Đúng thiết kế. Đã tạo connection `Live test *` bằng tài khoản test |
| Thấp | Quick tunnel Cloudflare đổi URL mỗi lần chạy | Phải cập nhật `.env` và recreate workflow-service |
| Thấp | Dữ liệu test còn lại | 2 sự kiện Calendar ngày 2026-10-23 "Weav live test …", 2 file Drive `weav-live-test-*.txt`, tin Telegram/Discord/email test, các workflow `Live test *` (đã pause), các connection `Live test *` |

## 11. Việc tiếp theo

1. Khi có connection Slack/Teams, chạy nhóm `channels`.
2. Merge nhánh vào `dev` sau khi review.
3. Cân nhắc đưa driver vào `scripts/` để chạy lại không cần nhập tay (khác `live-test-nodes.ps1`).
