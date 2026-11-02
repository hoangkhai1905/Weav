# Nhật ký: mẫu workflow dùng chung, backend (W6-C1)

> Một log cho cả tính năng, cập nhật tại chỗ. Mẫu: `docs/work_logs/log_template.md` (bản rút gọn). Thiết kế: `docs/superpowers/specs/2026-10-09-w6c-shared-templates-design.md`; kế hoạch: `docs/superpowers/plans/2026-10-09-w6c-shared-templates.md` (Lane W6-C1, Task 1-5).

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-09 |
| Nhánh | `feat/w6-c1-templates-backend` (từ `week6` e9a1710), worktree `T:\Weav-wt\w6-c1` |
| Người thực hiện | Coding agent lane W6-C1 (coordinator review/commit) |
| Trạng thái | Hoàn thành code + kiểm tra tự động; chưa commit; chưa kiểm tra trên stack thật |
| Phạm vi | workflow-service (V14, bộ lọc dữ liệu cá nhân, store, service, API), gateway (route + rate limit `template`), contracts, `.env.example` |

## 2. Tóm tắt

- Người dùng chia sẻ một workflow thành mẫu (snapshot đã làm sạch): PRIVATE (thành viên workspace nguồn), UNLISTED (ai có mã/id), PUBLIC (thư viện). Chia sẻ lại cùng workflow cập nhật mẫu cũ (giữ id và mã). `POST /templates/{id}/use` sao mẫu thành workflow nháp trong workspace đích, đếm lượt dùng trong cùng transaction.
- Làm sạch theo schema node: từ khóa mới `x-weav-personal` (7 node đã đánh dấu). Xóa `connectionId`; trường cá nhân chỉ giữ khi là đúng một biểu thức `{{ }}`; giá trị `variables` thành `""`; `editorState` chỉ giữ `name` và `position`. Văn bản tự do có email hoặc chuỗi giống token chỉ bị cảnh báo (không sửa).
- Gateway: 8 route mới + bucket giới hạn `template` (`GATEWAY_TEMPLATE_RATE_LIMIT`, 20/phút/người dùng).

## 3. Quyết định kỹ thuật

| Quyết định | Lý do | Giới hạn / việc theo dõi |
| --- | --- | --- |
| `NodeConfigSchema.Field` thêm thành phần `personal` ở cuối + giữ constructor 13 tham số cũ | `NodeConfigSchema` nằm trên đường thực thi (impact CRITICAL); không đổi call site nào | Chỉ `ClasspathNodeSchemaSource` dùng constructor mới |
| `TemplateSanitizer` không nhận `NodeCatalog` (lớp tĩnh) và các record kết quả là record lồng trong `TemplateSanitizer` | `NodeCatalog` chỉ có phương thức static, không có constructor dùng được | Tên đầy đủ: `TemplateSanitizer.SanitizedTemplate/RemovedField/TemplateWarning` |
| Mã chia sẻ do `TemplateAdapter.insert` tự sinh (`SecureRandom`), `INSERT ... ON CONFLICT (share_code) DO NOTHING` rồi thử lại tối đa 5 lần | Vi phạm unique của index `source_workflow_id` vẫn ném `DuplicateKeyException` (xung đột thật), không bị nuốt | Mã trên `Template` truyền vào `insert` bị bỏ qua |
| `DefinitionMaps` (domain) chuyển Map JSON <-> `WorkflowDefinition` | ArchUnit cấm `application` phụ thuộc `infrastructure` nên không dùng `DefinitionJsonCodec` | Chỉ dùng cho dữ liệu đã lưu/đã validate |
| Mã chia sẻ: PRIVATE không bao giờ resolve theo mã, kể cả chủ sở hữu | Đúng spec (PRIVATE hoặc không biết = 404) | Chủ sở hữu mở mẫu bằng id |
| `use`: kiểm `WORKFLOW_CREATE` ở workspace đích TRƯỚC khi mở transaction; `createWithDraft` kiểm lại (cache 30 s) | Giữ quy ước "gọi từ xa ngoài transaction ghi" | Một lần gọi quyền dư khi cache nguội |
| `createWithDraft` từ chối định nghĩa còn `connectionId` (400) | Mẫu đã sạch; chặn đường vòng bỏ qua kiểm tra gắn kết nối | |
| Controller đọc body dạng chuỗi rồi parse strict (`FAIL_ON_UNKNOWN_PROPERTIES`) + chạy Bean Validation | Spring Boot mặc định bỏ qua field lạ; spec yêu cầu 400 | Khác `@Valid @RequestBody` ở thông báo lỗi (một dòng) |
| Quyền "thấy mẫu PRIVATE" = `WORKFLOW_MONITOR` (mọi thành viên có); `ForbiddenException`/`ResourceNotFoundException` từ kiểm quyền nghĩa là ẩn (404) | Workspace đã xóa trả 404 nên mẫu PRIVATE biến mất đúng spec | `WorkspaceDependencyUnavailableException` vẫn lan ra thành 503 |
| Rate limit `template` tính theo `sub` của JWT (như OCR/assistant), áp cho mọi route không phải GET dưới `/templates`, `.../template[/preview]` và `GET /templates/by-code/*` | Mã 8 ký tự là điểm dò duy nhất | Các GET khác vẫn nằm trong bucket chung |

## 4. Thay đổi

