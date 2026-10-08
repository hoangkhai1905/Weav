# Nhật ký: Đăng nhập Google cho mobile (W6-D1, backend)

> Thiết kế: `docs/superpowers/specs/2026-10-08-mobile-oauth-and-workspace-delete.md` mục A. Bàn giao cho partner: `docs/handoff/2026-10-week6-mobile.md` mục A. Không ghi secret.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Nhánh / commit gốc | `feat/w6-d1-mobile-oauth` (từ `week6` 1cafb47), worktree `T:\Weav-wt\w6-d1` |
| Người thực hiện | AI agent (lane W6-D1) |
| Trạng thái | `Hoàn thành`, chưa commit (coordinator commit) |
| Phạm vi | identity-service: client OAuth thứ hai `mobile`; gateway: route exchange công khai; `.env.example`; handoff cho partner. |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Phương án đã cân nhắc | Hệ quả |
| --- | --- | --- | --- |
| D-OA1 (K đã xác nhận): chỉ bước exchange đi qua gateway; `mobile/start` và `callback` ở URL công khai của identity | Không cần proxy hiểu redirect/Set-Cookie, không đổi cookie path, không thêm redirect URI mới ở Google | Đưa cả 3 bước sau gateway | App cần `EXPO_PUBLIC_IDENTITY_URL` (HTTPS khi thử trên thiết bị vì cookie correlation là `Secure`) |
| `OAuthConfiguration` giữ `Map<String, OAuthClientRegistration> clients`; `webClient()` / `mobileClient()` là accessor dẫn xuất | Spec: registrations là map theo `clientId`; không phải sửa các chỗ gọi `webClient()` (CORS, `OAuthWebProtection`, test) | Thêm trường `mobileClient` riêng | `OAuthConfiguration.enabled(...)` giữ chữ ký cũ, thêm overload nhận `Optional<mobile>` |
| `OAuthUriPolicy.requireMobileReturnTarget` tách riêng (scheme allowlist `weav`; có host, path tuyệt đối; cấm userinfo/query/fragment/wildcard) | Quy tắc web (`requireRedirectUri`, `GOOGLE_REDIRECT_URI`) không đổi; không so với `allowedOrigins` | Nới `requireRedirectUri` | Muốn thêm scheme khác phải sửa hằng `MOBILE_SCHEMES` cùng cấu hình app |
| `OAuthClientRegistration.allowedOrigins` được phép rỗng | Client mobile không có Origin; web vẫn bắt buộc 1..16 origin trong `OAuthProperties` | Gán origin web cho mobile (sai ngữ nghĩa) | Invariant "không rỗng" chỉ còn ở lớp cấu hình web |
| Mobile bị tắt (env trống) hành xử như web bị tắt: `DependencyUnavailableException` (503); id client lạ vẫn là `INVALID_OAUTH_CLIENT` (400) | Spec: "behave exactly like the web client does when disabled" | Trả 404 | Test coordinator + test HTTP riêng cho trường hợp tắt |
| Route web (`/auth/oauth/google/start`, `/auth/oauth/exchange`) ghim `clientId=web`; LINK (`startLink`/`exchangeLink`) ghim web trong coordinator | Handoff mobile không được đổi ở transport web (Origin/CSRF + cookie refresh); LINK cần mật khẩu hiện tại | Chỉ dựa vào binding của store | Body web chọn `mobile` bị `400 INVALID_OAUTH_CLIENT`; handoff web đưa vào exchange mobile bị `401 OAUTH_HANDOFF_INVALID` (store so khớp `clientId`) |
| Challenge mobile giữ đúng 43 ký tự base64url (`OAuthProtocolPolicy.requireS256Challenge`) | S256 luôn ra 43 ký tự; challenge dài hơn không bao giờ khớp verifier. RFC 7636 cho phép 43-128 chỉ vì các method khác | Nhận 43-128 | Brief ghi 43-128; không có giá trị thực tế khác 43 với S256 |
| Response exchange dùng lại `UserPresentationMapper.toResponse(TokenPairResult)` = `TokenResponse` của `POST /auth/login` | "Cùng shape/mapper"; có thêm `refreshExpiresAt` giống login | Bọc dạng `OAuthLoginExchangeResponse` | App dùng chung parser với đăng nhập mật khẩu |

## 3. Thay đổi đã thực hiện

