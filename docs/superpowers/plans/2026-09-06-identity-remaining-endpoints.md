# Identity Remaining Endpoints Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans when implementation is requested and the relevant skill is available; otherwise follow the same task-by-task review gates. Checkboxes track future implementation, not work completed in this planning session.

**Goal:** Hoàn thiện hồ sơ cá nhân, quản lý session, xác minh email/OTP, quên và đổi mật khẩu, Google login/linking, admin xem/khóa/mở khóa user.

**Architecture:** Giữ domain/application độc lập framework; JPA, Spring Security, SMTP, Valkey và object storage nằm ở adapter. Identity sở hữu user/session/login OAuth; Workspace sở hữu membership và integration credentials. Mỗi milestone phải có contract và HTTP acceptance riêng.

**Tech Stack:** Java 25, Spring Boot 4.1.0, Maven Wrapper, Spring Security, BCrypt, JPA/Flyway, PostgreSQL 18, Valkey; bổ sung mail và OAuth2 Client khi tới milestone tương ứng.

**Status:** Plan v1 ngày 2026-09-06; phạm vi và ba lựa chọn sản phẩm đã được người dùng xác nhận. Các lựa chọn kỹ thuật bên dưới là đề xuất để triển khai/review, không phải khả năng đã có. Session này chỉ viết tài liệu.

---

## 1. Baseline đã đối chiếu

Checkout: `feat/identity-service`, HEAD `85c0d01`, worktree sạch trước khi thêm plan.

| Hạng mục | Trạng thái thực tế |
| --- | --- |
| Register/login/refresh/logout | Đã có controller, use case, persistence, bearer JWT và contract |
| Current user | Đã có `GET /users/me`, kiểm tra active user và active matching session |
| PostgreSQL | Có V1 và V2 canonical-email unique index; không sửa lại migration đã có |
| Test | Log core-auth ghi 62 test pass, PostgreSQL 18 và random-port HTTP pass ngày 05/09; chưa chạy lại trong session lập plan |
| OAuth | Có domain/port/JPA entity; hai repository implementation còn là file rỗng |
| Profile/admin/session management | Chưa có endpoint ngoài current user |
| OTP/recovery/email ownership | Chưa có implementation; không có trường lưu email đã xác minh |
| Hạ tầng | Có Redis dependency và hướng dẫn Aiven Valkey; chưa có mail adapter; setup ghi storage chưa cấu hình |
| Consumers | Core contract chưa giải quyết Gateway, cookie/CSRF/CORS hay browser/native auth delivery |

Readiness/design ngày 05/09 mô tả thời điểm trước implementation. Log core-auth mới hơn chứng minh milestone core; trạng thái “uncommitted” trong log đã được thay thế bởi Git HEAD hiện tại.

### Quyết định người dùng đã xác nhận

1. CRUD user = hồ sơ cá nhân + admin xem danh sách/chi tiết, khóa/mở khóa. Tạo user tiếp tục qua register. Không thêm admin tạo tài khoản, đổi role hay xóa user trong plan này.
2. Giữ đăng ký/đăng nhập hiện tại; thêm trạng thái email đã xác minh, không bắt buộc xác minh trước login.
3. Chưa chọn nhà cung cấp email: thiết kế cổng SMTP, test bằng mail catcher.
4. Neon hiện là DB test và được phép dùng để test endpoint. Không cần xin lại quyền sử dụng test DB cho các test thuộc phạm vi này; việc test không đồng nghĩa với xóa toàn bộ dữ liệu hiện có.

### Đối chiếu nghiệp vụ

- Google Docs, chỉ phần đến hết chương 3: UC001 login, UC002 recovery qua OTP/link, UC003 register, UC004 change password, UC029 list users, UC030 disable/enable. UC031/032 thuộc Workspace/Workflow, không đưa vào Identity.
- Notion Identity schema/model: Google login, basic profile/avatar, sessions, ACTIVE/DISABLED, USER/ADMIN; OTP và temporary auth state dùng Redis + TTL.
- Code/config thắng các chi tiết stack cũ: Neon/schema `identity`/BCrypt/PostgreSQL test 18; không quay lại Supabase, `identity_schema`, Argon2 theo trang cũ.
- Một số đoạn chương 3 còn dùng thuật ngữ của đề tài khác; chỉ lấy yêu cầu WEAV rõ ràng. Không dùng nội dung chương 4 trở đi làm căn cứ.

## 2. Cách chia milestone và phạm vi

**Đề xuất:** M0 baseline/contracts → M1 hồ sơ/session/password change → M2 OTP/recovery → M3 Google → M4 admin → M5 avatar → M6 client delivery.

| Phương án | Đánh đổi |
| --- | --- |
| Theo milestone end-to-end, đề xuất | Mỗi mốc có API chạy được, dễ kiểm tra lỗi và rollback; shared user/session changes làm trước |
| Toàn bộ Identity V1 cùng lúc | Đồng thời phụ thuộc SMTP, Valkey, Google và storage; khó khoanh lỗi |
| Chỉ làm CRUD rồi thêm bảo mật sau | Nhanh cho demo hồ sơ nhưng reset/disable/session dễ không nhất quán; không chọn |

