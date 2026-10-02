# CI: GitHub Actions

| Trường | Giá trị |
| --- | --- |
| Ngày | `2026-10-03` (Asia/Saigon) |
| Nhánh | `chore/ci-github-actions` (từ `dev` @ `8730c3d`) |
| Trạng thái | Đang tiếp tục: chờ duyệt push + lần chạy CI đầu tiên |
| Phạm vi | Một workflow `.github/workflows/ci.yml` chạy check theo path cho push/PR vào `dev` và `main` |

## Kết quả

- `ci.yml`: job `changes` (dorny/paths-filter) → matrix `java` (identity/workspace/workflow), matrix `node` (api-gateway/ai/bot/notification), `notification-integration` (Postgres 17 + RabbitMQ 4 service containers trên 15439/15689), `web` (tsc + build), `mobile` (tsc), và `ci-ok` (check bắt buộc duy nhất; job bị skip được tính là pass).
- Thay đổi `packages/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` hoặc chính `ci.yml` chạy tất cả. Ba job Java cũng chạy khi `services/notification-service/**` hoặc `services/workspace-service/test/**` đổi, vì mỗi service Java có một integration test spawn `node services/workspace-service/test/notification-runtime-bridge.cjs` trên `notification-service/dist`; job Java vì vậy build notification-service trước.
- `services/ocr-service` không nằm trong CI (thuộc partner).

## Quyết định

| Quyết định | Lý do |
| --- | --- |
| Loại trừ test chỉ trong CI qua `-Dtest=!Class,...` trên dòng lệnh, không sửa pom | Chạy local không đổi; xoá một mục khi đã sửa nguyên nhân |
| Loại `AvatarTransactionRollbackIntegrationTest`, `S3AvatarStorageIntegrationTest`, `AvatarHttpIntegrationTest` (identity) | Docker Hub đã gỡ repo `minio/minio` (cả `latest` cũng "pull access denied"); quay.io cũng lỗi |
| Loại `HttpTransportIntegrationTest` (workflow) | Fixture TLS `src/test/resources/http-transport-tls/*.pem` bị `.gitignore` (`*.pem`) nên không có trong CI |
| Lint (`pnpm exec eslint "{src,test}/**/*.ts"`, không `--fix`) không chặn cho api-gateway/ai/notification | dev đang đỏ: api-gateway 2 lỗi, ai-service 140 lỗi, notification-service 46 lỗi + 2 warning; bot-service sạch nên chặn |
| Playwright web không chạy | Suite đã đỏ trên dev (assertion cũ) |
| `pnpm exec tsc` thay vì `npx tsc` cho mobile | Không bao giờ tải nhầm package `tsc` |

## Phát hiện cần xử lý (ngoài phạm vi CI)

- Thử `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (fork MinIO còn bảo trì, drop-in): 5/6 test Avatar pass. `AvatarHttpIntegrationTest.validatesLifecycleFetchesSignedImageAndHandlesConcurrentReplaceDelete:120` lỗi `expected 400 but was 200` cho ảnh PNG 4097x1, **không phải do MinIO**: ID-7 (`5301572`) nâng `AvatarImageValidator.MAX_DIMENSION` lên 8192, test chưa cập nhật (bị che vì image không pull được). Đề xuất: đổi image sang pgsty trong 3 test + sửa assertion, rồi bỏ loại trừ.
- Có thể commit fixture TLS test-only (hoặc sinh bằng openssl trong test) để bỏ loại trừ `HttpTransportIntegrationTest`.

## Kiểm tra (local, Windows)

| Lệnh | Kết quả |
| --- | --- |
| `docker run rhysd/actionlint -no-color .github/workflows/ci.yml` | PASS (SC2086 tắt có lý do cho `$MAVEN_EXCLUDES`) |
| identity: `./mvnw -B verify '-Dtest=!…3 lớp Avatar' -Dsurefire.failIfNoSpecifiedTests=false` | PASS, 357 test, 1 skip (347 s); đúng 3 lớp bị loại |
| workspace: `./mvnw -B verify` | PASS, 418 test (162 s) |
| workflow: `./mvnw -B verify '-Dtest=!HttpTransportIntegrationTest' -Dsurefire.failIfNoSpecifiedTests=false` | PASS, 483 test (280 s), có `WorkflowNotificationLifecyclePersistenceIntegrationTest` |
| `pnpm --dir services/<svc> build`, `test`, `test:e2e` cho 4 service NestJS | PASS hết |
| `pnpm --dir apps/web exec tsc --noEmit`, `pnpm --dir apps/web build`; `apps/mobile`: `pnpm exec tsc --noEmit -p .` | PASS |
| notification-service `test:integration`, `test:inbox-integration` (compose test, đã `down -v`) | PASS |

Chưa kiểm: `pnpm install --frozen-lockfile --filter ...` (chỉ kiểm được trên CI), thời gian chạy thực tế trên runner.

## Việc tiếp theo

1. Chủ repo duyệt push → mở PR vào `dev` → đọc lần chạy CI đầu tiên, chỉ sửa cấu hình CI.
2. Bật branch protection cho `dev` và `main`: required status check `ci-ok`.
3. Quyết định đề xuất pgsty/minio + sửa assertion avatar.