### 3.1. Identity-service
- `OAuthClientRegistration`: hằng `WEB`/`MOBILE`, cho phép `allowedOrigins` rỗng.
- `OAuthConfiguration`: map `clients`, `client(id)`, `webClient()`, `mobileClient()`, overload `enabled(web, Optional<mobile>, ...)`.
- `OAuthUriPolicy.requireMobileReturnTarget`.
- `OAuthProperties`: `weav.oauth.mobile.return-target-uri` (env `OAUTH_MOBILE_RETURN_TARGET_URI`, trống = tắt), `MobileProperties`, đăng ký client `mobile` dùng chung Google client + callback với web.
- `OAuthFlowCoordinator`: tra registration theo `clientId`; mobile chưa cấu hình = như tắt; LINK chỉ web.
- `GoogleOidcAdapter.requireConfiguredRegistration`: tra theo `clientId` của registration được yêu cầu (runtime Google dùng chung).
- `OAuthController`: `GET /auth/oauth/google/mobile/start` (303 tới Google + cookie correlation, không Origin/CSRF, validate challenge/method), `POST /auth/oauth/mobile/exchange` (token trong body, không cookie), ghim `web` cho start/exchange web. Callback không đổi (mobile redirect `weav://auth/callback?...`).
- `OAuthMobileExchangeRequest` (mới), `SecurityConfig` permitAll đúng 2 route mới, `AuthRateLimitFilter`: start -> `OAUTH_START_IP`, exchange -> `OAUTH_EXCHANGE_IP`.
- `application.properties`: `weav.oauth.mobile.return-target-uri=${OAUTH_MOBILE_RETURN_TARGET_URI:}`.

### 3.2. Gateway
- `identity.module.ts`: `POST /api/auth/oauth/mobile/exchange` công khai, body zod `.strict()` (43/43/43..128 ký tự đúng bảng chữ cái), forward tới `/auth/oauth/mobile/exchange`.
- `gateway-throttler.guard.ts`: thêm path vào `PUBLIC_AUTH_MUTATION_PATHS` (cùng bucket với các mutation auth công khai).

### 3.3. Cấu hình, tài liệu
- `.env.example`: `OAUTH_MOBILE_RETURN_TARGET_URI=` (trống = tắt; giá trị dev `weav://auth/callback`).
- `docs/handoff/2026-10-week6-mobile.md` mục A (coordinator gộp mục B của W6-D2).

## 4. Danh sách file ảnh hưởng

| Loại | Đường dẫn |
| --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/dto/OAuthClientRegistration.java`, `.../dto/OAuthConfiguration.java`, `.../validation/OAuthUriPolicy.java`, `.../usecase/OAuthFlowCoordinator.java`, `.../infrastructure/config/OAuthProperties.java`, `.../infrastructure/security/oauth/GoogleOidcAdapter.java`, `.../infrastructure/security/SecurityConfig.java`, `.../infrastructure/security/AuthRateLimitFilter.java`, `.../presentation/http/OAuthController.java`, `services/identity-service/src/main/resources/application.properties` |
| Thêm | `.../presentation/http/request/OAuthMobileExchangeRequest.java` |
| Sửa (test) | `OAuthUriPolicyTest`, `OAuthPropertiesTest`, `OAuthFlowCoordinatorTest`, `GoogleOAuthHttpIntegrationTest` |
| Thêm (test) | `GoogleOAuthMobileDisabledHttpIntegrationTest`, `services/api-gateway/test/mobile-oauth.e2e-spec.ts` |
| Sửa | `services/api-gateway/src/identity/identity.module.ts`, `services/api-gateway/src/rate-limit/gateway-throttler.guard.ts`, `.env.example` |
| Thêm | `docs/handoff/2026-10-week6-mobile.md`, `docs/work_logs/K/identity/mobile-oauth.md` |

## 5. Kiểm tra và bằng chứng

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Unit identity (policy, properties, coordinator, contract, env binding) | `./mvnw -q test -Dtest=OAuthUriPolicyTest,OAuthPropertiesTest,OAuthFlowCoordinatorTest,OAuthContractTest,OAuthEnvironmentBindingTest,OAuthEnvironmentDisabledBindingTest` | PASS (5+21+14+5+1+1 test) |
| HTTP integration (Testcontainers) | `./mvnw -q test -Dtest=GoogleOAuthHttpIntegrationTest` | PASS (16 test, gồm 5 test mobile mới; luồng web cũ giữ nguyên) |
| Mobile tắt | `./mvnw -q test -Dtest=GoogleOAuthMobileDisabledHttpIntegrationTest` | PASS (1 test: 503 cho start/exchange mobile, start web vẫn 200) |
| Identity đầy đủ | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` | xem mục 5.1 |
| Gateway | `pnpm --dir services/api-gateway test` / `test:e2e` / `build` | 112/112, 127/127, build OK |
| Eslint (không --fix) | `pnpm --dir services/api-gateway exec eslint <file đã sửa>` | sạch cho file của lane; toàn cây còn 3 lỗi cũ ở `notifications.module.ts`, `workflow.module.ts` (không thuộc lane) |