M4 có thể chạy ngay sau M1 nếu admin được ưu tiên. M3 phụ thuộc M2 cho reauthentication và recovery của local account; M5 phụ thuộc storage. M6 có thể bắt đầu phần password login sớm, nhưng OAuth chỉ được nghiệm thu đầy đủ khi đã chốt transport.

Không mở rộng sang MFA/TOTP, passwordless OTP login, SMS, Facebook/GitHub OAuth, thay email, thay system role, xóa user hay chuyển quyền Workspace. Đổi email là flow xác minh riêng, không được lén đưa vào PATCH profile. Avatar là phần hồ sơ có dependency riêng, không chặn display name.

## 3. Endpoint catalog đề xuất

Tất cả path dưới đây là **Identity-local**. Gateway public prefix sẽ được chốt ở M6. Mọi protected operation kiểm tra current user/session; admin đọc role hiện tại từ DB.

| Mốc | Method/path | Request chính | Success và quyền |
| --- | --- | --- | --- |
| Có sẵn | POST /auth/register | email, password, displayName? | 201 UserResponse; public |
| Có sẵn | POST /auth/login | email, password | 200 TokenPair; public |
| Có sẵn | POST /auth/refresh | refreshToken | 200 rotated TokenPair |
| Có sẵn | POST /auth/logout | refreshToken | 204 idempotent |
| Có sẵn | GET /users/me | — | 200 UserResponse; self |
| M1 | PATCH /users/me | displayName | 200 UserResponse; self |
| M1 | GET /users/me/sessions | page, size | 200 page of sessions; self |
| M1 | DELETE /users/me/sessions/{sessionId} | — | 204; owned session, kể cả current |
| M1 | DELETE /users/me/sessions | — | 204; revoke tất cả session, gồm current |
| M1 | POST /auth/change-password | currentPassword, newPassword | 204; self, revoke tất cả session |
| M2 | POST /auth/otp/request | purpose, email chỉ cho PASSWORD_RESET | 202 challenge receipt; quyền phụ thuộc purpose |
| M2 | POST /auth/otp/verify | challengeId, code | 200; verification result hoặc resetToken theo purpose đã lưu |
| M2 | POST /auth/forgot-password | email | 202; facade request OTP purpose PASSWORD_RESET |
| M2 | POST /auth/reset-password | resetToken, newPassword | 204; one-use reset grant, revoke tất cả session |
| M3 | POST /auth/oauth/google/start | clientId, returnTargetId, codeChallenge | 200 authorizationUrl; public, throttled |
| M3 | GET /auth/oauth/google/callback | Google code, state | 303 tới allowlisted return target với one-use handoff code |
| M3 | POST /auth/oauth/exchange | handoffCode, codeVerifier | 200 TokenPair qua transport đã chốt |
| M3 | GET /users/me/oauth-accounts | — | 200 metadata provider; self |
| M3 | POST /users/me/oauth/google/link | currentPassword + client handoff parameters | 200 authorizationUrl; local-password reauthentication, link intent |
| M3 | DELETE /users/me/oauth-accounts/{accountId} | currentPassword | 204; self, chỉ khi còn local password |
| M4 | GET /admin/users | page, size, search?, status? | 200 page; current ADMIN |
| M4 | GET /admin/users/{userId} | — | 200 admin-safe user detail; current ADMIN |
| M4 | PATCH /admin/users/{userId}/status | status: ACTIVE hoặc DISABLED | 200 UserResponse; current ADMIN |
| M5 | PUT /users/me/avatar | multipart image | 200 UserResponse; self |
| M5 | GET /users/me/avatar | — | 200 short-lived signed URL + expiresAt; self |
| M5 | DELETE /users/me/avatar | — | 204; self |

OAuth đường dẫn là application-owned routes; không giả định các path này là Spring defaults. Controller/filter mapping, callback registration và browser handoff phải khớp contract khi triển khai.

### Shape và lỗi

- `UserResponse` bổ sung nullable `emailVerifiedAt` (UTC Instant). Giữ toàn bộ field cũ; token response vẫn dùng cùng public user shape.
- PATCH profile: `displayName` bắt buộc xuất hiện, null xóa tên hiển thị, string trim với tối đa 120 ký tự; chuỗi trắng thành null. Reject body rỗng và unknown fields như email, role, status, avatarStorageKey.
- Session response: `id, createdAt, lastUsedAt, expiresAt, current, userAgent`. Chỉ list active sessions; userAgent có thể null cho session cũ; không expose token/hash/raw IP. Page mặc định 0/20, size 1..100; sort createdAt desc + id.
- Admin page mặc định 0/20, size 1..100; search tối đa 120 ký tự, query parameterized, sort ổn định createdAt desc + id. Không cho self-service list user toàn hệ thống.
- OTP receipt luôn cùng shape: `challengeId, expiresIn:300, retryAfter:60`; email không tồn tại vẫn trả opaque random ID cùng kích thước và không gửi mail.
- OTP verification result là discriminated response: `purpose=EMAIL_VERIFICATION, verified=true` hoặc `purpose=PASSWORD_RESET, resetToken, expiresIn=300`. Client không tự chọn purpose tại bước verify.
- Dùng `ApiErrorResponse` hiện có: 400 validation/challenge không hợp lệ; 401 credentials/session/reauth không hợp lệ; 403 quyền không đủ; 404 target không tồn tại/không thuộc user; 409 conflict; 429 + Retry-After; 503 dependency tạm thời lỗi.
- Login vẫn dùng generic 401. Recovery request không tiết lộ email tồn tại, OAuth-only hay disabled qua body/status/timing rõ rệt.
- Token/OTP/password records phải redacted khi stringify; secret responses no-store; không ghi OTP/token/authorization code/query callback vào access log.

