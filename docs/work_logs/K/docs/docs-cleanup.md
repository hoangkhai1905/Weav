# Nhật ký: dọn thư mục docs (2026-11-02)

| Trường | Giá trị |
| --- | --- |
| Nhánh | `chore/docs-cleanup` (từ `dev` `0f3a5f61`) |
| Người thực hiện | K (Claude) |
| Trạng thái | Hoàn thành, chưa merge vào `dev` |

## Quyết định

- Xóa 36 plan trong `docs/superpowers/plans/`; giữ toàn bộ ở git tag `archive/plans-2026-11-02`
  (`git show archive/plans-2026-11-02:docs/superpowers/plans/<file>`). Giữ design spec trong `docs/superpowers/specs/`.
- Work log: log không cập nhật từ 2026-10-28 chuyển vào `<K|T>/<area>/<YYYY>-W<ww>/` theo tuần ISO bắt đầu log
  (`git mv`, giữ lịch sử). 28 log rời ở gốc thuộc T; 9 file "Worklog moved" bị xóa; `docs/handoffs/` gộp vào `docs/handoff/`.
  Index ở `docs/work_logs/README.md`.
- Docs: xóa 7 `.gitkeep` rỗng, `docs/progress/` (branch đã xong), `development/FRONTEND_GUIDE.md` (mô tả `.agents/skills`
  không còn tồn tại), `architecture/repository-structure.md` (sai: `auth-service`, `docker-compose.yml`).
  Chuyển `agent-cli-operations.md` → `development/agent-cli.md`, `superpowers/notification-expansion.md` → `superpowers/specs/`.
- Thêm `docs/architecture/overview.md` (thành phần, luồng, triển khai, quyết định chính) và viết lại `docs/README.md`.
  Sửa trạng thái `jwt-asymmetric-signing-design.md` (RS256 đã implement 2026-10-03, tùy chọn).

## Kiểm tra

- Link tương đối hỏng trong file `.md` được track: `dev` 1, sau khi dọn 5. 4 link mới trỏ tới plan đã xóa (đọc qua tag).
- `git diff --check` sạch; GitNexus `detect_changes` mức low, 0 process bị ảnh hưởng.

## Còn lại

- Spec AI (`docs/specs/services/ai-service.md`) ghi "không có database"; compose đã có `AI_DB_*` (BYOK). Cần cập nhật spec.
- Push tag `archive/plans-2026-11-02` cùng nhánh; báo T rằng log của T đã đổi chỗ.
