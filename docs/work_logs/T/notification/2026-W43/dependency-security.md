# Nhật ký: bảo mật dependency notification-service

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-10-22` |
| Nhánh / commit gốc | `fix/notification-undici-7.30.1` từ `dev` / `200bed05` |
| Người thực hiện | T + Claude Code |
| Trạng thái | `Hoàn thành`, chờ review rồi merge vào `dev` |
| Phạm vi | Nâng `undici` sau bản vá bảo mật Node.js ngày 21/10/2026 |

## 2. Bối cảnh

- Node.js phát hành bản vá ngày 21/10/2026 (24.22.1 LTS): Brotli RCE CVE-2026-111497, hai lỗi bypass hostname TLS, lỗi NUL trong DNS. Weav chạy Node 24 ở mọi nơi (`.nvmrc`, Dockerfile `node:24-*`, CI `node-version: 24`), nên không cần sửa file; chỉ cần cập nhật Node local và rebuild image với `--pull`.
- Bản Node vá có kèm undici 7.30.1. Riêng notification-service có dependency npm `undici@7.29.0` (import `Agent` cho Expo push trong `src/infrastructure/providers.ts`). Bản này dính 10 advisory, được vá từ 7.29.1; trong đó có 2 lỗi mức cao: GHSA-w293-vg96-wgc3 (bypass TLS qua `BalancedPool`) và GHSA-rfgv-xxqx-mfg5 (DoS qua WebSocket).

## 3. Thay đổi

| Loại | Đường dẫn | Thay đổi |
| --- | --- | --- |
| Sửa | `services/notification-service/package.json` | `undici` `^7.29.0` → `^7.30.1` |
| Sửa | `pnpm-lock.yaml` | Mọi đường dẫn tới undici (direct, `expo-server-sdk`, `@dotenvx/dotenvx`, `shadcn`) dồn về 7.30.1 bằng `pnpm update -r --depth Infinity undici`; không có package nào khác thay đổi |

Quyết định: chọn ^7.30.1 (cùng bản Node 24.22.1 đi kèm), không dùng `pnpm.overrides` vì mọi range đều đã cho phép 7.30.1.

## 4. Kiểm tra

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Unit | `pnpm --dir services/notification-service test` | PASS 199/199 (14 suite; cần build/`prisma generate` trước trong worktree mới) |
| E2E | `pnpm --dir services/notification-service test:e2e` | PASS 19/19 |
| Build | `pnpm --dir services/notification-service build` | PASS |
| Lint | `pnpm --dir services/notification-service exec eslint "{src,test}/**/*.ts"` | PASS |
| Audit | `pnpm --dir services/notification-service audit --prod` | Không còn advisory undici |

Chưa kiểm tra: gửi Expo push thật (cần token thiết bị); Docker image chưa rebuild.

GitNexus `detect-changes`: bỏ qua, có sự đồng ý của người dùng. `analyze --index-only` crash khi index worktree `.claude/worktrees/undici-bump` (exit `0xC0000409`), nên worktree không được đăng ký vào index. Diff chỉ gồm `package.json`, `pnpm-lock.yaml` và file Markdown này, không có symbol code nào để phân tích.

## 5. Việc tiếp theo

- Máy dev: cập nhật Node local lên 24.22.1 (đang là 24.13.0).
- Rebuild image Node: `docker compose -f compose.yml -f compose.dev.yml --profile app build --pull api-gateway ai-service notification-service`.
- Phần còn lại của `pnpm audit` (2 critical, 56 high) đang xử lý ở session riêng; khi merge sau nhánh này thì tạo lại `pnpm-lock.yaml`.
