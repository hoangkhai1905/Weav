# Nhật ký: WS-6 gắn OAuth Google với người dùng đã xác thực (lane E)

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | 2026-10-01 |
| Dự án / nhánh | Weav / `refactor/optimize-backend` (chưa commit) |
| Người thực hiện | AI agent (Sonnet) theo thiết kế "authenticated completion" đã được người dùng duyệt |
| Trạng thái | Hoàn thành code + kiểm tra tự động; chưa chạy Google consent thật |
| Phạm vi | WS-6 (OAuth binding + PKCE), WS-1 (`user_status`), X-8 (bỏ `refresh-secret`), route Gateway, contract, web |
| Ngoài phạm vi | Lane F: compose files, `docs/development/SETUP.md`, `workflow-service`, `docs/specs/services/workflow-service.md` (không sửa) |

## 2. Quyết định kỹ thuật

| Quyết định | Lý do | Phương án khác | Hệ quả |
| --- | --- | --- | --- |
| Callback `GET /oauth/google/callback` không đổi code lấy token và không ghi DB; chỉ consume state rồi lưu `{ConsumedState, code}` vào Redis (`workspace:oauth-completion:<id>`) | Callback công khai không chứng minh được trình duyệt thuộc về ai; bản thân Google token chưa từng tồn tại trước khi gắn người dùng | Đổi code ngay tại callback rồi giữ token trong Redis TTL ngắn | **Đổi code ở bước complete.** Không có Google token nào nằm trong Redis. Redis chỉ giữ authorization code (dùng một lần, TTL 5 phút, `toString` che giá trị). Code Google sống ~10 phút nên TTL 5 phút là đủ |
| PKCE S256: `code_verifier` chỉ nằm trong `OAuthPendingState` (Redis), gửi `code_challenge` + `code_challenge_method=S256` tới Google, verifier gửi ở bước đổi code | Chặn việc dùng code bị lộ ở nơi khác | Không dùng PKCE | Verifier không có trong URL, DB hay log (`toString` che). State cũ không có verifier vẫn đọc được (additive) |
| Completion id = 32 byte `SecureRandom`, base64url không padding (43 ký tự) | 256-bit, không đoán được | UUID | Id là bí mật: không log (`CompleteOAuthRequest.toString` che) |
| Consume bằng một script Lua `GET`+`DEL` duy nhất | Nguyên tử trong Redis, replay không thể thành công hai lần; không có read-then-delete | `GETDEL` (cần Redis >= 6.2) | Cùng kiểu với `RedisOAuthStateStore`. Test đua 16 luồng x 10 vòng: đúng 1 thắng |
| **Mọi lỗi liên kết trả cùng một `409` (`ConflictException`)**: không tồn tại, hết hạn, đã dùng, id sai định dạng, sai user, sai workspace, sai connection | Không để lộ bản ghi có tồn tại hay không, không lộ initiator. Bản ghi đã bị consume trước khi kiểm tra, nên kẻ tấn công không thể thử lại và initiator thật cũng không thể thử lại | 403 cho mismatch, 404 cho unknown | Phiên bản đầu của diff dùng 403 cho mismatch (phân biệt được): đã đổi sang 409. `403/404` chỉ còn khi chính initiator đã mất quyền truy cập workspace (kiểm tra bởi `ConnectionUsageProtection`) |
| Lệnh gọi Google nằm ngoài transaction cuối | Giữ nguyên tính chất của commit 642486a | n/a | `executePending` giữ nguyên: authorize, đổi code, verify, rồi mới `reauthorizeAndMutate` ghi DB |
| Redirect lỗi giữ `oauth=failed&reason=<state_invalid\|authorization_denied\|token_exchange_failed>` (không phải `oauth=error`) | Web hiện tại đã dùng `failed`; thay đổi chỉ cộng thêm `oauth=pending` | Đổi tên thành `error` | Contract: `authorization_changed` và `verification_failed` không còn xuất hiện ở redirect (chúng giờ là mã lỗi HTTP của bước complete). Chỉ ghi nhận, web vẫn có key dịch cũ |
| TTL completion cấu hình qua `weav.google.oauth.completion-ttl` (`GOOGLE_OAUTH_COMPLETION_TTL`, mặc định `PT5M`, 1 giây đến 10 phút), đọc bằng `@Value` | Không phá chữ ký record `GoogleOAuthProperties` mà test đang dùng | Thêm field vào record | Giá trị ngoài khoảng làm app không khởi động |
| WS-1: `JwtAccessTokenValidator` chỉ chấp nhận `user_status=ACTIVE` | Khớp quy tắc workflow-service đã áp dụng (`SecurityConfig.java` của lane F không được đọc hay sửa) | Giữ `ACTIVE|DISABLED` | DISABLED hoặc thiếu claim thì 401 |
| X-8: bỏ `weav.jwt.refresh-secret` và field `refreshSecret` | Workspace chỉ xác thực access token | Giữ để "đồng bộ cấu hình" | Không sửa compose (lane F đã bỏ `JWT_REFRESH_SECRET` khỏi env workspace) |
| Web: gọi `complete` đúng một lần nhờ `oauthCallbackHandled` ref (đã có) và xoá query ngay bằng `navigate(replace)`; hiển thị kết quả bằng notice sẵn có (`connections.oauth.*`), thêm key `connections.oauth.completing` (vi + en) | StrictMode chạy effect hai lần nhưng ref được giữ, nên không gọi lần hai vào bản ghi đã consume | Toast mới | 409 hiển thị "không xác minh được, hãy bắt đầu lại" mà không lộ chi tiết server |