## 4. Thiết kế các quy tắc khó

### 4.1 Authorization, transactions và session invalidation

Chuyển kiểm tra active user/session hiện đang nằm riêng trong GetCurrentUserUseCase thành application guard dùng chung, giữ nguyên signature/use-case behavior cho consumer cũ. Admin kiểm tra role DB hiện tại; `.authenticated()` hoặc role trong JWT chưa đủ.

Đề xuất nhất quán khóa **user trước, session sau** cho các mutation liên quan. Đây là thay đổi có giới hạn nhằm phục vụ endpoint mới:
- Login hash/verify ngoài transaction, vào transaction lock lại user, so sánh password hash với snapshot đã verify và đọc status mới trước khi tạo session.
- Refresh/logout dùng lookup đầu để tìm user ID, rồi trong transaction lock user → re-read/lock session và kiểm tra hash hiện tại. Không giữ session lock rồi chờ user lock.
- Profile/password/status/email verification/avatar writes phải load fresh dưới user lock, chỉ sửa field của operation; không save một User snapshot cũ làm mất password/status mới.
- Revoke-all/reset/change-password/disable serialize với login, refresh, OAuth session issuance và link/unlink theo cùng quy tắc.
- Admin operation có hai users phải khóa theo UUID tăng dần, kiểm tra lại actor ADMIN/active session sau khi khóa; tránh deadlock chéo.
- Logout giữ nguyên idempotent semantics; list/revoke session không cho user A nhìn hoặc thu hồi session user B.

Acceptance: một login đã verify password cũ trước reset không được tạo session hợp lệ sau reset commit; reset/disable hoàn tất thì session cũ không được refresh hoặc gọi protected Identity route. Enable không hồi sinh session đã revoked.

Đây là guarantee trong Identity. Gateway/downstream chỉ verify JWT offline vẫn có cửa sổ đến exp; M6 phải thống nhất current-session check/internal introspection trước khi tuyên bố thu hồi ngay trên toàn hệ thống.

### 4.2 Email verification, OTP và reset

- Additive migration `V3__add_user_email_verified_at.sql`: nullable `email_verified_at TIMESTAMPTZ`. Legacy users và register mới mặc định null; không suy luận verified từ account tồn tại.
- EMAIL_VERIFICATION request yêu cầu active self session và gửi tới email DB; reject client email override. Verify yêu cầu cùng user, active session, challenge purpose/email/user khớp; ghi verifiedAt sau khi consume.
- PASSWORD_RESET request public; chỉ gửi cho active local-password account. OAuth-only nhận cùng receipt nhưng không được tạo local password bằng recovery. UI đưa hướng dẫn dùng Google một cách chung, không phụ thuộc response.
- OTP 6 chữ số, SecureRandom, TTL 5 phút; lưu keyed HMAC của code + challengeId/purpose/user binding, không dùng plain SHA-256 cho không gian 6 chữ số.
- Resend/request mới: cooldown 60 giây, tối đa 5/hour/account, 20/hour/IP; verify tối đa 5 lỗi/challenge và 30/min/IP. Account key HMAC canonical email, áp dụng cả email không tồn tại. Các ngưỡng là default cấu hình đề xuất, cần đo trước public release.
- Dùng atomic Valkey script cho check TTL, attempts, consume và supersede challenge; key cùng account hash tag khi script cần multi-key. Request mới vô hiệu challenge và reset grant cũ của cùng purpose. Không mở khóa account bằng OTP.
- SMTP port do Identity sở hữu; không đưa OTP plaintext sang Notification DB hoặc Workspace. Mail catcher kiểm tra nội dung/recipient thực tế bằng test fixture, không log mail body.
- Request không chờ SMTP: dùng bounded application executor/queue, enqueue delivery job cho eligible account và no-op job cùng admission path cho account không eligible. Không dùng CallerRunsPolicy khiến SMTP chạy trên request thread khi đầy. Admission overload trả 503 chung trước account lookup; test latency không bị SMTP success/timeout chi phối. Queue development nằm trong memory, không lưu plaintext OTP ra disk/log; process crash có thể mất mail job, challenge tự hết TTL và người dùng request lại. Chưa claim durable mail delivery.
- Khi SMTP reject/timeout, invalidate challenge attempt tương ứng. Public recovery vẫn cùng receipt; ghi sanitized delivery failure và cho phép request lại sau cooldown. Receipt nghĩa là tiếp nhận yêu cầu, không cam kết email đã tới inbox.
- Khi Valkey unavailable: endpoint OTP thất bại đóng với sanitized 503; core auth giữ phạm vi behavior hiện có. Không fallback lưu OTP process-local hoặc bypass verify.

Luồng recovery:

```text
forgot-password -> request challenge -> nhận email OTP
otp/verify -> atomic consume challenge và tạo opaque 32-byte reset grant
reset-password -> validate new password -> consume grant -> lock user
               -> recheck ACTIVE + credential binding -> update password + revoke all -> commit -> 204
login mới -> 200; old password / all old refresh tokens -> 401
```

