# Nhật ký 2026-09-16 — API Gateway implementation

## Metadata và phạm vi

- Timezone Asia/Saigon; baseline 00cc5f8; branch codex/api-gateway-v1.
- Worktree D:/End/Weav-worktrees/api-gateway-v1; giữ nguyên source/staged changes ở checkout gốc.
- Người dùng đã duyệt triển khai; GPT-5.6 Luna max code/test từng task, controller review/sửa qua worker.
- Plan: docs/superpowers/plans/2026-09-16-api-gateway-service.md; spec tương ứng trong docs/superpowers/specs.

## Kết quả và kiểm tra hiện tại

- Tạo worktree từ HEAD đã khảo sát; cài dependencies bằng pnpm 11.22.0 frozen lockfile cho Gateway.
- Unit baseline: 3 suites/20 tests pass; build pass. E2E baseline fail do test dùng Express mặc định; Task 1 sửa Fastify harness.
- GitNexus 1.6.12 ban đầu lỗi runtime identity ở pnpm dlx; chạy trực tiếp CLI cố định sau khi dependency ổn định đã index thành công: 12,430 nodes, 29,564 edges, 485 flows.
- Có cảnh báo truncation ở process enumeration và unresolved cross-language fields; impact UNKNOWN cần xác minh thêm.
- Docker daemon 29.4.0 hoạt động, không có container chạy tại thời điểm kiểm tra; chưa có real-service/browser proof.
- Review lại nguồn OCR xác nhận chưa có timeout; spec sửa thành bổ sung 10 giây, không mô tả sai là có sẵn.

## Tiến độ và bàn giao

- Task 0–1 hoàn tất; Task 2 bắt đầu. Task1 thêm validated config, shared createApp Fastify, Compose JWT env, E2E harness.
- Controller tìm và yêu cầu Luna sửa TS18048, bypass ở APP_ENV=test và CORS origin trailing slash. Sau sửa: controller chạy 30 unit + 3 E2E pass, build pass, Compose quiet validation pass, git diff --check pass.
- GitNexus runner sinh tự động chọn nhầm global 1.6.5 (storage không tương thích); dùng trực tiếp CLI 1.6.12 đã index. Impact bootstrap/AppModule LOW, mỗi target có main.ts caller/import trực tiếp; không coi thiếu process là không có ảnh hưởng.
- Ledger cục bộ: .superpowers/sdd/2026-09-16-api-gateway-service/progress.md.
- Chưa commit/merge/push. Controller sở hữu docs/ledger; worker chỉ sửa file theo brief.
- Task 2 đang review: controller chạy lại 43 unit tests, 14 Fastify/HTTP-fixture E2E và TypeScript đều pass. Chưa chấp nhận milestone: cần regression cho upload chưa hoàn tất và timeout giữa lúc đọc JSON body OCR; test hiện tại chưa phủ hai trường hợp này.
- Đã yêu cầu Luna giữ numeric status trong lỗi Gateway cũ, sửa header JSON khi thay lỗi upstream, cấm redirect OCR và tránh nhận nhầm request complete=false là client ngắt kết nối.
- Task 2 hoàn tất review: lượt cuối controller chạy 45 unit, 17 E2E và build pass; diff check sạch. Hai regression upload/timeout và lọc lỗi HTML OCR đã được sửa. Raw multipart vẫn chưa có cap mới (giữ tương thích), không coi test fixture là bằng chứng upstream thật.
- Tiếp theo: Task 3 JWT. Chưa có kiểm thử với upstream thật hoặc tài khoản thử nghiệm.
