# Nhật ký: AI tạo workflow kiểu Zapier trên web — 2026-11-09

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-11-09 (Asia/Saigon) |
| Nhánh / base | `feat/web-ai-generate-zapier-style` (từ `dev`, base `ad787bd0`) |
| Người thực hiện | AI agent (Claude), theo yêu cầu của T |
| Trạng thái | Hoàn thành phần web; chưa merge, chưa push |
| Tài liệu liên quan | `docs/superpowers/specs/2026-11-09-ai-generate-zapier-style-design.md`, plan cùng tên trong `docs/superpowers/plans/` |

## 2. Kết quả chính

- AI generator tạo draft ngay (`allowBlanks`), không còn hỏi từng câu; vào thẳng builder.
- Bước chưa cấu hình hiện màu đỏ; thanh "Bước cần thiết lập" liệt kê chip bấm được để nhảy tới bước đó.
- Nếu workspace chỉ có đúng một connection phù hợp cho bước, tự gắn vào bước.
- Panel "Generate with AI" trong builder cũng dựng ngay, không hỏi.

## 3. Quyết định

| Quyết định | Lý do |
| --- | --- |
| Chỉ làm web | Mobile giữ luồng hỏi cũ; làm đồng bộ mobile ở bước sau |
| `allowBlanks` khi gọi generate | Cho phép draft thiếu thông tin thay vì chặn bằng câu hỏi |
| Tự chọn connection chỉ khi có đúng 1 ứng viên | Tránh đoán sai khi có nhiều tài khoản |
| Màu đỏ áp dụng cho mọi workflow, không riêng workflow AI | Một quy tắc hiển thị duy nhất cho "chưa cấu hình" |
| Không có màn xem trước | Người dùng sửa trực tiếp trên builder |
| Bỏ kết quả AI nếu workspace đã đổi giữa chừng | Tránh tạo draft sai workspace (`501ecde0`) |

## 4. Commit (cơ sở `ad787bd0`)

```
a10f1285 docs(spec): Zapier-style AI workflow generation on web
87027691 docs(plan): Zapier-style AI workflow generation on web
39845d06 feat(web): auto-pick a step's connection when only one fits
d061ed5a feat(web): show unfinished workflow steps in red
67a724b2 feat(web): jump to unfinished steps from the publish bar
9363240b fix(web): show setup chips even without a publish blocker message
cf39c10e feat(web): AI generator builds the draft right away
501ecde0 fix(web): ignore an AI result after the workspace changes
0553c4c4 feat(web): builder AI panel builds without questions
5ea6653a test(web): keep a live AI panel check next to the stubbed one
```

## 5. File thay đổi chính (apps/web)

`src/pages/AiGeneratorPage.tsx`, `src/pages/WorkflowBuilderPage.tsx`, `src/components/builder/GenerateWorkflowPanel.tsx`, `src/components/builder/CustomWorkflowNode.tsx`, `src/components/ai/useWorkflowGeneration.ts`, `src/lib/autoPickConnections.ts` (+ `.test.mjs`), `src/lib/nodeReadiness.ts`, `src/lib/i18n/translations.ts`, `e2e/ai-generator.spec.ts`, `e2e/ai-builder.spec.ts`, `e2e/honest-pages.spec.ts`. Không đổi contract hay backend.

## 6. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | ĐẠT, 0 lỗi |
| `node --test src/lib/*.test.mjs` | ĐẠT, 16/16 |
| `pnpm --dir apps/web exec eslint .` | 3 lỗi `react-hooks/set-state-in-effect`, đều đã có từ trước: effect tải dữ liệu của WorkflowBuilderPage, LiveWorkflowExecutionsPage:92, WorkflowsPage:176 (2 file sau nhánh này không sửa) |
| `pnpm --dir apps/web build` | ĐẠT |
| `VITE_API_MODE=http playwright test --project=chromium` | 458 đạt, 2 bỏ qua, 6 lỗi. Lỗi có từ trước: simple-node-ui "vi and en label", notification-task10-live (thiếu biến môi trường). Lỗi chập chờn do máy tải (chạy cùng lúc docker build): ai-provider-step, localization, 2 test của workspace-connections; chạy lại riêng thì 4/4 đạt |
| `AI_E2E=1 ... -g "real Gateway"` | LỖI: `loginAndOpenBuilder` không đăng nhập ở chế độ http nên chỉ thấy trang Sign In (helper giữ nguyên so với `dev`) |

### Bằng chứng trên Browser pane (stack thật + AI giả, localhost:5173)

- `/ai/workflow-generator` chỉ có ô mô tả, chip ví dụ và nút "Tạo quy trình".
- Mẫu "Lưu tệp đính kèm Gmail vào Drive" → tự vào `/workflows/<id>/builder`.
- 3 bước (Gmail trigger, tải lên Google Drive, trả lời email) đỏ "Chưa cấu hình"; thanh "Bước cần thiết lập:" có 3 chip.
- Bấm chip "Tải tệp lên Google Drive" mở inspector đúng bước, có "+ Thêm kết nối Google Drive". Console không lỗi.
- Workspace không có connection Gmail/Drive nên auto-pick chỉ được phủ bằng Playwright.

