# Nhật ký ngày 2026-09-16 — API Gateway planning

## 1. Metadata

- Repository: Weav; branch `api-gateway`; HEAD `00cc5f8`; timezone Asia/Saigon.
- Người thực hiện: Codex điều phối; GPT-5.6 Luna `max` hỗ trợ rà soát tiêu chí test, chỉ đọc.
- Phạm vi: thiết kế, implementation plan và quy trình giao code/review/sửa lỗi.
- Trạng thái: đã viết và tự rà soát kế hoạch; chưa triển khai Gateway. Review bổ sung của Luna chưa có kết quả tại thời điểm ghi log.

## 2. Mục tiêu và bối cảnh

Người dùng yêu cầu lập plan API Gateway và dùng GPT-5.6 Luna viết code dưới sự kiểm tra của agent chính. Model Luna hỗ trợ `max`, không có effort `ultramax`. Baseline kế thừa phần khảo sát repository/Notion ở lượt trước; kiểm tra lại HEAD và Gateway package/test harness trong lượt này.

## 3. Quyết định kỹ thuật

- Đợt đầu: config/bootstrap, correlation, JWT edge, Workspace proxy, rate limits, health và kiểm chứng.
- Giữ các route/response hiện có; không đổi toàn bộ error envelope upstream.
- Triển khai trong worktree riêng; một worker code từng task; controller review và yêu cầu sửa đến khi đạt gate.
- Workflow/AI/Bot chờ contract; OAuth-cookie migration, mobile route migration và multi-replica throttling tách phạm vi.
- `typescript: ^5.7.3` chấp nhận 5.9; chưa có cơ sở bắt buộc nâng manifest chỉ từ khai báo đó.

## 4. File thay đổi

- Thêm `docs/superpowers/specs/2026-09-16-api-gateway-service-design.md`.
- Thêm `docs/superpowers/plans/2026-09-16-api-gateway-service.md`.
- Thêm log này. Không sửa source, schema, Compose hoặc dependency.

## 5. Kiểm tra và bằng chứng

- `git log -3 --oneline`: HEAD vẫn `00cc5f8`.
- `git status --porcelain=v1 | Measure-Object -Line`: 929 mục có sẵn trước tài liệu mới; giữ nguyên.
- Đọc `services/api-gateway/package.json`, `src/main.ts`, `test/app.e2e-spec.ts`, `test/jest-e2e.json` và work log 2026-09-15.
- E2E hiện dùng default Nest adapter; plan yêu cầu chuyển harness sang Fastify thật.
- Unit/build ở lượt khảo sát trước được báo pass; không chạy lại trong lượt lập kế hoạch và không dùng làm bằng chứng cho code chưa triển khai.
- GitNexus `.gitnexus/run.cjs` không có; chưa thực hiện graph impact/detect-changes. Không sửa symbol hoặc commit.
- Runtime/browser/migration: không áp dụng cho thay đổi tài liệu; các gate implementation được ghi trong plan.
- `git diff --check`: không có output lỗi. Ba file mới được kiểm tra riêng bằng `git diff --no-index --check -- NUL <file>`: không có lỗi whitespace (exit 1 do file mới khác NUL).
- `git diff --cached --check`: FAIL vì whitespace trong các thay đổi staged có sẵn (skills, apps/RULE.md, tài liệu và OCR fixtures); không sửa các file ngoài phạm vi.
- Tự review plan/spec: giữ upstream error compatibility; chỉ gate JWT access ở route tương ứng; E2E dùng Fastify; Workspace có chín operation public; quyền nghiệp vụ ở downstream; route chưa có contract được loại khỏi đợt đầu.

## 6. Rủi ro và bước tiếp theo

- Khôi phục/bootstrap GitNexus trước khi sửa symbol; nếu không được thì báo blocker.
- Xác nhận thiết kế trước khi bắt đầu implementation theo brainstorming gate; người dùng đã chọn workflow Luna code/controller review nên không hỏi lại lựa chọn này.
- Controller ghi nhận kết quả review Luna, tự rà plan/spec, chạy diff check tài liệu.
- Chưa commit, merge hoặc push; không động vào các thay đổi có sẵn.
