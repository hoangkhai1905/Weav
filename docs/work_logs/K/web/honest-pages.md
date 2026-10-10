# Nhật ký: Honest pages (web) - lane W5-B

| Trường | Giá trị |
| --- | --- |
| Nhánh | `feat/w5-b-honest-pages` (từ `week5` ef69d9a), worktree `T:\Weav-wt\w5-b` |
| Trạng thái | Hoàn thành code + kiểm tra tự động; chưa kiểm tra trên stack thật (coordinator làm) |
| Phạm vi | audit #1, #3, #4, #11, #15, #33, #34, #35, #36, #37, #39 (plan D2, D3) |

## Quyết định

| Quyết định | Lý do |
| --- | --- |
| Hook `useWorkflowGeneration` (components/ai) dùng chung cho `GenerateWorkflowPanel` và `AiGeneratorPage` | Một chỗ gọi `POST /workflows/generate` + map lỗi 429/503/504 |
| `needs_input`: API `GenerateWorkflowRequest` chỉ có `prompt/timezone/connections`, KHÔNG có trường answers | Câu hỏi CONNECTION -> select, gửi qua `connections[nodeType]`; câu hỏi khác -> ô nhập, nối vào prompt dạng `- field: value`. Trường người nhận mặc định = email người dùng đăng nhập |
| "Tạo bản nháp" dùng `workflowV1Api.createWorkflowFromDefinition` (đã có, trợ lý AI cũng dùng) | Không thêm hàm API mới (workflow.api.ts thuộc lane A) |
| Dashboard "Tạo bằng AI" luôn là link tới `/ai/workflow-generator`; xoá modal AI giả | Trang generator tự báo `unsupported` ở mock mode |
| 8 mẫu tĩnh ở `src/lib/templates/index.ts`, không có `connectionId`, không thêm trigger thủ công vào mẫu có trigger khác (D1) | Key output theo executor: data.set phẳng, sheets lookup `{rows,count}`, ai.summarize `summary`, drive upload `name`; cron 6 trường kiểu Spring |
| Mẫu Gmail dùng `trigger.input.fromEmail` | `from` có dạng `Tên <a@b>` bị `email.send` từ chối (regex không cho `<>`); phụ thuộc lane A thêm `fromEmail` |
| Onboarding: `FirstWorkspaceCard` hiện khi `workspacesQuery.isSuccess && workspaces.length === 0` (http mode) | Tránh lỗi đỏ "Không thể tải dữ liệu quy trình" |
| Sidebar nhãn "Trung tâm thông báo" (không phải "Thông báo") | Tránh trùng `getByRole('link', { name: /^Notifications/ })` của topbar trong các spec thông báo |

## File thay đổi

- Mới: `src/lib/templates/index.ts`, `src/components/ai/useWorkflowGeneration.ts`, `src/components/onboarding/FirstWorkspaceCard.tsx`, `e2e/honest-pages.spec.ts`, `e2e/honest-templates.spec.ts`.
- Sửa: `pages/{AiGeneratorPage,TelegramPage,CreateWorkflowPage,HelpPage,DashboardPage}.tsx`, `components/builder/GenerateWorkflowPanel.tsx`, `components/layout/{Sidebar,Topbar}.tsx`, `lib/i18n/translations.ts` (khối `// W5-B honest pages`, VI + EN, key `hp.*` và `nav.notification_center`).
- Spec cũ sửa vì khẳng định nội dung giả đã bỏ: `dashboard-real-data.spec.ts` (nút AI là link), `workflow-ui.spec.ts` (2 test generator + link Help), `localization.spec.ts` (tiêu đề Telegram, bỏ log giả, test generator, stub workspaces có 1 workspace).
- Còn lại: `src/api/telegram.api.ts` không còn nơi gọi (chưa xoá, không thuộc lane).

## Kiểm tra

| Lệnh | Kết quả |
| --- | --- |
| Baseline (6 spec brief, port 4176, trước khi sửa) | 7 failed, 39 passed, 1 skipped |
| Sau khi sửa, cùng 6 spec + 2 spec mới | Cùng 7 lỗi như baseline (ai-builder x2, dashboard-real-data x1, localization x3, notification-integration x1), không lỗi mới; các test khác pass, kèm 15 test mới |
| `honest-pages.spec.ts` + `honest-templates.spec.ts` | 15 passed |
| `tsc --noEmit`, `pnpm --dir apps/web build` | sạch |
| eslint file đã sửa/thêm | sạch |
| `git diff --check` | sạch |

Lỗi còn lại đều có trong baseline: ai-builder x2, dashboard-real-data "View executions" href, localization (timestamps `Hôm nay, 10:40`, "keeps every screen" dừng ở /workflows demo data, Dashboard `T7: 36 lượt`), notification-integration:522. Không có lỗi mới.

## Rủi ro / việc tiếp theo