Reset grant TTL 5 phút, hash-only, bound user/purpose + fingerprint keyed của credential snapshot. Password change/reset làm invalid mọi grant gắn password cũ. Không dùng JWT access làm resetToken.

Credential fingerprint được chụp khi request OTP và được mang xuyên challenge → grant; verify/reset đều kiểm tra lại để OTP cũ không reset credential đã thay đổi. Reset thành công cũng ghi emailVerifiedAt nếu còn null, vì đã có proof gửi tới đúng email hiện tại; ghi cùng transaction password/session.

Valkey và PostgreSQL không có transaction chung: consume grant trước DB mutation để at-most-once; DB rollback/crash sau consume làm mất grant, người dùng request OTP mới. Không khôi phục grant một cách mù quáng, không claim exactly-once hoặc retry thành công sau response loss. Test rõ tình huống này.

Password change giữ BCrypt policy hiện có (8–72 ký tự, tối đa 72 UTF-8 bytes, không trim), kiểm tra currentPassword, update và revoke tất cả session trong một DB transaction. Return 204; client quay lại login. OAuth-only set-password là flow riêng ngoài scope.

### 4.3 Google login và explicit linking

Dùng Spring Security OAuth2 Client/OIDC để exchange/validate, Google provider duy nhất, scope openid/email/profile. Không xin Gmail/Sheets/offline credentials; đó là Workspace Connection.

Thiết lập authorization-code flow với state, nonce, PKCE S256 và redirect allowlist. Server lưu transaction ngắn hạn ở Valkey; state one-use. Web initiation có HttpOnly Secure SameSite=Lax correlation cookie; cần route-specific CSRF/origin design, không bật cookie rồi giữ blanket CSRF disable cho mọi flow.

Phân biệt PKCE provider exchange và client handoff proof: backend giữ verifier cho exchange với Google; client giữ verifier riêng cho handoffCode. Callback không đưa Weav access/refresh token vào URL, chỉ handoffCode TTL 60s một lần, bound clientId/returnTargetId/codeChallenge. Exchange kiểm tra proof và consume atomically. Web/native chi tiết transport phải được chốt trước coding callback, xem M6.

Provider identity = GOOGLE + `sub`, không dùng email làm primary key. Validate signature/issuer/audience/exp/nonce và Google verified-email policy theo tài liệu chính thức. New Google user phải có email được chấp nhận theo canonical policy; khác policy hiện tại thì fail rõ, không tự đổi normalization.

Email verification mapping: yêu cầu email_verified=true cho new Google account. Chỉ tự ghi emailVerifiedAt khi Google là authority của email (Gmail hoặc Google Workspace có hd theo provider policy); email bên thứ ba giữ null và xác minh bằng OTP WEAV. Explicit linking chỉ được cập nhật verifiedAt khi provider là authority và canonical provider email khớp email local; link Google email khác không thay email hoặc verifiedAt local. Existing provider-sub login không tự overwrite email local. Căn cứ: [Google ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token).

Nếu provider subject chưa được link:
1. Email chưa tồn tại: tạo USER/ACTIVE, passwordHash=null, OAuth account và session trong cùng transaction.
2. Email đã tồn tại: không tự merge/link, không phát session local; trả account-link-required qua handoff an toàn. Người dùng login local (hoặc recovery) rồi explicit link.
3. Link yêu cầu current local password; bind callback intent vào user/session đã reauthenticate, kiểm tra lại khi callback. Không dùng login callback có tham số userId tùy ý.
4. Subject đã thuộc user khác: 409, giữ nguyên cả hai accounts.
5. Unlink yêu cầu password hợp lệ và còn local login; OAuth-only không được xóa phương thức login duy nhất.

M3 giữ V1 uniqueness (provider, provider_user_id); đề xuất tối đa một Google account/user và additive V4 unique (user_id, provider) sau duplicate preflight. Đặt số migration theo HEAD tại lúc implementation nếu V4 đã có.

Không copy Google picture URL vào avatarStorageKey. Có thể dùng displayName của provider theo validation profile; avatar được xử lý trong M5. Không lưu Google access/refresh token vào oauth_accounts.

### 4.4 Admin và avatar

- Admin chỉ list/detail/status; USER/ADMIN không thay thế OWNER/MEMBER. Actor phải ADMIN trong DB tại thời điểm mutation.
- Đề xuất V1 không cho endpoint status sửa account ADMIN (kể cả self): 409; tránh tự khóa hoặc khóa admin cuối. Provision admin qua thao tác vận hành riêng có kiểm soát; không có public promote endpoint.
- Disable update status + revoke toàn bộ session trong một transaction. Enable chỉ đổi status; user login mới.
- Ghi audit event bằng framework logger với actorId/targetId/action/result/correlationId, không email/token/password. Đây là operational log, chưa claim durable compliance audit store.
- Avatar: adapter S3-compatible sau khi có bucket; upload qua server, JPEG/PNG/WebP tối đa 2 MiB, kiểm tra magic bytes/decoder và giới hạn 4096x4096, re-encode để loại metadata; không SVG/remote URL fetch.
- Server sinh key thuộc user, upload mới → commit reference → cleanup key cũ. DB failure dọn key mới; cleanup failure ghi retryable sanitized event và dùng reconciliation task idempotent. Không nhận arbitrary object key từ client.
- GET avatar trả signed URL ngắn hạn (đề xuất 5 phút), no-store. Delete bỏ reference trước, cleanup object sau; không xóa tài nguyên ngoài namespace avatar.

