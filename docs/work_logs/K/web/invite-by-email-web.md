# Nhật ký: mời thành viên qua email, phần web (W7-A1b)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày | 2026-10-10 |
| Nhánh | `feat/w7-a1b-invite-web` (từ `week6` aef8ef3) |
| Phạm vi | Plan Task 8-9: UI chủ workspace trên tab Thành viên, trang `/invitations`, banner dashboard |
| Spec / plan | `docs/superpowers/specs/2026-10-10-w7-a1-invite-by-email-design.md` (mục 7), `docs/superpowers/plans/2026-10-10-w7-a1-invite-by-email.md` |
| Trạng thái | Hoàn thành phần web; chưa kiểm tra với backend thật (A1a làm song song, web code theo "JSON shapes" của plan) |

## 2. Quyết định

- Khi `POST /members` trả `USER_NOT_FOUND`, hiện lời nhắc "Gửi lời mời" thay cho lỗi cũ; nút gọi `POST /invitations`. Lời nhắc ẩn khi sửa ô email.
- Danh sách "Lời mời đang chờ" chỉ truy vấn khi người dùng là OWNER và đang ở tab Thành viên (`enabled`), nên MEMBER không gọi API.
- `EXPIRED` hiện badge và không có nút Gửi lại (backend chỉ cho resend khi còn hiệu lực); Thu hồi luôn có (qua `ConfirmButton`).
- Sau mỗi thao tác lời mời (kể cả lỗi) danh sách được invalidate; `INVITATION_NOT_FOUND`/`NOT_PENDING` dùng chung thông điệp "không còn hiệu lực".
- Mã lỗi đọc từ `WorkspaceApiError.code` (đã lấy `code` phẳng của `ApiErrorResponse`), không đổi `requestWorkspace`.
- `/invitations`: Accept gọi `accept`, lấy lại danh sách workspace (`fetchQuery`), `setWorkspaces` + `selectWorkspace(workspaceId)` rồi điều hướng `/workspace`. `410`/`404` hiện "Lời mời đã hết hạn hoặc bị thu hồi" và refetch; `emailVerified:false` hiện thông báo kèm link `/settings/profile`.
- Banner dashboard dùng một query (`useMyInvitations`, key `['workspaces', userId, 'my-invitations']`, bị dọn cùng session); cũng hiện ở màn hình "chưa có workspace" vì người được mời lần đầu thường chưa có workspace.
- Chế độ `VITE_API_MODE=mock`: các lệnh đọc trả danh sách rỗng, lệnh ghi ném `WORKSPACE_UNAVAILABLE` (không có kho lời mời giả), nên mock mode không lỗi.

## 3. File thay đổi

- Sửa: `apps/web/src/api/workspace.api.ts`, `apps/web/src/hooks/useWorkspace.ts`, `apps/web/src/pages/WorkspacePage.tsx`, `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/App.tsx`, `apps/web/src/lib/i18n/translations.ts` (khối `// A1b`, khóa `workspace.invitations.*` và `invitations.*`, VI + EN).
- Mới: `apps/web/src/pages/InvitationsPage.tsx`, `apps/web/e2e/workspace-invitations.spec.ts` (7 test, stub bằng `page.route`).
- Sửa ngoài danh sách sở hữu: `apps/web/e2e/account-w5c.spec.ts` (test "maps USER_NOT_FOUND" kỳ vọng lỗi cũ; nay kỳ vọng lời nhắc mời; hành vi đổi theo spec).

## 4. Lệnh và kết quả

- `pnpm --dir apps/web exec tsc --noEmit -p tsconfig.app.json`: sạch.
- `pnpm --dir apps/web build`: thành công (chỉ cảnh báo chunk > 500 kB có sẵn).
- `pnpm --dir apps/web exec eslint <file đã sửa>`: sạch.
- Playwright (port 4186, `VITE_API_MODE=http`), các spec `workspace-members|connections|delete|read-switch`, `dashboard-real-data`: baseline 82 passed / 10 failed / 1 timedOut; sau thay đổi 89 passed (7 test mới) với cùng 11 test đỏ, không có lỗi mới.
- `account-w5c.spec.ts`: 11 passed sau khi cập nhật 1 assertion.
- `git diff --check`: sạch.

## 5. Rủi ro và việc tiếp theo

- Chưa chạy với gateway/workspace-service thật: coordinator kiểm tra sau khi merge A1a (mời một `+alias`, đăng ký, xác minh, accept).
- Chưa có xem trước trên mobile (đối tác sở hữu `apps/mobile`).