## 3. Thay đổi đã thực hiện

- **workspace-service (main):** `OAuthCompletionStore` (port, mới), `RedisOAuthCompletionStore` (mới), `CompleteOAuthRequest` (mới); `CompleteConnectionOAuthUseCase` (`executeForCallback` chỉ lưu completion, `completeAuthenticated` mới), `StartConnectionOAuthUseCase` (verifier + challenge), `OAuthPendingState` (+`codeVerifier`), `GoogleOAuthCallbackResult` (`pending`), `GoogleOAuthPort`/`GoogleOAuthProvider` (challenge, verifier), `ConnectionController` (+`POST .../oauth/complete`), `GoogleOAuthCallbackController` (redirect `oauth=pending`), `WorkspaceApplicationConfig` (bean + TTL), `JwtAccessTokenValidator`, `JwtProperties`, `application.properties` (xoá refresh-secret, thêm completion-ttl).
- **workspace-service (test):** `GoogleOAuthUseCasesTest`, `WorkspaceConnectionHttpIntegrationTest` (thêm test token DISABLED nhận 401), `RedisOAuthCompletionStoreTest` (mới), `RedisOAuthStateStoreTest`, `GoogleOAuthProviderTest`, `JwtAccessTokenValidatorTest`, `WorkspaceContractValidationTest`, `InternalConnectionUseCasesTest`, `WorkspaceNotificationRuntimeIntegrationTest`, `src/test/resources/application.properties`.
- **api-gateway:** `workspace.controller.ts` (route `POST .../oauth/complete`, zod `.strict()`, `completion` khớp `^[A-Za-z0-9_-]{32,128}$`), `test/workspace.e2e-spec.ts` (proxy hợp lệ; 400 cho id ngắn, ký tự lạ, field thừa, thiếu body, connection id không phải UUID; 401 khi chưa đăng nhập; đếm 20 operation), `README.md`.
- **contracts:** `packages/contracts/http/workspace/openapi.yaml` (operation `completeGoogleConnectionOAuthAuthenticated`, schema `CompleteOAuthRequest`, mô tả redirect mới), `packages/contracts/http/gateway/openapi.yaml` (19 thành 20 operation), `packages/contracts/http/gateway/README.md`.
- **web:** `api/connection.api.ts` (`completeGoogleOAuth`), `pages/ConnectionsPage.tsx`, `lib/i18n/translations.ts`, `e2e/workspace-connections.spec.ts` (3 case mới: thành công kèm body và bearer đúng, 409 an toàn, thiếu context cục bộ thì không gọi complete).
- **docs:** `docs/specs/services/workspace-service.md`, `docs/specs/services/api-gateway.md`, `docs/specs/apps/web.md`, `services/workspace-service/README.md`, file log này.

