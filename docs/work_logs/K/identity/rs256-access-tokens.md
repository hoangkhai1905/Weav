# Nhật ký: RS256 access token (ID-6 / GW-3 / WS-15 / X-8)

> Thiết kế: `docs/architecture/jwt-asymmetric-signing-design.md`. Mỗi lane (identity, workspace/workflow, gateway/notification) thêm mục của mình vào file này. Không ghi secret/khóa.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Nhánh | `feature/rs256-access-tokens` |
| Trạng thái | Identity (bước a + công tắc bước c): `Hoàn thành`, chưa commit |
| Phạm vi | Identity ký được RS256, phát JWKS, decoder nội bộ nhận HS256 + RS256. Mặc định vẫn HS256. |

## 2. Identity-service (bước a, công tắc bước c)

### Hành vi

- `JWT_ACCESS_ALG` = `HS256` (mặc định, hành vi cũ) hoặc `RS256`. RS256 thì header token có `kid`; claim giữ nguyên.
- `GET /.well-known/jwks.json`: chỉ khóa công khai (khóa hiện tại + khóa trước nếu có), `Cache-Control: public, max-age=300`, permit-all trong `SecurityConfig`. Rate limiter không chặn path này (chỉ khớp các path `/auth/...`). Không có HS256/khóa nào: trả `{"keys":[]}`.
- Decoder của identity (`AlgorithmRoutingJwtDecoder`) đọc header `alg` rồi chọn đúng một decoder: HS256 -> decoder secret chung; RS256 -> decoder chỉ giữ public key RSA, chọn theo `kid`; alg khác hoặc token hỏng -> `BadJwtException`. Token HS256 không bao giờ được thử với public key RSA và ngược lại (chống algorithm confusion). Validator claim (`JwtAccessTokenValidator`) dùng chung, không đổi.
- Khởi động: `RS256` mà không nạp được khóa (thiếu path, file không đọc được, < 2048 bit, thiếu kid) thì lỗi ngay với thông báo rõ, không chứa nội dung khóa. HS256 mà không có khóa vẫn chạy (file không tồn tại cũng được bỏ qua).

### Cấu hình

