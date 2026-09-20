# Nhật ký ngày `2026-09-20`

## 1. Metadata

| Trường                       | Giá trị                                                |
| ---------------------------- | ------------------------------------------------------ |
| Ngày làm việc                | `2026-09-20`                                           |
| Múi giờ ghi log              | `Asia/Saigon`                                          |
| Dự án / repository           | `Weav` / API Gateway                                   |
| Nhánh / commit đầu ngày      | `codex/api-gateway-v1` / uncommitted Task 1–4 worktree |
| Người thực hiện              | Luna max worker                                        |
| Người review / nhận bàn giao | User trực tiếp review; parent không review/poll        |
| Trạng thái cuối ngày         | Hoàn thành, chờ user review                            |
| Phạm vi session              | Task 5 rate limiting và bounded readiness              |

## 2. Tóm tắt điều hành

- Đã thêm Throttler policies general/auth/OCR với in-memory single-replica
  scope, route-independent general keys, socket-IP tracking và safe 429.
- Đã thêm public `/health` liveness không gọi upstream và `/ready` readiness
  song song Identity/Workspace với path đã kiểm chứng, body-aware 2s deadline,
  redirect rejection, cancellation và sanitized aggregate.
- Không sửa accepted JWT/Workspace/OCR behavior; Task4 contract tests và Task3
  OCR late-body fix vẫn pass trong full regression.

## 3. Phạm vi và quyết định

### Trong phạm vi

- `services/api-gateway/src/rate-limit`, `src/health`, config/module wiring,
  `test/limits-health.e2e-spec.ts`, Task5 report và focused worklog.

### Ngoài phạm vi

- Không client/database/business logic, không Notification/OCR readiness
  dependency, không distributed rate storage, không Task6 review/runtime gate.
- Không commit, merge, push, subagent, credential hoặc `.env` read.

### Quyết định chính

| Quyết định                                       | Bằng chứng / hệ quả                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key general không chứa route                     | Tránh đổi URL để né budget; test dùng nhiều route/policy cùng socket.                                                                                   |
| Dùng raw socket address và `trustProxy:false`    | `X-Forwarded-For` không được chọn bucket; test spoofing pass.                                                                                           |
| OCR verify trước tracker                         | Existing AccessTokenService được dùng nếu guard chạy trước; invalid JWT không dùng claim; dev fallback chỉ khi không có Authorization và bypass hợp lệ. |
| Readiness dùng Terminus indicator + fetch reader | Chỉ hai upstream cần thiết; body stall bị abort trong 2s, output không lộ URL/raw detail.                                                               |
| Window mặc định 60s, test override 1s            | Giữ defaults theo spec và làm expiry recovery kiểm chứng được.                                                                                          |

## 4. Thay đổi file

- Thêm `services/api-gateway/src/rate-limit/gateway-throttler.guard.ts` và
  `rate-limit.module.ts`.
- Thêm `services/api-gateway/src/health/health.service.ts`,
  `health.controller.ts`, `health.module.ts`.
- Sửa `src/config/gateway.config.ts`, config spec, `src/app.module.ts`,
  `src/create-app.ts`.
- Thêm `test/limits-health.e2e-spec.ts` với HTTP fixtures Identity/Workspace.
- Thêm `.superpowers/.../task-5-report.md` và log này.

## 5. Graph impact trước edit

- Exact `src/app.module.ts`: LOW; caller trực tiếp `main.ts`; không có
  process/module affected.
- Name-only `AppModule`: ambiguous 4 candidates, UNKNOWN; đã corroborate thủ
  công.
- `src/create-app.ts` và `src/config/gateway.config.ts`: index chưa nhận file,
  UNKNOWN; đã corroborate bằng `rg` imports/usages và đọc bootstrap/config.
- Không có HIGH/CRITICAL warning. Direct CLI path theo AGENTS đã dùng.

## 6. Kiểm tra và bằng chứng

| Hạng mục                    | Lệnh                                                                                                      | Kết quả                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| TDD red                     | `pnpm --dir services/api-gateway test:e2e -- --runInBand --silent limits-health.e2e-spec.ts` trước wiring | RED vì `/health`/`/ready` chưa tồn tại và limiter chưa wire                              |
| Focused E2E                 | `pnpm --dir services/api-gateway test:e2e -- --runInBand --silent limits-health.e2e-spec.ts`              | PASS, 7 tests in 3 consecutive runs; gồm up/down/stall/recovery/concurrency và 429 cases |
| Unit                        | `pnpm --dir services/api-gateway test -- --runInBand --silent`                                            | PASS, 7 suites / 82 tests                                                                |
| Full E2E                    | `pnpm --dir services/api-gateway test:e2e -- --runInBand --silent`                                        | PASS, 5 suites / 65 tests                                                                |
| Type/build                  | `pnpm --dir services/api-gateway exec tsc --noEmit`; `pnpm --dir services/api-gateway build`              | PASS                                                                                     |
| Formatting/diff             | Prettier `--check` on Task5 files; `git diff --check`                                                     | PASS; only existing `.env.example` line-ending warning                                   |
| Spring config corroboration | `rg` + đọc `application.properties`/`SecurityConfig.java` Identity/Workspace                              | readiness path GET permitted; group includes readiness state/db                          |

## 7. Rủi ro / giới hạn

- In-memory throttling chỉ có hiệu lực trong một Gateway replica; distributed
  storage là requirement riêng.
- Local fixtures không chứng minh deployed services/database readiness; chưa có
  credentials/runtime/browser proof và không giả nhận là đã kiểm tra.
- Không có helper setup-refresh error/blocker.

## 8. Trạng thái bàn giao

Task5 complete/tested, chưa commit. User review trực tiếp; dừng tại đây. Chỉ
tiếp tục khi user nói `work done` và parent dispatches task tiếp theo.
