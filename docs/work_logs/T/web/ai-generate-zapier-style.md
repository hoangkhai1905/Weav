# Nhật ký: AI tạo workflow kiểu Zapier trên web — 2026-11-09

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-11-09 (Asia/Saigon) |
| Nhánh | `feat/web-ai-generate-zapier-style` (từ `dev`, base `ad787bd0`) |
| Người thực hiện | AI agent (Claude), theo yêu cầu của T |
| Trạng thái | Hoàn thành phần web; chưa merge, chưa push |
| Tài liệu | `docs/superpowers/specs/2026-11-09-ai-generate-zapier-style-design.md`, plan cùng tên trong `docs/superpowers/plans/` |

## 2. Kết quả

- AI generator tạo draft ngay (`allowBlanks`), không còn hỏi từng câu; vào thẳng builder.
- Bước chưa cấu hình hiện màu đỏ; thanh "Bước cần thiết lập" liệt kê chip bấm được để nhảy tới bước đó.
- Nếu workspace chỉ có đúng một connection phù hợp cho bước, tự gắn vào bước.
- Panel "Generate with AI" trong builder cũng dựng ngay, không hỏi.

## 3. Quyết định

| Quyết định | Lý do |
| --- | --- |
| Chỉ làm web | Mobile giữ luồng hỏi cũ; parity là việc sau |
| `allowBlanks` khi gọi generate | Cho phép draft thiếu thông tin thay vì chặn bằng câu hỏi |
| Tự chọn connection chỉ khi có đúng 1 ứng viên | Tránh đoán sai khi có nhiều tài khoản |
| Màu đỏ áp dụng cho mọi workflow, không riêng workflow AI | Một quy tắc hiển thị duy nhất cho "chưa cấu hình" |
| Không có màn xem trước | Người dùng sửa trực tiếp trên builder |
| Bỏ kết quả AI nếu workspace đã đổi giữa chừng | Tránh tạo draft sai workspace (`501ecde0`) |

## 4. Commit (base `ad787bd0`)

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

## 5. File chính thay đổi (apps/web)

`src/pages/AiGeneratorPage.tsx`, `src/pages/WorkflowBuilderPage.tsx`, `src/components/builder/GenerateWorkflowPanel.tsx`, `src/components/builder/CustomWorkflowNode.tsx`, `src/components/ai/useWorkflowGeneration.ts`, `src/lib/autoPickConnections.ts` (+ `.test.mjs`), `src/lib/nodeReadiness.ts`, `src/lib/i18n/translations.ts`, `e2e/ai-generator.spec.ts`, `e2e/ai-builder.spec.ts`, `e2e/honest-pages.spec.ts`. Không đổi contract/backend.

## 6. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | PASS, 0 lỗi |
| `node --test src/lib/*.test.mjs` | PASS, 16/16 |
| `pnpm --dir apps/web exec eslint .` | 3 lỗi `react-hooks/set-state-in-effect`, đều có sẵn: WorkflowBuilderPage load effect, LiveWorkflowExecutionsPage:92, WorkflowsPage:176 (2 file sau không đụng tới) |
| `pnpm --dir apps/web build` | PASS |
| `VITE_API_MODE=http playwright test --project=chromium` | 458 pass, 2 skip, 6 fail. Có sẵn: simple-node-ui "vi and en label", notification-task10-live (thiếu env). Flaky do tải (chạy cùng docker build): ai-provider-step, localization, 2 test workspace-connections; chạy lại riêng 4/4 pass |
| `AI_E2E=1 ... -g "real Gateway"` | FAIL: `loginAndOpenBuilder` không đăng nhập ở chế độ http nên thấy trang Sign In (helper không đổi so với `dev`) |

### Bằng chứng trên Browser pane (stack thật + AI giả, localhost:5173)

- `/ai/workflow-generator` chỉ có ô mô tả, chip ví dụ và nút "Tạo quy trình".
- Mẫu "Lưu tệp đính kèm Gmail vào Drive" → tự vào `/workflows/<id>/builder`.
- 3 bước (Gmail trigger, tải lên Google Drive, trả lời email) đỏ "Chưa cấu hình"; thanh "Bước cần thiết lập:" có 3 chip.
- Bấm chip "Tải tệp lên Google Drive" mở inspector đúng bước, có "+ Thêm kết nối Google Drive". Console không lỗi.
- Workspace không có connection Gmail/Drive nên auto-pick chỉ được phủ bằng Playwright.

## 7. Hạ tầng đã dùng

Compose `compose.yml + compose.dev.yml + compose.ai-local.yml --profile app`, `--no-recreate`, chỉ các service cần. Tạo mới `weav-fake-deepseek-1` (kéo image `node:24-bookworm`); khởi động lại container có sẵn `weav-ai-service-1`, `weav-identity-service-1`, `weav-workflow-service-1`, `weav-workspace-service-1`. Gateway, rabbitmq, notification của user không đụng; ocr-service (đối tác) không chạy. Controller sẽ dừng các container này sau review cuối. Chưa xóa image/volume.

## 8. Rủi ro

- Mỗi lần tạo là một draft nằm lại trong workspace của người dùng (kể cả khi họ bỏ đi).
- Mobile vẫn dùng luồng hỏi câu, hành vi lệch với web.
- Badge readiness ở header inspector còn vàng trong khi node đỏ.
- Test live AI chưa chạy được (thiếu đăng nhập).

## 9. Việc tiếp theo

1. Mobile parity (`apps/mobile`): tạo ngay, không hỏi.
2. Đồng bộ màu badge readiness của inspector với node (đỏ).
3. Thêm fixture đăng nhập thật cho `loginAndOpenBuilder` ở chế độ http để test `AI_E2E` chạy được.
4. Xem xét dọn draft AI bị bỏ.