- **Migration `V14__workflow_templates.sql`** (chỉ thêm): bảng `workflow_templates` + 4 index (xem spec mục 2).
- **workflow-service:** `domain/template/{TemplateSanitizer, ShareCode, DefinitionMaps}`, `TemplateVisibility`, cổng `TemplateStore`, `TemplateAdapter` (JDBC, JSONB, `text[]`, ILIKE có escape), `TemplateService`, `TemplateController`, `TemplateRequests`, `TemplateResponse`; `WorkflowDraftService.createWithDraft` (thêm); `NodeConfigSchema` (+`personal`, `personalFields()`, `connectionFields()`); `ClasspathNodeSchemaSource` (từ khóa mới); `ConflictException(code, message)` (thêm).
- **packages/workflow-schema:** `x-weav-personal` trên email.send (to, cc, bcc, replyTo, senderName), telegram.send_message (chatId), google.sheets (spreadsheetId), google.drive (folderId), google.calendar (calendarId, attendees), http.request (headers, query), ocr.extract (artifactId, fileUrl).
- **apps/web:** chỉ kiểu `SchemaProperty['x-weav-personal']`.
- **api-gateway:** `WorkflowTemplateProxyController`, `TemplateProxyController`, `isTemplateRequest`, throttler `template`, `GATEWAY_TEMPLATE_RATE_LIMIT`.
- **contracts:** `http/workflow/openapi.yaml` (6 path, 8 operation, schema Template*), `README.md`.
- **Cấu hình:** `.env.example` (`GATEWAY_TEMPLATE_RATE_LIMIT=20`), README gateway, `docs/specs/services/api-gateway.md`.

## 5. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Sanitizer | `./mvnw -q test -Dtest=TemplateSanitizerTest,*Schema*,*Definition*` | PASS (8 test sanitizer, gồm test bảo vệ `everyIdLikeFieldIsClassified`) |
| Store | `-Dtest=ShareCodeTest,TemplateAdapterTest` | PASS (4 + 7; Testcontainers) |
| Service + draft | `-Dtest=TemplateServiceTest,WorkflowDraftServiceTest` | PASS (16 + 6) |
| HTTP | `-Dtest=TemplateHttpTest` | PASS (6; sau khi thêm parse strict cho field lạ) |
| workflow-service đầy đủ | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | 943 test, 1 lỗi môi trường đã biết: `compiledNotificationConsumerPersistsAllSixV2EventsInJwtScopedInbox` (thiếu `notification-service/dist`) |
| Gateway | `pnpm --dir services/api-gateway test` / `test:e2e` / `build` | PASS 134 / PASS 133 / PASS |
| Gateway lint | `pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"` | 2 lỗi có sẵn ở `notifications.module.ts` (không thuộc lane); file đã sửa sạch |
| Hợp đồng | js-yaml parse `openapi.yaml`, mọi `$ref` resolve | PASS |

### Chưa kiểm tra

- Chạy trên stack thật / Neon `dev-k` (coordinator làm); không có Playwright vì không có UI trong lane này.

## 6. Rủi ro

| Mức | Vấn đề | Xử lý |
| --- | --- | --- |
| Trung bình | Văn bản tự do (prompt, nội dung, URL) có thể chứa dữ liệu cá nhân | Cảnh báo EMAIL/TOKEN + web bắt buộc tick xác nhận; chủ sở hữu xóa được; ADMIN gỡ PUBLIC được |
| Thấp | Node mới quên đánh dấu `x-weav-personal` | Test bảo vệ `everyIdLikeFieldIsClassified` |
| Thấp | Lần chia sẻ đầu của cùng workflow bởi hai người cùng lúc | Index unique một phần; người thua nhận 409 `TEMPLATE_OWNED_BY_OTHER` |

## 7. Bàn giao

- Lane C2 (web) xây trên các dạng JSON trong mục `Template*` của `openapi.yaml`; lane C3 thêm route cancel vào cùng `workflow.module.ts`/`openapi.yaml` (hợp nhất union).
- Mobile: mục "C. Shared templates API" trong `docs/handoff/2026-10-week6-mobile.md`.
- `compose.dev.yml`: coordinator đã thêm `GATEWAY_TEMPLATE_RATE_LIMIT`.

## 8. Vòng sửa sau review 1 (2026-10-09)

- Sanitizer fail closed: node không có trong catalog làm preview/share trả 400 `TEMPLATE_NODE_NOT_SHAREABLE` (nêu id node). Biểu thức "thuần" phải là một đường dẫn mapping (`{{ "a@b.com" }}` bị xóa). `editorState.position` chỉ giữ `x`, `y` dạng số. `google.drive.file` đã đánh dấu `x-weav-personal`.
- `TemplateService`: định nghĩa lưu hỏng (`DefinitionMaps` ném `IllegalArgumentException`) thành 400; chia sẻ lần đầu thua race (`DuplicateKeyException`) đọc lại một lần rồi đi đường cập nhật (cùng chủ) hoặc 409 (khác chủ); `null` = "không có" (PATCH giữ nguyên, chuỗi rỗng vẫn xóa mô tả).
- `TemplateController`: đọc body với phát hiện khóa trùng, từ chối nội dung thừa phía sau JSON, giới hạn 16 KB (400). `TemplateAdapter` nhận `RandomGenerator` (constructor thứ hai) để test ép trùng mã chia sẻ.
- Gateway zod chấp nhận `null` cho `description`, `authorName`, `name`, `visibility` (PATCH) và chuyển tiếp.
- Test thêm: sanitizer (map lồng, list, số, đường dẫn, position), service (race, node lạ, định nghĩa hỏng), adapter (trùng mã chia sẻ), HTTP (khóa trùng, nội dung thừa, quá lớn), gateway (null).
- Chủ ý giữ nguyên (spec mục 2): mẫu UNLISTED/PUBLIC của workspace đã xóa vẫn tồn tại vì không chứa credential; chủ sở hữu quản lý bằng `owner_id`.
- Kiểm tra: workflow-service `verify` 951 test, 1 lỗi môi trường đã biết (thiếu `notification-service/dist`); gateway `test` 135, `test:e2e` 133, `build` OK, eslint các file đã sửa sạch.
