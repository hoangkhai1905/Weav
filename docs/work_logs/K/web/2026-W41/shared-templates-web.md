# Nhật ký: Mẫu quy trình dùng chung (web) - lane W6-C2

Spec: `docs/superpowers/specs/2026-10-09-w6c-shared-templates-design.md` (mục 4, 5). Plan: `docs/superpowers/plans/2026-10-09-w6c-shared-templates.md` (Lane W6-C2, Task 1-3).

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-09 |
| Nhánh | `feat/w6-c2-templates-web` (từ `week6` e9a1710), worktree `T:\Weav-wt\w6-c2` |
| Trạng thái | Code xong, chưa commit (coordinator commit sau review); chờ live check khi backend C1 được merge |
| Phạm vi | Web: thư viện mẫu (Có sẵn / Cộng đồng / Nhóm / Của tôi), nhập mã, chia sẻ từ builder, tồn đọng Week 5, nhãn bộ lọc monitoring |

## 2. Quyết định

| Quyết định | Lý do |
| --- | --- |
| Client code theo shape C1 Task 4; mọi call stub bằng `page.route` | Backend C1 làm song song |
| Nút "Chia sẻ làm mẫu" là icon trong header builder (không có menu "...") | Header hiện chưa có menu; một nút icon là thay đổi nhỏ nhất. Disabled kèm tooltip khi bản nháp chưa lưu |
| Dialog dùng shell mới `TemplateDialog` (focus trap, Esc, trả focus) | Repo chưa có dialog có focus trap; `ConfirmModal` chỉ dùng cho xác nhận xoá |
| Danh sách dùng `useInfiniteQuery`, mutate xong thì invalidate | Tránh `setState` trong effect (eslint `react-hooks/set-state-in-effect`) |
| `useTemplate` đặt tên `copyTemplateToWorkspace` | Tên `use*` bị rules-of-hooks coi là hook |
| `?code=XXXX` trên `/workflows/new` mở sẵn hộp thoại nhập mã | Liên kết chia sẻ cho UNLISTED/PUBLIC |
| Ẩn tab/nút mới khi `VITE_API_MODE=mock` | Mock mode không có API mẫu |
| Gợi ý người nhận email ở panel AI chỉ cho field kết thúc bằng `.config.to` | Theo plan; người dùng vẫn sửa được |
| Xoá 391 khóa i18n chỉ khi: không có literal nào (`'k'`, `"k"`, `` `k` ``) trong `src`/`e2e`, không khớp prefix động (`'p.' + x`, `` `p.${x}` ``) hoặc template, cả VI và EN | Còn lại 0 khóa chưa dùng theo cùng kiểm tra |

## 3. Thay đổi

- Mới: `src/api/templates.api.ts`; `src/components/templates/{TemplateDialog,TemplateCard,TemplateGallery,TemplatePreviewDialog,EnterCodeDialog,ShareTemplateDialog}.tsx`, `templateStyles.ts`; `e2e/templates.spec.ts`.
- `CreateWorkflowPage.tsx`: tab, nút "Nhập mã", `?code=`, dùng helper chung `nodeDot`/`connectionCount`.
- `WorkflowBuilderPage.tsx`: nút chia sẻ + dialog; bỏ handoff `generatePrompt` (không nơi nào gửi state này) và `useLocation` không còn dùng.
- `GenerateWorkflowPanel.tsx`: điền sẵn email người dùng cho câu hỏi `.config.to`; bỏ prop `initialPrompt` (không còn ai truyền).
- `ExecutionsOverviewPage.tsx`: `label htmlFor` + `select id` cho bộ lọc trạng thái, quy trình và khoảng thời gian.
- `translations.ts`: khối `tpl.*` (VI + EN), xoá 391 khóa không dùng mỗi ngôn ngữ.
- Spec bổ sung: `ai-generator.spec.ts` (email mặc định), `monitoring.spec.ts` (tên select).

## 4. Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json` | sạch |
| `pnpm --dir apps/web build` | PASS |
| `eslint` các file đã sửa | chỉ còn 1 lỗi có sẵn `WorkflowBuilderPage.tsx:521 set-state-in-effect` |
| Playwright `templates`, `monitoring`, `ai-generator` (port 4183, `VITE_API_MODE=http`) | 26/26 PASS |
| Toàn bộ suite chromium sau thay đổi | 230 pass, 70 fail, 2 skip |
| Baseline (HEAD, bản sao `git archive`) cho cùng các spec | cùng tên test fail: 27 trong `workflow-ui`+`ai-builder` (chạy trước khi sửa) + 42 ở 9 spec khác + `notification-task10-live.spec.cjs` (cần stack thật); không có lỗi mới |
| `git diff --check` | sạch (chỉ cảnh báo CRLF có sẵn) |

## 5. Rủi ro / chưa kiểm tra

- Chưa chạy với backend thật (C1 chưa merge): shape `TemplateSummary/Detail/Preview` theo plan C1 Task 4.
- Mô tả `description` rỗng được bỏ khỏi body PUT; `authorName` rỗng cũng bỏ.
- Tên field trong danh sách "sẽ bị xoá" lấy từ `title` của node schema, nên nhãn tiếng Anh nếu schema không có bản dịch.

## 6. Việc tiếp theo

- Live check sau khi C1 merge (xem báo cáo lane): chia sẻ, nhập mã bằng tài khoản thứ hai, dùng mẫu, đổi hiển thị, xoá.