- Chưa chạy trên stack thật: cần kiểm tra thủ công (xem báo cáo lane).
- Mẫu Gmail cần `fromEmail` của lane A; nếu chưa có, bước trả lời sẽ lỗi lúc chạy.
- `chatId`, `spreadsheetId`, `to` để trống trong mẫu: người dùng điền trong builder trước khi publish.

## Polish (N1-N9)

Lane W5-polish, nhánh `feat/w5-polish` (từ `week5` 27ecd89). Tất cả copy qua i18n VI + EN.

| Mục | Thay đổi |
| --- | --- |
| N1 | `create.recipes` chỉ còn "mẫu" (đếm thật `8 mẫu`); placeholder "Mô tả nhanh" dùng Gmail/Drive/Telegram; bỏ chip/đoạn quảng cáo không đúng (`schema_verified` -> "Chỉnh sửa được", `beta` -> "Mới", `any_payload` -> "Thêm từng bước", mô tả mẫu/AI viết lại trung thực) |
| N2 | Tên bước trong thẻ mẫu dùng nhãn node đã dịch (`lib/nodeLabels.ts`, cùng key `builder.node.*` với palette); nút "Dùng mẫu" có `type="button"` và `aria-label` kèm tên mẫu |
| N3 | `AnimatedWorkflowShowcase` (dùng chung Login/Register): bỏ "99,9%", "gấp 10 lần", "React Flow 12"; thay bằng Gmail/Google/Telegram, lịch sử chạy, tạo bằng AI; nút submit Register có `aria-label` |
| N4 | Bỏ "Identity" khỏi chuỗi hiển thị (VI + EN), dùng "tài khoản" |
| N5 | `PROVIDER_LABELS` trong `ConnectionsPage.tsx` (Gmail, Google Sheets, ..., Telegram, HTTP) |
| N6 | `friendlyErrorMessage()` (`lib/executions/runView.ts`): thông báo theo `code` (`runs.err.*`; MAPPING_ERROR "thiếu giá trị" nhận biết qua `is missing` trong message) + nhãn trường `runs.field.*` mở rộng; banner dùng thông báo thân thiện, JSON thô vẫn nằm trong khung chi tiết |
| N7 | Câu hỏi needs_input: recipient / URL / lịch / múi giờ / "Cần thêm thông tin cho bước <node>: <trường>"; CONNECTION dùng nhãn node đã dịch |
| N8 | `GENERATE_SYSTEM`: `intent.name` cùng ngôn ngữ với yêu cầu; id node vẫn ASCII snake_case. Tên từng bước do workflow-service dựng từ node id nên không đổi ở đây (xem rủi ro) |
| N9 | Tiêu đề lịch sử chạy hiện "Quy trình" thay vì UUID khi chưa tải tên |

Lệnh: `tsc --noEmit -p tsconfig.app.json` sạch; `pnpm --dir apps/web build` ok; ai-service `test` 209 pass + `build` ok; Playwright (port 4180) 6 spec: baseline 3 lỗi localization (có sẵn), sau sửa không lỗi mới (executions-live + honest-pages cập nhật assertion cho copy mới). eslint: lỗi `react-hooks/refs` có sẵn ở `AiGeneratorPage.tsx` dòng "createDraft" (không do lane này).

Rủi ro: tên bước do AI sinh vẫn tiếng Anh vì `intent.nodes` chỉ có `id` (backend suy ra tên); cần sửa ở workflow-service nếu muốn. Câu hỏi VALUE với id node dạng `send_email.config.to` không dịch được tên node (chỉ nhận biết kiểu node khi field bắt đầu bằng type như `email.send.`).

## 2026-10-10 — Thông báo "chưa có không gian" (nhánh `fix/no-workspace-notice` từ `dev`)

| Mục | Thay đổi |
| --- | --- |
| Lỗi | Tài khoản mới chưa có workspace: `getActiveWorkflowWorkspaceId` ném `WorkflowApiError(409)`, Tổng quan và Quy trình hiện khung lỗi đỏ như sự cố |
| Sửa | `isNoWorkspaceError()` (`api/workflow-v1.api.ts`) + `components/common/NoWorkspaceNotice.tsx` (thông báo trung tính + nút "Tạo không gian làm việc" -> `/workspace`); dùng ở `DashboardPage` (HttpDashboardContent) và `WorkflowsPage` (tải danh sách + nút Tạo quy trình). Lỗi thật vẫn giữ khung đỏ + Thử lại |

Lệnh: `tsc --noEmit` sạch; eslint chỉ còn lỗi có sẵn `react-hooks/set-state-in-effect` ở `WorkflowsPage` (có trên HEAD trước khi sửa); `git diff --check` sạch; GitNexus detect-changes: 3 file, risk medium (chỉ 2 luồng WorkflowsPage). Người dùng kiểm tra trên stack thật với tài khoản 0 workspace: ổn.

Ghi chú môi trường cùng phiên: identity/workspace/workflow crash-loop do mật khẩu Neon `neondb_owner` cũ trong `.env` (SQL 28P01); đã cập nhật `.env` + `--force-recreate`. Gateway/RabbitMQ/ai-service bị dừng giữa chừng -> bật lại.