## 7. Hạ tầng đã dùng

Dùng compose `compose.yml` + `compose.dev.yml` + `compose.ai-local.yml` với `--profile app` và `--no-recreate`, chỉ khởi động các service cần. Tạo mới `weav-fake-deepseek-1` (kéo image `node:24-bookworm`); khởi động các container có sẵn `weav-ai-service-1`, `weav-identity-service-1`, `weav-workflow-service-1`, `weav-workspace-service-1`. Không đụng tới gateway, rabbitmq, notification của người dùng; không chạy ocr-service (của đối tác). Controller sẽ dừng các container này sau lần review cuối. Chưa xóa image hay volume nào.

## 8. Rủi ro

- Mỗi lần tạo sinh một draft nằm lại trong workspace của người dùng, kể cả khi họ bỏ dở.
- Mobile vẫn dùng luồng hỏi câu, hành vi lệch với web.
- ~~Badge trạng thái ở header inspector còn vàng trong khi node đỏ.~~ Đã sửa (đỏ).
- Test live AI chưa chạy được (thiếu đăng nhập).

## 9. Việc tiếp theo

1. Đồng bộ mobile (`apps/mobile`): tạo ngay, không hỏi.
2. ~~Đồng bộ màu badge ở header inspector với node (đỏ).~~ Xong.
3. Thêm bước đăng nhập thật (tài khoản test) cho `loginAndOpenBuilder` ở chế độ http để test `AI_E2E` chạy được.
4. Cân nhắc cách dọn các draft AI bị bỏ dở.

## 10. Sửa sau review cuối

- Commit `fix(web): red inspector badge and clearer AI messages`: badge inspector đỏ khi chưa xong (thêm assertion `text-err`); tiêu đề riêng `hp.ai.cannot_build` cho trường hợp AI không dựng được; bỏ kết quả cũ khi đổi workspace và không điều hướng nếu workspace đã đổi (bỏ cả toast); xóa 3 key i18n thừa; sửa câu `ai.error.invalid_request`; test dùng `OUT_OF_SCOPE`; bỏ assertion testid cũ.
- Kết quả: `tsc` sạch, eslint sạch trên file đã sửa, Playwright ai-generator + ai-builder + workflow-ui: 49 đạt, 1 bỏ qua.

## 11. Phiên 2026-11-09 (tối): AI bịa thao tác `get` cho Google Docs

- **Triệu chứng:** workflow do AI tạo có bước "Đọc nội dung Google Doc" với `operation: "get"`. Web hiện "Sẵn sàng", xuất bản được, nhưng khi chạy thì báo `CONFIGURATION_ERROR`. Google Docs chỉ có `create` và `append` (`GoogleDocsNodeExecutor`).
- **Nguyên nhân:**
  1. workflow-service chỉ gửi cho AI tên các trường (`capabilities.configFields`), không gửi giá trị hợp lệ, nên AI tự đoán.
  2. `DefinitionValidator.LITERAL_ENUMS` thiếu `google.docs.operation`, `google.drive.operation` và `email.send.bodyType`.
  3. Web `nodeReadiness` coi mọi thao tác khác `append` là `create`.
- **Sửa (nhánh `fix/enum-operation-validation`):**
  - `DefinitionValidator`: thêm 3 trường trên vào `LITERAL_ENUMS` (chuyển sang `Map.ofEntries` vì quá 10 cặp). Lưu nháp, xuất bản và `IntentCompiler` (kết quả AI) giờ đều từ chối giá trị lạ (`INVALID_ENUM_VALUE`); mapping `{{...}}` vẫn được chấp nhận.
  - ai-service `GENERATE_SYSTEM`: liệt kê các giá trị `operation` hợp lệ của từng node và yêu cầu trả `unsupported CAPABILITY_UNAVAILABLE` khi cần thao tác không có (ví dụ đọc Google Doc). Test mới đối chiếu prompt với `packages/workflow-schema/nodes/*.json` để không bị lệch.
  - Web `nodeReadiness`: giá trị literal nằm ngoài enum của schema → bước báo đỏ (`not-configured`), và tên trường xuất hiện trong danh sách "cần sửa".
- **Kiểm tra:**
  - workflow-service (JDK 25, `-Duser.timezone=UTC`): NodePolishValidationTest 13/13 (có test mới), DefinitionValidatorTest 71, NodeConfigSchemasTest 29, IntentCompilerTest 9, WorkflowGenerationServiceTest 23 đều đạt.
  - ai-service: jest `src/prompts` + `src/application` đạt 79/79; tsc và eslint sạch.
  - Web: tsc và eslint sạch. Playwright `builder-correctness` đạt 13/13 (test mới: `get` → đỏ, `create` → sẵn sàng); `ai-builder` 4 đạt, 1 bỏ qua (cần `AI_E2E`).
- **Còn lại:**
  - Workflow `0454d805…` trên prod vẫn còn `get`. Sau khi deploy, bước đó sẽ báo đỏ; người dùng phải đổi thao tác hoặc bỏ bước.
  - "Đọc nội dung Google Doc" chưa được hỗ trợ (giới hạn quyền `drive.file`), cần thiết kế riêng.