### 5.1. Verify đầy đủ
`JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (identity-service): 378 test, 0 failure, 3 error, 1 skipped. 3 error là lỗi môi trường đã biết (Avatar: `AvatarTransactionRollbackIntegrationTest`, `S3AvatarStorageIntegrationTest`, `AvatarHttpIntegrationTest`, không kéo được image minio). Lần chạy đầu có thêm 1 error `IdentitySecurityNotificationRuntimeIntegrationTest` ("bridge exited before readiness") vì worktree chưa có `services/notification-service/dist`; sau khi `pnpm --dir services/notification-service build` (output git-ignored) thì pass.

### 5.2. Vòng review 1 (đã sửa)
- `compose.dev.yml`: thêm `OAUTH_MOBILE_RETURN_TARGET_URI: ${OAUTH_MOBILE_RETURN_TARGET_URI:-}` cho identity.
- `packages/contracts/http/auth/openapi.yaml`: thêm `GET /auth/oauth/google/mobile/start` (303/400/429/503), `POST /auth/oauth/mobile/exchange` (TokenResponse; 400/401/409/429/503) và schema `OAuthMobileExchangeRequest`. Contract gateway không liệt kê route `/api/auth/*` và không có `packages/contracts/README.md`, nên không sửa.
- LOW-2: env mobile được `strip()`, scheme chuẩn hóa chữ thường (`WEAV://...` thành `weav://...`); bắt lỗi thật khi dựng lại URI làm rơi fragment: kiểm tra userinfo/query/fragment trên URI đã parse trước khi dựng lại.
- Test thêm: gateway e2e (401 `OAUTH_HANDOFF_INVALID` và 503 được relay nguyên status+body; `x-forwarded-for` và `user-agent` tới identity), `AuthRateLimitFilterTest` (exchange mobile -> `OAUTH_EXCHANGE_IP`, GET start mobile -> `OAUTH_START_IP`, cùng bucket với web), integration identity (5 verifier sai làm cháy handoff; callback mobile `error=access_denied` redirect `weav://auth/callback?...oauth_error=cancelled`), properties (` weav://auth/callback `, `WEAV://auth/callback`).
- Handoff: bảng lỗi liệt kê cả mã gateway (`BAD_REQUEST`, `TOO_MANY_REQUESTS`, `SERVICE_UNAVAILABLE`) và mã identity, dặn app phân nhánh theo HTTP status trước; mục A.4b về proxy/IP.
- Kiểm tra: identity `verify` 383 test, 0 failure, 3 error Avatar đã biết; gateway `test` 112/112, `test:e2e` 130/130, `build` OK, eslint sạch trên file đã sửa, `git diff --check` sạch.

### Điều chưa được kiểm tra
- Chưa chạy luồng thật với Google, tunnel HTTPS và thiết bị/emulator (coordinator làm; các bước ở handoff mục A.6).
- GitNexus `detect_changes` chưa chạy trong worktree (coordinator chạy trước khi commit).

## 6. Rủi ro và việc tiếp theo

| Mức độ | Vấn đề | Xử lý |
| --- | --- | --- |
| Trung bình | Rate limit theo IP client: identity chỉ tin `X-Forwarded-For` từ gateway, nên sau tunnel/Caddy các bước trình duyệt (`mobile/start`, `callback`) dùng chung 1 bucket cho mỗi IP proxy (`OAUTH_START_IP` 10/15 phút, dùng chung với start của web) | Khi deploy: `GATEWAY_TRUST_PROXY_HOPS` khớp chuỗi proxy; thêm reverse proxy công khai vào trusted-proxy pattern của identity. Đã ghi ở handoff A.4b |
| Trung bình | Custom scheme có thể bị app khác trên Android chiếm | Giảm thiểu: verifier PKCE chỉ ở app, handoff dùng 1 lần TTL 60 s, tối đa 5 lần sai; App Links để sau |
| Thấp | Thử trên thiết bị cần identity qua HTTPS và `GOOGLE_REDIRECT_URI` đúng URL tunnel, đã đăng ký ở Google Cloud Console (hành động của K) | Ghi ở handoff A.1 |

## 7. Tham chiếu
- `docs/superpowers/specs/2026-10-08-mobile-oauth-and-workspace-delete.md`
- `docs/handoff/2026-10-week6-mobile.md`