## 5. File map và task implementation

Quy ước path chính xác: `J = services/identity-service/src/main/java/com/weav/identity/`, `T = services/identity-service/src/test/java/com/weav/identity/`, `R = services/identity-service/src/main/resources/`. Các suffix dưới đây nối trực tiếp vào root tương ứng. “Create” là file đề xuất chưa tồn tại.

### Task 0 — Baseline và contract gate (M0)

**Files:** modify `packages/contracts/http/auth/openapi.yaml`, `packages/contracts/http/auth/README.md`, `docs/development/SETUP.md`; đọc core design/log trước.

- [ ] Read git status/HEAD và chạy baseline commands ở mục 6; không lấy 62 pass lịch sử làm kết quả mới.
- [ ] Chốt endpoint/schema/permissions/error examples theo mục 3 và scope người dùng đã xác nhận.
- [ ] Thêm contract theo từng milestone chuẩn bị implement; không publish toàn bộ proposed endpoint như đã hoạt động.
- [ ] Chốt user-first lock protocol bằng focused persistence design, chạy upstream impact cho mọi symbol được sửa. UNKNOWN cần source inspection; HIGH/CRITICAL cần báo trước.
- [ ] Kiểm tra mail/Valkey/Docker availability riêng; không để credentials chưa có làm dừng profile/session work.

### Task 1 — Active identity guard và concurrency foundation (M1)

**Modify:** `J/application/usecase/GetCurrentUserUseCase.java`, `LoginUseCase.java`, `RefreshSessionUseCase.java`, `LogoutUseCase.java`; `J/domain/port/out/UserRepository.java`, `UserSessionRepository.java`; `J/infrastructure/persistence/repository/UserRepositoryAdapter.java`, `SpringDataUserRepository.java`, `UserSessionRepositoryAdapter.java`, `SpringDataUserSessionRepository.java`; `J/infrastructure/config/IdentityApplicationConfig.java`.
**Create:** `J/application/security/CurrentIdentityGuard.java`.
**Tests:** create `T/infrastructure/persistence/AccountMutationConcurrencyIntegrationTest.java`; extend `T/infrastructure/persistence/RefreshConcurrencyIntegrationTest.java` và existing use-case tests.

- [ ] Add failing tests: inactive/revoked session rejected; stale password login cannot issue session after reset; consistent refresh/logout ordering.
- [ ] Run focused test to observe missing behavior, then implement user-first lock/recheck protocol và guard.
- [ ] Prove transaction rollback không trả token; hai concurrent old-token refresh vẫn đúng một winner; logout vẫn idempotent.
- [ ] Document exact lock order and any retry rule; no blind retry on refresh.
- [ ] Pass focused tests + existing CoreAuthHttpIntegrationTest before dependent endpoint writes.

### Task 2 — Profile và session endpoints (M1)

**Modify:** `J/domain/model/User.java`, `J/presentation/http/UserController.java`, repositories từ Task 1; config wiring.
**Create:** `J/application/usecase/UpdateProfileUseCase.java`, `ListSessionsUseCase.java`, `RevokeSessionUseCase.java`, `RevokeAllSessionsUseCase.java`; `J/presentation/http/SessionController.java`; `J/presentation/http/request/UpdateProfileRequest.java`; `J/presentation/http/response/SessionResponse.java`.
**Tests:** create `T/presentation/http/ProfileSessionHttpIntegrationTest.java`.

- [ ] Test profile field allowlist, null/blank/length, stale profile write versus password/status update.
- [ ] Test list pagination, nullable old device metadata, other-user session 404, repeat owned revoke 204, current revoke then /me 401.
- [ ] Implement minimal operations using guard and transaction policy; capture bounded trusted user-agent/remote IP in new login session, no forwarded-header trust by default.
- [ ] Test revoke-all including current; requests linearized after revoke-all may create genuinely new login sessions, old sessions stay revoked.
- [ ] Run HTTP test + core regression and update contract examples.

### Task 3 — Change password (M1)

**Create:** `J/application/usecase/ChangePasswordUseCase.java`, `J/presentation/http/PasswordController.java`, `J/presentation/http/request/ChangePasswordRequest.java`; `T/presentation/http/PasswordChangeHttpIntegrationTest.java`.
**Modify:** `J/domain/model/User.java`, config wiring, `T/presentation/http/SensitivePayloadToStringTest.java`.

- [ ] Test wrong current password, OAuth-only, UTF-8 byte bound, revoked session and role field injection.
- [ ] Implement password reauthentication + guarded password write + revoke-all; use injected Clock for new domain mutation APIs.
- [ ] Verify password change 204, every old refresh 401, old password 401, new login 200.
- [ ] Add concurrent login/profile/reset-style mutation tests in AccountMutationConcurrencyIntegrationTest.

### Task 4 — Email verification state, Valkey and SMTP (M2)