## 4. Kiểm tra và bằng chứng

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Workspace | `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (services/workspace-service) | PASS: 383 test, 0 fail, 0 error, 0 skipped, BUILD SUCCESS |
| Gateway typecheck | `pnpm --dir services/api-gateway exec tsc --noEmit` | PASS |
| Gateway unit | `pnpm --dir services/api-gateway test` | PASS: 92/92 (8 suite) |
| Gateway e2e | `pnpm --dir services/api-gateway test:e2e` | PASS: 81/81 (6 suite) |
| Gateway build | `pnpm --dir services/api-gateway build` | PASS |
| Gateway lint (không fix) | `pnpm --dir services/api-gateway exec eslint "{src,test}/**/*.ts"` | File đã sửa sạch. Còn 9 lỗi có sẵn ở `src/notifications/notifications.module.ts` và `src/workflow/workflow.module.spec.ts` (không thuộc lane E, không sửa) |
| Web typecheck / build | `pnpm --dir apps/web exec tsc --noEmit`; `pnpm --dir apps/web build` | PASS / PASS |
| Web connections spec | `VITE_API_MODE=http pnpm --dir apps/web exec playwright test --project=chromium e2e/workspace-connections.spec.ts` | PASS: 32/32 (gồm 3 case mới) |
| Web toàn bộ, mode `mock` (lệnh trong CLAUDE.md) | `VITE_API_MODE=mock ... playwright test --project=chromium` | 54 pass, 2 skipped, 121 fail |
| Web toàn bộ, mode `http` | `VITE_API_MODE=http ... playwright test --project=chromium` | 108 pass, 2 skipped, 67 fail |

### Phân tích lỗi Playwright (không liên quan thay đổi này)

- Bộ spec là hai nhóm: nhóm HTTP mock bằng `page.route` (chờ `/api/auth/me`, cần mode `http`) và nhóm mock nội bộ của app (cần mode `mock`). Ở mode `mock` `isAuthMockMode` bỏ qua `/api/auth/me`, nên `gotoAuthenticatedPath` hết hạn 30 giây: đây là nguyên nhân 121 lỗi, gồm cả `workspace-connections.spec.ts`. Ghi chú trong CLAUDE.md ("cần `VITE_API_MODE=mock`") không đúng cho các spec HTTP; cần sửa CLAUDE.md.
- 23 test thất bại ở cả hai mode (giao của hai lần chạy): `dashboard-real-data:102`, `localization:116,154`, `notification-task10-live:343` (spec live cần stack thật), `ocr-builder:84,666`, `password-recovery` x8, `workflow-ui:263`, `workspace-members:161`, `workspace-read-switch:158,233,282,313,440,504,535`. Chạy lại tập con với 2 worker vẫn lỗi y hệt, nên không phải do tải máy.
- Nguyên nhân đã xem: `workspace-read-switch:158` kỳ vọng "Workspace access denied." nhưng UI hiện "You do not have access to this workspace. Select another workspace."; `workspace-members:161` kỳ vọng "required" nhưng UI hiện "Enter the email of an existing Identity user."; `localization:154` hỏng tại `/workflows` ("Hôm nay, 10:40"), trước khi tới `/connections`; `dashboard-real-data:102` kỳ vọng link `/workflows` nhưng nhận `/workflows/wf-prod-8492/builder`. Đây là assertion lỗi thời so với giao diện hiện tại. Diff của lane E trong `translations.ts` chỉ thêm 2 key mới (`connections.oauth.completing`), không đổi chuỗi nào có sẵn.
- Không chứng minh được bằng chạy trên HEAD (cấm stash và worktree); kết luận dựa vào nội dung lỗi ở trên và việc các spec này không đi qua mã Connections. Cần người review xác nhận khi có thể.
- Các lỗi chỉ ở một mode còn lại (44 ở `http`, 89 ở `mock`) là do spec cần mode kia.

### Điều chưa được kiểm tra

- Google consent thật (Gmail/Sheets) chưa chạy; luồng đã được kiểm bằng provider giả và HTTP server cục bộ cho token endpoint (PKCE verifier, code, scope).
- Chưa chạy luồng đầy đủ trên stack Docker thật (Gateway + Workspace + web) và chưa chụp console/network của trình duyệt thật cho trang Connections.
- Chưa chạy GitNexus `detect_changes` (chưa commit). Chỉ chạy được `impact` cho `completeAuthenticated` và `oauthCompletionStore`: kết quả `UNKNOWN` vì symbol mới chưa có trong index; đã xác nhận bằng tìm text rằng chỉ `ConnectionController` gọi `completeAuthenticated` và `CompleteConnectionOAuthUseCase` là nơi dùng bean.

## 5. Tự kiểm tra bảo mật

- Consume là một thao tác Lua duy nhất trong Redis; không có read-then-delete. Đã có test đua luồng.
- Đường mismatch trả cùng `409` và cùng thông điệp với unknown/expired/replayed; thân phản hồi không chứa initiator id hay completion id (test HTTP kiểm `doesNotContain`).
- Không có Google token hay `code_verifier` trong log, URL (ngoài `code` do chính Google đặt trong callback) hay DB trước khi hoàn tất: callback chỉ gọi `completionStore.save`, test khẳng định `exchangeCalls == 0`, không có credential, connection còn `DISABLED`. Mọi `toString` liên quan (`OAuthPendingState`, `PendingCompletion`, `GoogleOAuthCallbackResult`, `CompleteOAuthRequest`) che giá trị bí mật. Lưu ý: `ConsumedState` trong bản ghi completion có `codeVerifier` (nằm trong Redis, TTL ngắn, đúng thiết kế).
- Completion id: 256-bit `SecureRandom`, base64url không padding.
- Phát hiện khi review: bản diff đầu tiên trả 403 cho mismatch (lộ bản ghi tồn tại) và file test sinh BOM UTF-8 sau khi sửa bằng PowerShell; đã sửa cả hai.

## 6. Rủi ro và việc tiếp theo

| Mức độ | Vấn đề | Việc cần làm |
| --- | --- | --- |
| Trung bình | Google consent thật chưa được chạy (cần client OAuth thật và tài khoản thử) | Chạy thủ công một lần Gmail và Sheets trước khi merge vào `dev` |
| Thấp | Authorization code tồn tại tối đa 5 phút trong Redis | Giữ Redis nội bộ; giảm `GOOGLE_OAUTH_COMPLETION_TTL` nếu cần |
| Thấp | Người dùng chặn chuyển hướng hoặc reload khi `oauth=pending` thì completion bị mất | Bấm Connect Google lại (state mới); web hiển thị hướng dẫn 409 |
| Thấp | Compose/`.env.example` chưa liệt kê `GOOGLE_OAUTH_COMPLETION_TTL` (compose thuộc lane F) | Thêm khi gộp lane F; có mặc định `PT5M` nên không bắt buộc |
| Thông tin | CLAUDE.md ghi sai mode Playwright cho spec HTTP | Cập nhật CLAUDE.md và AGENTS.md ở một commit riêng |

Hướng dẫn cho agent tiếp theo: giữ nguyên các quyết định ở mục 2 (đặc biệt phản hồi 409 thống nhất), không đưa thêm logic ghi credential vào callback.

## 7. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Trạng thái worktree | Có thay đổi chưa commit (lane E và lane F chung worktree; hai lane tách commit) |
| Commit/PR | Chưa tạo |
| Người cập nhật log | AI agent |