| Biến | Ý nghĩa |
| --- | --- |
| `JWT_ACCESS_ALG` | `HS256` (mặc định) / `RS256` |
| `JWT_SIGNING_KEY_LOCATION` | đường dẫn PEM private key (PKCS#8); compose: `/run/identity-keys/identity-access.pem` |
| `JWT_SIGNING_KEY_ID` | `kid` (compose mặc định `identity-dev-1`) |
| `JWT_PREVIOUS_PUBLIC_KEY_LOCATION`, `JWT_PREVIOUS_KEY_ID` | khóa công khai cũ (X.509 PEM) để xoay khóa; bỏ sau TTL + skew (~20 phút) |

- `scripts/identity-dev-keys.mjs`: tạo RSA 2048 vào `tmp/service-keys/identity/` (git-ignored), idempotent, `--force` để tạo lại; chỉ in đường dẫn và kid.
- `compose.dev.yml` (khối identity): mount `${WEAV_SERVICE_KEYS_DIR:-./tmp/service-keys}/identity` read-only vào `/run/identity-keys`. `.env.example` và `.env` có `JWT_ACCESS_ALG=HS256`, `JWT_SIGNING_KEY_ID=`.
- Bật RS256 trong dev: chạy script khóa, đặt `JWT_ACCESS_ALG=RS256`, recreate identity. Chỉ làm sau khi các verifier (bước b) nhận RS256.

### File

| Loại | Đường dẫn |
| --- | --- |
| Thêm | `services/identity-service/.../infrastructure/security/{JwtSigningProperties,JwtSigningKeys,AlgorithmRoutingJwtDecoder}.java`, `.../presentation/http/JwksController.java`, `src/test/.../security/Rs256AccessTokenTest.java`, `scripts/identity-dev-keys.mjs` |
| Sửa | `IdentityApplicationConfig`, `JwtAccessTokenIssuer` (thêm constructor có alg + kid, constructor cũ giữ nguyên), `SecurityConfig` (permit JWKS), `application.properties`, `compose.dev.yml`, `.env.example` |

### Kiểm tra

- `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (identity): 360 chạy, 0 failure, 4 error, 1 skipped (baseline 353/0/3/1; +7 test mới trong `Rs256AccessTokenTest`, đều PASS). 3 error là Avatar minio đã biết. Error thứ 4, `IdentitySecurityNotificationRuntimeIntegrationTest`, do `services/workspace-service/test/notification-runtime-bridge.cjs` còn `require("jsonwebtoken")` mà lane notification đã gỡ gói này; không liên quan thay đổi identity, lane notification/workspace cần sửa bridge.
- `git diff --check` sạch; `docker compose -f compose.yml -f compose.dev.yml --profile app config -q` OK.

## 3. Workspace / workflow

_(lane khác bổ sung)_

## 4. Gateway / notification

Trạng thái: xong bước b cho verifier Node.

- Định tuyến theo header `alg` (`decodeProtectedHeader`): `HS256` -> secret cũ; `RS256` -> `createRemoteJWKSet` (tạo một lần, lazy); khác (kể cả `none`) -> 401. Mỗi khóa chỉ verify đúng thuật toán của nó (`algorithms` cố định theo nhánh), nên không có algorithm confusion.
- Gateway: `access-token.service.ts`, `gateway.config.ts` (`JWT_JWKS_URI` tùy chọn, mặc định `<IDENTITY_SERVICE_URL>/.well-known/jwks.json`, chỉ http/https). `jose` đã có sẵn.
- Notification: `presentation/http.ts` (guard async, dùng `jose`), `config/settings.ts` (`JWT_JWKS_URI`, mặc định `http://identity-service:8080/.well-known/jwks.json`), bỏ `jsonwebtoken` và `@types/jsonwebtoken`, thêm `jose`; jest cần `jose` trong `transformIgnorePatterns`; test dùng signer HS256 nhỏ bằng `node:crypto`.
- Test mới (JWKS giả bằng http server cục bộ, khóa RSA tạm): RS256 kid đã biết được chấp nhận, user không ACTIVE bị từ chối, kid lạ, HS256 ký bằng public key làm secret, `alg: none`, JWKS không kết nối được -> 401 (HS256 vẫn chạy).
- Kết quả: gateway unit 107 (101 + 6), e2e 82, build ok; notification unit 101, e2e 19 (14 + 5), build ok. `test:integration` của notification (cần Docker) chưa chạy.

### Bước b: workspace-service và workflow-service (Java)
- Mỗi service thêm `AlgorithmRoutingJwtDecoder` (`infrastructure/security`): đọc header `alg` bằng Nimbus `JWTParser`; `HS256` -> decoder secret cũ, `RS256` -> `NimbusJwtDecoder.withJwkSetUri(...).jwsAlgorithm(RS256)` (tạo một lần, lấy JWKS lười), khác (kể cả `none`) hoặc token hỏng -> `BadJwtException` (401). Không fallback giữa hai nhánh. Hai nhánh dùng chung validator cũ (issuer, audience, `token_use`, `user_status` ACTIVE, thời gian).
- `SecurityConfig.jwtDecoder` nhận thêm `@Value("${weav.jwt.jwks-uri}")`; `application.properties`: `weav.jwt.jwks-uri=${JWT_JWKS_URI:http://identity-service:8080/.well-known/jwks.json}`. Không đổi `JwtProperties`. Đường service-JWT nội bộ X-7 của workspace giữ nguyên.
- Test mới `AlgorithmRoutingJwtDecoderTest` (6 case mỗi service, JWKS giả bằng `HttpServer`, khóa RSA tạm): HS256 còn chạy, RS256 kid đã biết được chấp nhận và `user_status` không ACTIVE bị từ chối, kid lạ, HS256 ký bằng byte public key, `alg: none`, JWKS không kết nối được -> `JwtException` (HS256 vẫn chạy).
- Kết quả `./mvnw verify`: workspace 418 test, 3 lỗi; workflow 494 test, 1 lỗi. Cả 4 lỗi là cầu nối Notification (`workspace-service/test/notification-runtime-bridge.cjs` dòng 4 `require('jsonwebtoken')`) vì lane notification đã bỏ `jsonwebtoken` khỏi `node_modules`. Cần sửa cầu nối này (ví dụ ký HS256 bằng `node:crypto`/`jose`), không liên quan tới verifier Java.

## Kiểm tra lại (coordinator, 2026-10-02)

- Phát hiện khi kiểm tra: lane notification bỏ `jsonwebtoken` làm hỏng bridge test dùng chung `services/workspace-service/test/notification-runtime-bridge.cjs` (4 lỗi `Cannot find module`). Đã sửa bằng signer HS256 `node:crypto` (commit `d3a6b5e`).
- `./mvnw verify`: workspace 418/418; workflow 494/494; identity 360 test, 3 error (Avatar minio đã biết), 1 skipped.
- gateway unit 107, e2e 82, build OK; notification unit 101, e2e 19, build OK, `test:integration` 8/8 (container tạm `test/compose.yml`, đã `down -v`).
- Chưa làm: bước d (bỏ HS256 và `JWT_ACCESS_SECRET`) — chỉ làm sau khi chạy RS256 ổn định một thời gian. Để bật RS256 ở dev: `node scripts/identity-dev-keys.mjs`, đặt `JWT_ACCESS_ALG=RS256` trong `.env`, rebuild identity.

## Live smoke RS256 (2026-10-03)

- `compose.workflow-smoke.yml`: identity nhận `JWT_ACCESS_ALG=${WORKFLOW_SMOKE_JWT_ACCESS_ALG:-HS256}`, khóa `/run/identity-keys/identity-access.pem` (kid `identity-smoke-1`), mount read-only `tmp/service-keys/identity`. `start-workflow-v1-live-smoke.ps1`: kiểm tra cô lập cho phép đúng một bind mount read-only `/run/identity-keys` cho identity; các service khác vẫn cấm volume.
- `WORKFLOW_SMOKE_JWT_ACCESS_ALG=RS256` + `start-workflow-v1-live-smoke.ps1`: PASS (đã xác nhận compose giải ra `JWT_ACCESS_ALG=RS256`; identity không khởi động được nếu không tải được khóa). Đăng ký/xác minh/đăng nhập, tạo workspace, workflow create/draft/publish/admission/detail, execution `SUCCESS` — tức token RS256 do identity ký được workspace và workflow xác minh qua JWKS thật.
- Dọn dẹp: compose project và volume đã xoá; 3 schema `weav_workflow_smoke_*_20261002_a589be3cc73c` đã xoá theo đúng tên sau khi kiểm tra phụ thuộc và tạo backup branch `backup-before-smoke-cleanup-2026-10-03` (`br-weathered-field-b3f04tuc`).