**Create:** `R/db/migration/V3__add_user_email_verified_at.sql`; `J/application/port/out/OtpChallengeStore.java`, `AuthMailSender.java`; `J/infrastructure/authstate/ValkeyOtpChallengeStore.java`; `J/infrastructure/mail/SmtpAuthMailSender.java`; `J/infrastructure/config/OtpProperties.java`, `MailProperties.java`, `J/infrastructure/mail/BoundedAuthMailDispatcher.java`; `T/infrastructure/authstate/OtpChallengeStoreIntegrationTest.java`, `T/infrastructure/mail/SmtpAuthMailSenderIntegrationTest.java`.
**Modify:** `J/domain/model/User.java`, `J/infrastructure/persistence/entity/UserJpaEntity.java`, `J/infrastructure/persistence/mapper/UserPersistenceMapper.java`, `J/application/dto/AuthenticatedUserResult.java`, `J/presentation/http/response/UserResponse.java`, `J/presentation/http/mapper/UserPresentationMapper.java`, `services/identity-service/pom.xml`, main/test configuration and `T/TestcontainersConfiguration.java`.

- [ ] Add migration/round-trip tests: V1/V2 rows remain valid with verifiedAt null; update profile/password does not erase verification.
- [ ] Add SMTP starter managed by existing Boot version; configure timeout/TLS, no mail body debug logs. Test with disposable mail catcher, not real recipient.
- [ ] Add isolated Valkey test container, atomic script tests for attempts/TTL/resend/single-consume across two clients.
- [ ] Add explicit namespaced config and empty secret examples; never edit or copy local .env contents.
- [ ] Preserve core register/login tests: unverified user can still login.

### Task 5 — OTP request/verify và password recovery (M2)

**Create:** `J/application/usecase/RequestOtpUseCase.java`, `VerifyOtpUseCase.java`, `ResetPasswordUseCase.java`; `J/presentation/http/OtpController.java`; `J/presentation/http/request/RequestOtpRequest.java`, `VerifyOtpRequest.java`, `ForgotPasswordRequest.java`, `ResetPasswordRequest.java`; `T/presentation/http/OtpRecoveryHttpIntegrationTest.java`, `T/infrastructure/persistence/PasswordRecoveryConcurrencyIntegrationTest.java`.
**Modify:** PasswordController, config wiring, `J/infrastructure/security/SecurityConfig.java`, throttling and sensitive-payload tests.

- [ ] Test EMAIL_VERIFICATION requires self; caller cannot choose destination or verify another account.
- [ ] Test generic request receipt for missing/local/disabled/OAuth-only users, account and IP limits, malformed body, resend invalidation.
- [ ] Test bounded queue overload and latency under SMTP success/timeout for every account category; SMTP must never block the HTTP response path.
- [ ] Implement forgot-password as facade of RequestOtpUseCase; do not maintain two recovery engines or independent budgets.
- [ ] Test valid OTP, wrong/expired/reused OTP, five failures, simultaneous verification exactly one grant.
- [ ] Test reset purpose binding, expiry, two simultaneous redemption attempts, credential-changed grant rejection, DB failure after consume and mail/Valkey failures.
- [ ] Complete real HTTP → mail catcher → OTP verify → password reset → new login; assert old password and all old sessions rejected.
- [ ] Audit sanitized logs and no-store headers, then full service regression.

### Task 6 — Google persistence và contract preparation (M3)

**Fill existing empty files:** `J/infrastructure/persistence/repository/OAuthAccountRepositoryAdapter.java`, `SpringDataOAuthAccountRepository.java`.
**Modify:** `J/infrastructure/persistence/entity/OAuthAccountJpaEntity.java`, `J/domain/port/out/OAuthAccountRepository.java`.
**Create:** `J/infrastructure/persistence/mapper/OAuthAccountPersistenceMapper.java`, `R/db/migration/V4__unique_user_oauth_provider.sql`; `T/infrastructure/persistence/OAuthAccountPersistenceIntegrationTest.java`.

- [ ] Test state-preserving domain/JPA round trip, ID/timestamps/null provider email, existing provider-sub constraint race.
- [ ] Implement mapping constructor that does not generate new IDs when rehydrating.
- [ ] Preflight duplicate user/provider groups before additive unique migration; no merge/delete to make migration pass.
- [ ] Add owner-scoped list/delete/find operations and test account ownership.
- [ ] Resolve Google client registrations/redirect URLs and M6 handoff transport before Task 7; credentials stay in secret configuration.

### Task 7 — Google OIDC và link/unlink (M3)

**Create:** `J/application/usecase/CompleteGoogleLoginUseCase.java`, `LinkGoogleAccountUseCase.java`, `UnlinkOAuthAccountUseCase.java`; `J/infrastructure/security/oauth/GoogleOidcAdapter.java`, `ValkeyOAuthTransactionStore.java`; `J/presentation/http/OAuthController.java`, `OAuthAccountController.java`; `T/presentation/http/GoogleOAuthHttpIntegrationTest.java`.
**Modify:** POM OAuth2 Client dependency, security configuration, wiring, contract.

- [ ] Pin route mapping, state/cookie binding, nonce, provider PKCE and separate client-handoff verifier behavior in contract tests.
- [ ] Test invalid issuer/audience/signature/nonce/expiry, unknown client/redirect, reused state/code, provider cancellation/timeout and missing email.
- [ ] Implement login session issuance using same locked current-user rules as password login.
- [ ] Test existing-local-email conflict does not create OAuth link/session, explicit password reauthenticated link succeeds, wrong owner conflicts, callback after logout/disable fails.
- [ ] Test new authoritative Google email sets verifiedAt; third-party Google email remains null; different-email linking never verifies local email; exact matching authoritative email linking can verify it.
- [ ] Test concurrent new Google login and local register, duplicate callback/link, last-method unlink prevention.
- [ ] Use provider stub for deterministic protocol tests, then Google test account in real system browser; keep credentials/codes/tokens out of traces.
- [ ] Mark provider acceptance pending until real Google login + callback + /users/me succeeds. Stub success is not provider verification.

### Task 8 — Admin list/detail/status (M4)

**Create:** `J/application/usecase/ListUsersUseCase.java`, `GetUserDetailUseCase.java`, `ChangeUserStatusUseCase.java`; `J/presentation/http/AdminUserController.java`, `J/presentation/http/request/ChangeUserStatusRequest.java`; `T/presentation/http/AdminUserHttpIntegrationTest.java`.
**Modify:** CurrentIdentityGuard, User/reactivate operation, user repository pagination, config/security.

- [ ] Test 401 anonymous/revoked/disabled actor, 403 normal user, current DB role wins over stale ADMIN JWT.
- [ ] Implement parameterized bounded listing and safe detail response, without persistence serialization.
- [ ] Test self/ADMIN target refusal, missing target 404, idempotent same-status update, disable-revoke atomicity, enable does not revive tokens.
- [ ] Test concurrent disable/login/refresh and admin status operations with consistent two-user locking.
- [ ] Seed deterministic local ADMIN fixture; Neon test admin must be an identified test account, not silently modifying a pre-existing user's role.
- [ ] Verify HTTP authorization matrix and audit events with no personal data or token leakage.

### Task 9 — Avatar lifecycle (M5, storage dependency)

**Create:** `J/application/port/out/AvatarStorage.java`, `J/application/usecase/UpdateAvatarUseCase.java`, `DeleteAvatarUseCase.java`; `J/infrastructure/storage/S3AvatarStorage.java`; `J/presentation/http/AvatarController.java`; `T/presentation/http/AvatarHttpIntegrationTest.java`.
**Modify:** User avatar mutation, POM/storage config, contract.

- [ ] Select test bucket/provider and server upload/GET policy; default S3-compatible adapter with disposable compatible storage for deterministic tests.
- [ ] Test size/format/dimensions, empty file, disguised executable, cross-user key, missing avatar and storage outage.
- [ ] Implement upload/replace/delete/reference ordering and idempotent orphan reconciliation.
- [ ] Test DB failure after upload and cleanup failure after commit; previous avatar remains correct under concurrent replace.
- [ ] Verify actual upload and signed URL image retrieval; browser display required at client milestone.

### Task 10 — Neon endpoint smoke và client delivery (M6)

**Files:** update `docs/development/SETUP.md` và work log; create `scripts/identity/endpoint-smoke.ps1` when implementing smoke automation. Gateway/web/mobile file ownership is assigned in a separate integration task after inspecting their then-current source.

- [ ] Run repeatable container tests first; use Neon test Identity DB for acceptance with a unique run ID and recorded test user IDs.
- [ ] Check migration history and V2/V4 duplicate preflight without printing emails or connection strings. Apply only reviewed additive migrations; no Flyway clean.
- [ ] Test register/login/me/profile/sessions/OTP/reset/OAuth/admin endpoints against running service backed by Neon; emails only to controlled test inbox.
- [ ] Clean only records/keys created by this run, with exact IDs and Identity-local ownership; preserve unrelated data and schemas.
- [ ] Define Gateway prefix, trusted proxy addresses, current-session enforcement, secure web cookie/BFF transport + CSRF/CORS, native SecureStore and allowlisted deep links.
- [ ] Web refresh cookie: HttpOnly/Secure with explicit SameSite/path policy; JS never receives persisted refresh token. Native gets JSON token response under registered native transport.
- [ ] Playwright verifies real web register/login/profile/recovery/logout, Google redirect where automation permitted, denied USER admin access and ADMIN disable/enable. Native uses unit/integration plus manual provider smoke unless a native E2E harness exists.
- [ ] Revoke/reset/disable guarantee across Gateway/downstream must be demonstrated; offline JWT verification alone cannot satisfy immediate revocation.

## 6. Commands và acceptance matrix

Chạy từ `services/identity-service` (commands hiện có đã xác nhận từ wrapper/test layout):

```powershell
$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=IdentityCleanArchitectureTest,RegisterUserUseCaseTest,LoginUseCaseTest,RefreshSessionUseCaseTest,LogoutUseCaseTest,GetCurrentUserUseCaseTest,TokenServiceTest,SecurityConfigTest' test
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=UserPersistenceIntegrationTest,UserSessionPersistenceIntegrationTest,RefreshConcurrencyIntegrationTest,CoreAuthHttpIntegrationTest' test
.\mvnw.cmd -B '-Dstyle.color=never' test
.\mvnw.cmd -B '-Dstyle.color=never' -DskipTests package
```

Task-specific test command sau khi tạo test, ví dụ:

```powershell
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=ProfileSessionHttpIntegrationTest,PasswordChangeHttpIntegrationTest,AccountMutationConcurrencyIntegrationTest' test
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=OtpChallengeStoreIntegrationTest,SmtpAuthMailSenderIntegrationTest,OtpRecoveryHttpIntegrationTest,PasswordRecoveryConcurrencyIntegrationTest' test
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=OAuthAccountPersistenceIntegrationTest,GoogleOAuthHttpIntegrationTest,AdminUserHttpIntegrationTest' test
```

Expected: BUILD SUCCESS, 0 failures/errors/skipped for selected suites; tests use actual DB/Valkey/mail dependencies, deterministic Clock and concurrency synchronization, not sleeps. Missing Docker/dependency means that gate is blocked, not passed.

Repository root:

```powershell
docker compose -f compose.yml -f compose.dev.yml config --quiet
git diff --check
node .gitnexus/run.cjs detect-changes --scope all --repo .
```

Run detect-changes before any implementation commit, and resolve partial/truncated results before calling graph review clean. This planning session creates no commit. Future commits should contain complete tested milestones and exclude unrelated files/secrets.

| Gate | Evidence required |
| --- | --- |
| M1 | Real HTTP profile/session/password + original core tests + DB concurrency |
| M2 | V1→latest migration, real Valkey atomics, captured SMTP message, full recovery sequence |
| M3 | Persistence uniqueness races, protocol tests, actual Google callback/handoff/login |
| M4 | Real HTTP USER/ADMIN/disabled/revoked authorization and disable/enable semantics |
| M5 | Real storage upload/read/delete and failure cleanup |
| M6 | Neon smoke receipts + controlled fixture cleanup + actual authenticated browser/native evidence |

HTTP acceptance examples (test assertions, not operations performed in this session):

```text
A registers and logs in twice -> sid1, sid2
PATCH /users/me {"displayName":"Kai"} with sid1 -> 200
POST /auth/change-password with correct old password -> 204
GET /users/me with sid1 or sid2 -> 401
POST /auth/login with old password -> 401; new password -> 200

POST /auth/forgot-password for test mailbox -> 202
read actual mail catcher message -> OTP
POST /auth/otp/verify -> resetToken; repeat same OTP -> 400
POST /auth/reset-password -> 204; repeat resetToken -> 400
old password/refresh fail; login with replacement password succeeds

USER GET /admin/users -> 403
ADMIN PATCH /admin/users/{testUser}/status {"status":"DISABLED"} -> 200
testUser login/refresh/protected Identity calls -> 401
ADMIN enable -> 200; testUser old refresh still 401; fresh login -> 200
```

## 7. Review gates, dependencies và handoff

- M0/M1 có thể triển khai trước khi có Google credentials/storage. SMTP catcher đáp ứng development/testing; provider inbox delivery là gate riêng khi cấu hình SMTP thật.
- Các thông tin cần có đúng lúc: Google test client IDs/secret trong secret store, authorized callback URLs, web/mobile return target IDs; avatar test bucket; controlled Neon test inbox và ADMIN fixture.
- Đã có quyền dùng Neon test theo yêu cầu hiện tại. Không ghi secret vào tài liệu/chat và không xin người dùng paste credentials.
- Upstream impact trong session này: User và GetCurrentUserUseCase trả UNKNOWN, 0 resolved callers/processes và partial=true. Đây không phải low risk. Source inspection xác nhận consumers ở application use cases, UserController, IdentityApplicationConfig, mapper/repository và tests.
- GitNexus index Weav khớp HEAD nhưng query FTS bị lỗi dependency Windows; context trả lower-bound. Chạy lại impact cho từng existing symbol tại implementation; không lấy kết quả plan làm giấy phép sửa.
- Điều tra song song chỉ đọc: agent inventory kiểm tra code; coordinator đối chiếu Notion/chương 3 và viết tài liệu. Không có concurrent code writes.
- Khi implement song song, coordinator sở hữu User/repository/security/config/shared contract; worker sở hữu bộ use-case/controller/test được giao. Tách worktree cho thay đổi lớn và merge sau review; không giao hai worker sửa cùng file.
- Mỗi task: failing behavior test → minimal implementation → focused test → review → milestone full/runtime checks → cập nhật log. Không tự chạy implementation trong session chỉ yêu cầu plan.

## 8. Sources

- [Core auth work log](../../work_logs/2026-09-05-identity-core-auth.md)
- [Core auth design](../specs/2026-09-05-identity-core-auth-design.md)
- [Readiness history](../../work_logs/2026-09-05-identity-readiness.md)
- [Current auth contract](../../../packages/contracts/http/auth/README.md)
- [Google Docs thesis — chỉ đến hết chương 3](https://docs.google.com/document/d/15b2BPSs9HFyN2Ki3spTWXw6To7_QpmWiAKm58qek5cA/edit?tab=t.0)
- [Notion Identity schema](https://app.notion.com/p/3bd8722217d580b7b5d3c26e86ffaab3)
- [Notion class ownership](https://app.notion.com/p/3cd8722217d58188a279e4aed16b657e)
- [Notion intended Identity stack](https://app.notion.com/p/3bf8722217d580679395c56c0c1ec82a)
- [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) — provider subject identity, token validation, state/nonce and redirect registration.
- [Spring Security OAuth2 Login](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/core.html) — framework adapter and client configuration.
- [OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html) — generic responses, expiring one-use recovery credentials, rate limits and session invalidation. Numeric limits and transaction tradeoffs in this plan are project proposals.
