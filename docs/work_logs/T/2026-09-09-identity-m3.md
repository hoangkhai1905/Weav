# Nhật ký Identity M3 - Task6 persistence

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-09` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav / Identity Service` |
| Nhánh / commit đầu ngày | `codex/identity-m3` / `2e05420` |
| Người thực hiện | `Identity M3 worker` |
| Người review / nhận bàn giao | `root / Identity owner` |
| Trạng thái cuối ngày | `Đang tiếp tục - Task6 đã được root review chấp thuận; Task7 design-only chờ mở implementation` |
| Phạm vi session | Task6 OAuth persistence port/adapter/entity/mapper, V4 additive uniqueness migration, PostgreSQL integration tests; Task7 Google OIDC/web handoff contract design-only |

## 2. Tóm tắt điều hành

### Kết quả chính

- Hoàn thiện OAuth repository port/adapter và Spring Data repository với find/list/delete theo `user_id`; delete lọc owner ngay trong câu lệnh SQL để tránh TOCTOU.
- Mapper rehydrate đầy đủ ID, owner, provider data, nullable provider email và timestamps; `@PreUpdate` không ghi đè timestamp domain đã cung cấp.
- Thêm V4 preflight uniqueness cho `(user_id, provider)`; duplicate hiện hữu làm migration fail nguyên tử, không merge/delete dữ liệu.
- Root đã review/chấp thuận bounded Task6 code và bằng chứng focused/full regression; graph vẫn được ghi là lower-bound/high, không claim clean.
- Viết design-only Task7 dưới `docs/superpowers/plans/2026-09-09-identity-m3-google.md`: route/schema draft, provider/state/nonce/PKCE/handoff, explicit link/unlink, web cookie/CSRF/CORS, ownership, tests và real Google smoke gate.
- Task7 transport/OAuth provider callback chưa triển khai; không thêm live OpenAPI hoặc dependency.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | `mvnw.cmd -B -Dstyle.color=never -DskipTests compile` |
| Unit / integration test | `PASS` | Focused 7/7; full Identity 136/136 |
| Migration / database | `PASS` | Testcontainers PostgreSQL; Flyway V1-V4; duplicate preflight rollback verified |
| Review thay đổi | `Đã kiểm tra` | `git diff --check` sạch; GitNexus impact đã chạy trước sửa |
| Commit / PR | `Chưa tạo` | Theo yêu cầu; worktree giữ thay đổi chưa commit |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- `services/identity-service`: OAuth domain output port, Spring Data adapter/repository, JPA entity/mapper, additive V4 migration và persistence integration tests.
- Focused work log này.

### Ngoài phạm vi / chủ động chưa làm

- Không triển khai Task7 endpoint, OAuth client, state/PKCE, callback/redirect, cookie/token transport, gateway/BFF hoặc mobile flow.
- Không sửa User/core config, không cài dependency, không đọc secret/`.env`, không mutate Neon, không commit/push.

### Tiêu chí hoàn thành

- [x] Round-trip giữ ID, created/updated timestamps và nullable provider email.
- [x] Owner-scoped find/list/delete; concurrent uniqueness cho provider-sub và user/provider.
- [x] Migration từ chối duplicate hiện hữu mà không xóa/merge rows và không ghi nhận migration thành công.
- [x] Migration V3 -> V4 với rows hợp lệ giữ nguyên dữ liệu và giữ cả constraint V1/V4.
- [x] Public provider-sub lookup có exact hit/miss và case-sensitive subject coverage.
- [x] Focused PostgreSQL integration, full Identity regression và package build pass.

## 4. Bối cảnh và quyết định

- OAuth persistence scaffold tồn tại nhưng port/adapter/Spring Data repository còn trống; V1 provider-sub uniqueness và user FK cascade được giữ nguyên.
- V4 chỉ bổ sung `uk_oauth_account_user_provider` sau preflight `GROUP BY user_id, provider`; lỗi preflight nằm trong transaction Flyway nên giữ nguyên rows/schema history.
- Handoff Task7 đã thống nhất ở mức quyết định: web-first; Identity dự kiến phát HttpOnly/Secure refresh cookie, trả access token ngắn hạn trong response/memory, callback chỉ handoff; callback cục bộ đề xuất `http://localhost:8081/auth/oauth/google/callback`, web return đề xuất `http://localhost:5173/auth/callback`, đều configurable. Đây là quyết định bàn giao, chưa phải endpoint đã triển khai.

## 5. Thay đổi đã thực hiện

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/domain/port/out/OAuthAccountRepository.java` | Thêm owner-scoped find/list/delete contract |
| Sửa | `.../infrastructure/persistence/entity/OAuthAccountJpaEntity.java` | Giữ V1 unique, thêm user/provider unique; constructor rehydrate; giữ domain `updatedAt` qua `@PreUpdate` |
| Thêm | `.../infrastructure/persistence/mapper/OAuthAccountPersistenceMapper.java` | Mapping hai chiều không tạo ID/timestamp mới |
| Thêm | `.../infrastructure/persistence/repository/OAuthAccountRepositoryAdapter.java` | Save/find/list/owner delete và map constraint conflict |
| Thêm | `.../infrastructure/persistence/repository/SpringDataOAuthAccountRepository.java` | Derived owner queries và direct owner-filtered delete |
| Thêm | `services/identity-service/src/main/resources/db/migration/V4__unique_user_oauth_provider.sql` | Duplicate preflight rồi additive unique constraint |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/persistence/OAuthAccountPersistenceIntegrationTest.java` | 7 PostgreSQL integration tests |

## 6. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế |
| --- | --- | --- |
| Compile | `mvnw.cmd -B -Dstyle.color=never -DskipTests compile` với timezone UTC | `BUILD SUCCESS` |
| Focused persistence | `mvnw.cmd -B -Dstyle.color=never -Dtest=OAuthAccountPersistenceIntegrationTest test` | `Tests run: 7, Failures: 0, Errors: 0, Skipped: 0` trên Docker PostgreSQL |
| Full Identity | `mvnw.cmd -B -Dstyle.color=never test` | `Tests run: 136, Failures: 0, Errors: 0, Skipped: 0` |
| Package | `mvnw.cmd -B -Dstyle.color=never -DskipTests package` | `BUILD SUCCESS` |
| Diff | `git diff --check` | PASS |

Focused tests chứng minh: rehydrate ID/timestamps/null email; update timestamp deterministic ở microsecond không bị `@PreUpdate` ghi đè; public provider-sub lookup exact hit/miss/case-sensitive; owner không thể đọc/xóa account của user khác; mỗi race uniqueness chỉ có một winner; V4 duplicate preflight giữ hai rows, giữ Flyway history ở V3 và không tạo constraint mới; V3 -> V4 với rows hợp lệ giữ nguyên IDs, owners, subjects, email nullable, timestamps và cả V1/V4 constraints.

## 7. GitNexus / rủi ro

- GitNexus `list_repos` đã bind đúng checkout và `analyze --index-only --name Weav-identity-m3 T:\Weav\tmp\identity-m3-worktree` thành công: 4,804 nodes, 10,100 edges, 201 clusters, 248 flows, base `2e05420`.
- Pre-edit impact của `OAuthAccountPersistenceIntegrationTest` trên base trả `UNKNOWN`/không caller vì test class mới chưa có trong index; targeted `rg` xác nhận class/method chỉ xuất hiện trong file test. Sau index, impact vẫn `UNKNOWN`/`partial: true` với cùng lý do; không được đọc là an toàn tuyệt đối.
- Worktree-scoped `detect_changes(scope=all, repo=Weav-identity-m3, worktree=...)` đầy đủ sau khi tạm stage đúng 4 file untracked rồi unstage: `changed_files=8`, `changed_count=70`, `affected_count=12`, `risk_level=high`, không có `partial`/`truncated`. Lần chạy chỉ unstaged thấy 4 tracked files; không dùng canonical zero làm bằng chứng.
- Analyzer ghi nhận giới hạn riêng: 22 Java package siblings thiếu package facts; cross-language field links bị bỏ; process ranking thiếu 58 entry points và 374 callees. Đây là giới hạn graph, không phải bằng chứng không có callers.
- Adapter direct delete yêu cầu caller có transaction; Task7 use case phải đặt transaction boundary phù hợp.
- Test đã chạy Docker PostgreSQL, chưa xác minh Neon/provider registration/callback thật.

## 8. Trạng thái bàn giao

### Root review checklist

1. Review `OAuthAccountJpaEntity` timestamp lifecycle và V1/V4 constraint names.
2. Review `OAuthAccountRepositoryAdapter` constraint-to-`ConflictException` mapping và transaction boundary của owner delete.
3. Review V4 failure semantics: no row deletion/merge, Flyway history remains V3 on duplicate fixture.
4. Review HIGH graph verdict (`22` production/test symbols and `12` affected flows; full 8-file diff includes worklog sections), then run/confirm the same worktree-scoped `detect_changes` before any commit; do not start Task7 until persistence diff is approved.

### Việc tiếp theo (Task7, chưa làm)

- Root review design `docs/superpowers/plans/2026-09-09-identity-m3-google.md`, giữ quyết định route web refresh/logout riêng, local HTTPS/browser verification cho `Secure`, registered allowlists và Workspace authority.
- Khi được mở scope, chạy fresh GitNexus impact trước từng existing-symbol edit rồi triển khai từng slice; không expose persisted refresh tokens to JavaScript.

## 10. Session 2 — Task7 contract/design preparation (2026-09-09)

### Mục tiêu và phạm vi

- Đọc lại approved plan 2026-09-06 (mục 4.3, Task7, M6), source auth/security/session/OTP hiện tại và auth contract.
- Xác minh hành vi Google OIDC và Spring OAuth2 Client bằng tài liệu chính thức trước khi chốt design.
- Chỉ tạo design/worklog; không sửa source/config/POM/migration/OpenAPI, không đọc `.env`/secret và không chạy provider thật.

### Quyết định ghi vào design

- Web-first: Identity dùng `POST /auth/oauth/google/start`, provider-only callback `/auth/oauth/google/callback`, one-use `POST /auth/oauth/exchange`, và các route cookie riêng `/auth/web/refresh`/`/auth/web/logout` để bảo toàn JSON `/auth/refresh`/`/auth/logout` hiện tại.
- Callback chỉ redirect handoff code + opaque transaction ID về registered `http://localhost:5173/auth/callback` mặc định; proposed provider callback là `http://localhost:8081/auth/oauth/google/callback`; cả hai configurable và chưa được claim live.
- Backend provider PKCE verifier và client handoff PKCE verifier là hai giá trị độc lập. State/nonce transaction TTL đề xuất 10 phút; handoff consume atomically, TTL đề xuất 60 giây.
- Refresh cookie web là host-only `__Secure-weav_refresh`, `HttpOnly; Secure; SameSite=Lax; Path=/auth`; access token chỉ có trong exchange/refresh response và memory. Correlation cookie giữ `Path=/auth`; XSRF cookie/header dùng `Path=/` để tới cả `/auth` và `/users/me/oauth-*`; start/`GET /auth/web/csrf` trả non-secret CSRF value để web origin không cần đọc host-only Identity cookie; không giữ blanket CSRF disable cho web.
- Link bind vào current user/session + credential fingerprint sau password reauth; provider subject races, email authority, disabled/revoked callback và unlink-last-method được nêu thành acceptance cases.
- Không ghi Google client ID/secret, production URL, Workspace domain hay token vào tài liệu/log.

### Nguồn chính đã kiểm tra

- Google OIDC API reference: `https://developers.google.com/identity/openid-connect/reference` — `sub` ổn định/case-sensitive, email không phải primary key, `iss`/`aud`/`exp`/`nonce`/`email_verified`/`hd`.
- Google OAuth web-server guide: `https://developers.google.com/identity/protocols/oauth2/web-server` — exact redirect URI, state/CSRF, local redirect registration và redirect-away khỏi URL chứa provider code.
- Spring OAuth2 authorization grants: `https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorization-grants.html` — authorization-code/PKCE và redirect URI config.
- Spring OAuth2 Login advanced: `https://docs.spring.io/spring-security/reference/servlet/oauth2/login/advanced.html` — default/custom authorization và callback base URI phải khớp `ClientRegistration.redirectUri`.
- Spring CSRF/CORS: `https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html`, `https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html` — cookie/header token, route protection và explicit origins/preflight.
- OIDC Core và RFC 7636: `https://openid.net/specs/openid-connect-core-1_0.html`, `https://datatracker.ietf.org/doc/html/rfc7636` — nonce replay/signature validation và S256 verifier rules.

### Kiểm tra session 2

| Hạng mục | Kết quả | Giới hạn |
| --- | --- | --- |
| Source/plan review | `PASS` | Chỉ đọc, không xác minh provider credentials/runtime callback |
| Official documentation review | `PASS` | Tài liệu là căn cứ protocol, không chứng minh custom adapter đã chạy |
| OAuth implementation tests | `Chưa chạy` | Chưa có production OAuth code theo đúng scope |
| Real Google system-browser smoke | `Chưa chạy / pending config` | Chưa có registered test client/secret; phải chạy ở implementation/provider gate |
| OpenAPI | `Không sửa` | Design route/schema chưa phải live contract |
| Secrets | `Không đọc` | Chỉ ghi tên config/allowlist, không ghi giá trị |

### Blocker và bàn giao cho root

1. Root cần review final local HTTPS/browser strategy để chứng minh `Secure`, Google test registration/allowlists và optional Workspace product restriction; separate web refresh/logout routes are selected.
2. `apps/web` chưa có auth callback; real system-browser smoke phải dùng harness tạm và không được gọi là M6 client integration.
3. `pom.xml` chưa có OAuth2 Client; dependency/custom Spring callback wiring chỉ mở sau design review + fresh impact.
4. Task7 chưa bắt đầu. Worker dừng ở design-only theo yêu cầu, chờ root mở implementation slice.

## 11. Kết thúc session 2

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Có thay đổi Task6 chưa commit và thêm plan/worklog Task7 chưa commit; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `docs/superpowers/plans/2026-09-09-identity-m3-google.md`, approved Task7/M6 plan, source auth/security/session/OTP, Task6 review evidence |

## 9. Kết thúc session 1

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09 15:32 Asia/Saigon` |
| Trạng thái worktree | `Có thay đổi chưa commit trên codex/identity-m3; không có commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `Plan Task6/Task7, file này, persistence diff và root review checklist` |

## 12. Session 3 — Task7 root-review contract corrections (2026-09-09)

### Phạm vi và thay đổi tài liệu

Root review yêu cầu chỉ sửa contradiction trong design/worklog, chưa mở production coding. Đã cập nhật `docs/superpowers/plans/2026-09-09-identity-m3-google.md` để:

- Tách cookie path rõ ràng: refresh/correlation `Path=/auth`; non-secret `XSRF-TOKEN` `Path=/` để gửi được tới `/users/me/oauth/google/link` và `/users/me/oauth-accounts/*`.
- Tách LOGIN/LINK handoff exchange bằng JSON `outcome`: LOGIN tạo session + access-only response + refresh cookie; LINK trả linked metadata, không tạo session/cookie. Callback và exchange đều recheck session/fingerprint; logout/revoke/password-change/disable giữa hai bước làm link intent thất bại an toàn.
- Khôi phục route đã được duyệt: `GET /users/me/oauth-accounts` metadata an toàn và `DELETE /users/me/oauth-accounts/{accountId}` với JSON current password; không trả provider subject/token.
- Ghi bounds RFC 7636 chính xác: challenge đúng 43 unpadded base64url; verifier 43–128 unreserved ASCII; tách provider/client verifier và client secret; thêm TTL/rate/attempt bounds hữu hạn.
- Làm rõ state/nonce/provider challenge xuất hiện ở authorization URL và provider code/state ở inbound callback theo protocol; không log hoặc đưa vào final app URL. State/handoff atomic validate-then-consume không làm mất unrelated valid handoff; cancellation chỉ redirect sau state+cookie binding hợp lệ.
- Sửa email authority: `email_verified=true` + signed Google `hd` đủ cho Workspace authority; hosted-domain allowlist chỉ là product restriction tùy chọn, không phải release blocker.
- Giữ exact `ApiErrorResponse` envelope và bổ sung bảng status/code mapping (`ACCOUNT_LINK_REQUIRED`, `OAUTH_HANDOFF_INVALID`, conflicts, rate/dependency errors) mà không tạo outer response format mới.
- Không khẳng định tuyệt đối Secure-cookie HTTP localhost; acceptance dùng local HTTPS deterministic hoặc browser-specific verified behavior. TLS/provider config là real-smoke gate, không chặn Slice A.

### Kiểm tra session 3

| Hạng mục | Kết quả | Giới hạn |
| --- | --- | --- |
| Plan/worklog correction | `PASS` | Documentation-only; chưa sửa source/config/OpenAPI |
| `git diff --check` | `PASS` | Tracked diff clean; không commit/push |
| OAuth tests/build | `Chưa chạy` | Task7 production code chưa được mở |
| Real Google browser | `Pending` | Chưa có registered client/secret; chỉ chạy ở provider gate |

### Bàn giao

- Root review lại plan đã chỉnh trước khi mở Slice A (ports/config). Không chạy implementation, dependency install, migration, OpenAPI hoặc provider smoke trong session này.
- Task6 code/test/graph evidence giữ nguyên; design corrections không thay đổi source Task6.

## 13. Kết thúc session 3

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Có thay đổi Task6 chưa commit và plan/worklog Task7 đã chỉnh; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `docs/superpowers/plans/2026-09-09-identity-m3-google.md`, root review corrections, approved Task7/M6 plan |

## 14. Session 4 — Task7 Slice A ports/config (2026-09-09)

### Phạm vi đã được root mở

- Chỉ triển khai Slice A: application OAuth DTO/value contracts, `OAuthTransactionStore` và `OAuthProviderClient` ports, registered-client/config validation và focused tests. Không triển khai provider adapter, Valkey store, account use cases, controller/OpenAPI, browser route, dependency mới hoặc migration mới.
- Giữ raw client PKCE verifier ở browser; exchange nhận verifier một lần và backend transaction chỉ giữ challenge. LOGIN tạo đúng một session; web refresh xoay refresh token của session hiện hữu. Unlink kiểm tra last-login-method trước khi từ chối local password để OAuth-only account nhận `409 OAUTH_LAST_LOGIN_METHOD`. Provider slice về sau bắt buộc `azp` khi `aud` có nhiều giá trị; không triển khai kiểm tra claim trong Slice A.

### File ownership

| Nhóm | Files |
| --- | --- |
| Application contracts | `services/identity-service/src/main/java/com/weav/identity/application/dto/OAuthSecret.java`, `OAuthClientRegistration.java`, `OAuthConfiguration.java`, `OAuthStartCommand.java`, `OAuthExchangeCommand.java`, `application/validation/OAuthProtocolPolicy.java`, `OAuthUriPolicy.java`, `application/port/out/OAuthProviderClient.java`, `OAuthTransactionStore.java` |
| Configuration | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/OAuthProperties.java`, `OAuthApplicationConfig.java` |
| Focused tests | `services/identity-service/src/test/java/com/weav/identity/application/validation/OAuthProtocolPolicyTest.java`, `OAuthUriPolicyTest.java`, `application/port/out/OAuthContractTest.java`, `infrastructure/config/OAuthPropertiesTest.java` |
| Design handoff | `docs/superpowers/plans/2026-09-09-identity-m3-google.md`, this worklog |

Configuration is disabled safely when Google/web values are absent. Partial or malformed enabled configuration fails closed; validation rejects wildcard/userinfo/fragment/unsafe URLs, inconsistent return/origin targets and invalid PKCE bounds. Secret-bearing values have redacted `toString`/DTO representations. The provider boundary is framework-free and separates backend provider PKCE from browser handoff PKCE; transaction-store contracts specify atomic binding validation/consume outcomes and bounded proof failures.

### Verification

| Check | Result | Evidence/limit |
| --- | --- | --- |
| GitNexus pre-edit impact | `PASS; UNKNOWN corroborated` | Worktree `T:\Weav\tmp\identity-m3-worktree`, repo `Weav-identity-m3`; `IdentityApplicationConfig` was not edited. Impact returned `UNKNOWN`, zero resolvable callers; targeted source inspection confirmed Spring component scanning from `IdentityServiceApplication`. No HIGH/CRITICAL result. |
| Slice A focused Maven tests | `PASS: 16 tests, 0 failures, 0 errors, 0 skipped` | Cached Maven 3.9.16 command with `-Dtest=OAuthProtocolPolicyTest,OAuthPropertiesTest,OAuthContractTest test` and `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`; no dependency install. |
| Full Identity Maven regression | `PASS: 152 tests, 0 failures, 0 errors, 0 skipped` | Cached Maven 3.9.16 `test` command with `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`; Docker-backed PostgreSQL/Valkey/Mailpit integration; `BUILD SUCCESS`, 1:54. Existing expected dependency-reconnect warning did not fail tests. |
| `git diff --check` | `PASS` | Tracked diff has no whitespace errors; untracked Slice A files were compiled and exercised by the focused/full suites. |
| Real Google/browser/provider smoke | `Pending` | No credentials or registered client were read; provider and transport slices are not implemented. |

### Handoff and limits

- No commit/push, secret/.env read, Neon mutation, external CLI, dependency install, live OpenAPI claim or Task7 Slice B work was performed. GitNexus change detection was not needed for a commit because this worker created no commit; root should review the uncommitted diff and run its preferred worktree-scoped change analysis before staging.
- Remaining implementation gates are the reviewed provider/Valkey/store wiring, account/session use cases, HTTP web transport and the separately recorded real Google system-browser gate. This Slice A proves only framework-free contracts and configuration validation, not runtime OAuth capability.

## 15. Kết thúc session 4

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Slice A và Task6 chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `docs/superpowers/plans/2026-09-09-identity-m3-google.md`, Slice A files/tests, root review checklist |

## 16. Session 5 — Root review corrections for Slice A (2026-09-09)

### Findings addressed

- Root review identified that the first `OAuthTransactionStore.Handoff` shape carried only local LINK bindings and the client challenge, so final LOGIN/LINK exchange could not access the validated Google subject/email authority after callback. `Handoff` now requires a server-only immutable `OAuthProviderClient.ProviderIdentity` for both intents; no provider tokens are carried. `ProviderIdentity` includes provider, bounded case-sensitive subject (1..255 printable ASCII), optional bounded email/hosted domain and email-verification status. Contract tests cover identity retention/redaction for LOGIN and LINK and reject incomplete identity/outcomes.
- `Secure` is now mandatory in `OAuthConfiguration.CookiePolicy` and `OAuthProperties`; `cookie-secure=false` is rejected even for loopback HTTP and cannot bypass validation while OAuth is otherwise disabled. No cookie renaming or weaker mode is introduced.
- `OAuthUriPolicy` now strips brackets before matching IPv6 loopback and omits only default HTTP/HTTPS ports when serializing browser origins. Nondefault ports remain exact. Tests cover `[::1]`, nonloopback IPv6 rejection, default port canonicalization, loopback port 80 and nondefault mismatch.

### GitNexus gate

- Rebound and refreshed `Weav-identity-m3` at `T:\Weav\tmp\identity-m3-worktree`; the final index includes the corrected Slice A files (`5,064` nodes / `10,638` edges / `256` flows). Impact on `OAuthProperties`, `OAuthConfiguration` and `OAuthUriPolicy` returned `UNKNOWN`, `partial=true`, lower-bound with no resolved callers; `OAuthTransactionStore` remained unresolvable as an interface symbol. Targeted source search found only the expected configuration/contract test references. No HIGH/CRITICAL verdict was returned; the graph limitations remain recorded rather than treated as clean.

### Verification so far

| Check | Result | Evidence/limit |
| --- | --- | --- |
| Focused OAuth suite | `PASS: 21 tests, 0 failures, 0 errors, 0 skipped` | Cached Maven 3.9.16, UTC; `OAuthProtocolPolicyTest`, `OAuthPropertiesTest`, `OAuthContractTest`, `OAuthUriPolicyTest`. |
| Full Identity regression | `PASS: 157 tests, 0 failures, 0 errors, 0 skipped` | Cached Maven 3.9.16 `test`, UTC; Docker-backed PostgreSQL/Valkey/Mailpit; `BUILD SUCCESS`, 1:49. Expected asserted migration/dependency-failure warnings did not fail tests. |
| `git diff --check` | `PASS` | Final tracked diff has no whitespace errors; untracked files were compiled and exercised by both suites. |
| Commit/push | `Not performed` | Preserve Task6 and Slice A WIP for root review. |

### Remaining bounded gate

No Slice B/provider/Valkey/account/HTTP implementation was started. Code corrections and full regression are complete; only root’s final review/acceptance remains.

## 17. Session 6 — Slice B1 Valkey OAuth transaction store (2026-09-09)

### Phạm vi đã được root mở

- Root đã chấp nhận Slice A foundation và mở riêng Slice B1: adapter Valkey cho `OAuthTransactionStore` cùng integration test trên Docker Valkey. Không triển khai Google provider adapter, account/session use case, controller/route/OpenAPI, OAuth dependency mới hoặc Slice B2.
- Giữ client PKCE verifier ở browser; transaction server chỉ lưu provider verifier ngắn hạn và handoff code challenge. Handoff lưu provider identity đã validate (provider/subject/email authority/issuedAt), không lưu provider access/refresh token.

### Thay đổi B1

- `ValkeyOAuthTransactionStore` dùng key namespace `oauth:tx:*` và `oauth:handoff:*`, Redis hash encoding URL-safe Base64 và TTL hữu hạn theo `OAuthConfiguration`.
- Lua thực hiện atomic collision check/create (`EXISTS` + `HSET` + `EXPIRE`), callback compare-before-consume và handoff compare tất cả binding fields + challenge trước khi consume. Mismatch chỉ tăng counter trên đúng handoff key; đạt ngưỡng thì xóa đúng key. Key lạ, replay và expiry đều trả `NOT_FOUND` theo chính sách physical deletion, không tạo tombstone vô hạn.
- Redis/runtime/corrupt-data failure bị map về `DependencyUnavailableException` thông điệp cố định; không log hoặc đưa secret/verifier/provider token vào exception/toString. Spring bean chỉ được tạo khi có `StringRedisTemplate` và Google client-id; OAuth disabled mặc định không làm hỏng core-auth startup.
- `ProviderIdentity` follow-through: subject toàn khoảng trắng bị từ chối; subject-only với `emailVerified=true` và email null được phép theo policy, không áp đặt account policy trong store. Port Javadoc ghi rõ status subset khi adapter xóa vật lý.

### File ownership B1

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStore.java` | Valkey adapter, Lua atomic lifecycle, TTL/collision/failure handling và sanitized failure mapping |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreIntegrationTest.java` | 8 integration tests với disposable Docker Valkey |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/port/out/OAuthProviderClient.java` | Provider identity subject invariant và email-null policy |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/port/out/OAuthTransactionStore.java` | Status semantics cho physical deletion |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/application/port/out/OAuthContractTest.java` | Subject-only acceptance và all-space rejection |

### Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác | Kết quả thực tế |
| --- | --- | --- |
| Focused B1 | Cached Maven 3.9.16, `-Duser.timezone=UTC -Dtest=OAuthContractTest,ValkeyOAuthTransactionStoreIntegrationTest test` với Docker Valkey thật | `Tests run: 12, Failures: 0, Errors: 0, Skipped: 0`; collision, TTL, identity round-trip, wrong callback/cookie preservation, each binding mismatch, exact failure threshold, unrelated key, replay and 8-way concurrent single-winner đều PASS |
| Disabled wiring smoke | Cached Maven `-Duser.timezone=UTC -Dtest=IdentityServiceApplicationTests,OAuthPropertiesTest test` với Docker PostgreSQL | `Tests run: 14, Failures: 0, Errors: 0, Skipped: 0`; full context starts with OAuth disabled and the conditional Valkey bean does not break core auth |
| Full Identity regression | Cached Maven 3.9.16, `-Duser.timezone=UTC test` với Docker PostgreSQL/Valkey/Mailpit | `Tests run: 166, Failures: 0, Errors: 0, Skipped: 0`; `BUILD SUCCESS` (02:05). Expected asserted dependency-reconnect warnings did not fail tests |
| Whitespace/diff | `git diff --check` plus targeted trailing-whitespace scan over new/changed B1 files | PASS; no trailing whitespace |

### GitNexus gate and limits

- Before B1 edits, repo `Weav-identity-m3` was bound to `T:\Weav\tmp\identity-m3-worktree`; index snapshot was `5,064 nodes / 10,638 edges / 256 flows`. Impacts for the new/unindexed OAuth ports and existing `ValkeyOtpChallengeStore`/configuration symbols were `UNKNOWN` (some `partial=true`, lower-bound, zero resolvable callers); targeted source search corroborated the expected test/config references. No HIGH/CRITICAL result was returned, so no pre-edit warning was required.
- New B1 adapter/test symbols remain untracked and were not represented in that pre-edit graph snapshot. No post-edit reindex or `detect_changes` was run because this worker did not commit; root must review the complete uncommitted worktree and run its own worktree-scoped graph check before staging. The known package-fact/cross-language/process lower-bound warnings remain applicable; UNKNOWN is not treated as “unused”.

### Trạng thái bàn giao

- B1 is implemented and tested; no commit/push, secret/.env read, dependency install, Neon mutation or external worker was used. Docker-backed tests were run with escalation only because the sandbox could not access the Docker named pipe.
- B2 remains blocked by scope: Google OIDC/provider HTTP adapter, real provider registration/system-browser smoke, account mutation policy, and web transport/routes are not implemented. Root should review the adapter’s conditional wiring, Lua field/binding order, physical-deletion status semantics, and the absence of provider tokens before opening B2.

## 18. Kết thúc session 6

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09 19:30 Asia/Saigon` |
| Trạng thái worktree | `Có thay đổi Task6, Slice A và B1 chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `ValkeyOAuthTransactionStore.java`, B1 integration test, approved Task7 Google plan, root review checklist |

## 19. Session 7 — B1 bounded correction and wiring proof (2026-09-09)

### Phạm vi correction

- Root review mở đúng một correction pass cho B1; không bắt đầu Google provider/B2, account use case, HTTP route hoặc OpenAPI.
- Bổ sung kiểm thử độc lập cho mọi handoff binding (fingerprint, transaction id, intent, client id, return target id và code challenge), callback state/correlation mismatch riêng, callback replay và concurrent callback one-winner. Mỗi mismatch giữ nguyên record hợp lệ để proof đúng sau đó vẫn consume được.
- Lua callback/handoff hiện yêu cầu key còn TTL dương trước khi trả bất kỳ state/identity nào; handoff matching path cũng validate `maxProofFailures`, configured ceiling và `proofFailures` bounded trước khi consume. `issueHandoff` từ chối limit vượt configured ceiling. Tampered `PERSIST`, missing field, malformed/at-limit counter và configured-max vượt ceiling đều fail closed, không gia hạn TTL hoặc đổi key khác.
- Bỏ `@ConditionalOnBean(StringRedisTemplate.class)` khỏi component OAuth store vì test context thực chứng minh điều kiện có thể được đánh giá trước Redis auto-configuration, khiến bean bị thiếu khi OAuth enabled. Bean vẫn property-gated bởi Google `client-id`, constructor injection yêu cầu template thật; OAuth disabled không tạo bean. Wiring test dùng full Spring context, complete config và disposable Valkey, assert đúng một bean rồi round-trip transaction thực tế.
- Bổ sung unavailable-backend test với command timeout ngắn, fixed sanitized message/null cause, và identity round-trip có email thật cùng subject-only; LINK giữ credential fingerprint/provider verifier qua adapter.

### File ownership trong correction pass

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStore.java` | Live-TTL/counter validation, configured proof ceiling và enabled-bean wiring correction |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreIntegrationTest.java` | 15 real-Valkey integration tests: binding coverage, replay/concurrency, tamper, email/subject-only, unavailable backend |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreWiringIntegrationTest.java` | Enabled Spring auto-configuration + one-bean assertion + real round-trip |

### Verification

| Check | Result | Evidence/limit |
| --- | --- | --- |
| GitNexus pre-edit impact | `UNKNOWN corroborated; no HIGH/CRITICAL` | Rebound `Weav-identity-m3` to `T:\Weav\tmp\identity-m3-worktree`; impacts for `ValkeyOAuthTransactionStore`, `OAuthTransactionStore`, `consumeHandoff`, `consumeCallback` and `issueHandoff` were target-not-found/UNKNOWN because correction symbols were new/unindexed. Targeted source search confirmed the adapter/test/port references; UNKNOWN was not treated as unused. No post-edit reindex/detect-changes was run because no commit/staging milestone was requested. |
| Initial enabled-wiring probe | `EXPECTED FAILURE DISCOVERED` | Before removing the condition, full Spring context with complete enabled OAuth config had no `OAuthTransactionStore` bean. This is the concrete ordering defect fixed in the smallest bounded production change. |
| Focused B1 correction suite | `PASS: 20 tests, 0 failures, 0 errors, 0 skipped` | `OAuthContractTest` 4 contract tests + `ValkeyOAuthTransactionStoreIntegrationTest` 15 real Docker-Valkey tests + `ValkeyOAuthTransactionStoreWiringIntegrationTest` 1 real Spring/Valkey wiring test. |
| Full Identity regression | `PASS: 174 tests, 0 failures, 0 errors, 0 skipped` | Surefire XML independently summed 50 reports to 174/0/0/0. Cached Maven 3.9.16, UTC, Docker-backed PostgreSQL/Valkey/Mailpit, `BUILD SUCCESS` (01:59). Existing expected dependency reconnect warnings did not fail tests. |
| Whitespace/diff | `PASS` | `git diff --check` clean; targeted trailing-whitespace scan over adapter, both B1 tests and this log found zero hits. |

### Handoff and limits

- No commit/push, secret/.env read, dependency install, Neon mutation, external worker, provider adapter, account business mutation or live endpoint was performed. Existing Task6/Slice A/B1 WIP remains uncommitted on `codex/identity-m3`.
- Focused count is intentionally separated: 4 contract tests, 15 real Valkey integration tests and 1 enabled-wiring test; it is not reported as 20 real-Valkey tests. Physical deletion still exposes only bounded `NOT_FOUND`/mismatch semantics; no tombstones were introduced.
- Root should review the condition-ordering fix, Lua validation order/arguments, key isolation, secret redaction and the untracked-file diff, then run worktree-scoped GitNexus indexing/change analysis before any staging/commit. B2 Google provider remains the next separate gate.

## 20. Kết thúc session 7

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09 19:50 Asia/Saigon` |
| Trạng thái worktree | `Task6, Slice A và B1 correction chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `ValkeyOAuthTransactionStore.java`, B1 integration/wiring tests, approved Task7 Google plan, root review checklist |

## 21. Session 8 — B1 PTTL correction and B2 Google OIDC adapter (2026-09-09)

### Phạm vi đã được root mở

- Root mở một correction rất hẹp cho B1 rồi mở B2 provider adapter. Đã giữ đúng ranh giới: chưa có controller, OpenAPI/live route, account/session mutation, browser flow, Neon/Google credential, hay real-provider smoke.
- B1 correction dùng millisecond `PTTL` thay cho `TTL` trong Lua consume/collision paths: key còn thời gian dương dưới một giây vẫn là live; key hết hạn/mất key trả `NOT_FOUND`, key no-expiry/corrupt trả dependency failure; collision receipt không gia hạn lifetime.
- B2 dùng Spring Security OAuth2 Client/OIDC và Nimbus JWK/JWT primitives, không tự parse chữ ký/JWK. Provider access/refresh token chỉ tồn tại trong token response tạm thời và bị bỏ sau khi decode ID token; handoff/app port chỉ nhận validated provider identity.

### File ownership và thay đổi

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStore.java` | `PTTL` live-subsecond handling, millisecond expiry receipts và no-extension collision behavior |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreIntegrationTest.java` | Real-Valkey regression chứng minh positive subsecond TTL consume thành công và collision không kéo dài TTL |
| Sửa | `services/identity-service/pom.xml` | Thêm `spring-boot-starter-oauth2-client` theo managed Spring Boot version; không thêm dependency tự quản lý |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapter.java` | Fixed Google registration/discovery, exact redirect/scopes, server PKCE S256, bounded timeout, Spring token client, Nimbus RS256/JWK/claim validation, sanitized provider failures |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapterIntegrationTest.java` | JDK HTTP provider stub + genuinely signed RSA ID tokens/JWK; 10 tests cho URL/PKCE, identity, signature/key/alg/issuer/aud/azp/nonce/time/typed claims/denial/timeout/JWK/discovery failures |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreWiringIntegrationTest.java` | Enabled full Spring scan xác nhận đúng một `OAuthProviderClient` là Google adapter và B1 store round-trip với disposable Valkey |

Provider test discovery is redirected only through a package-private test constructor to a local HTTP server; production constructor derives discovery from the validated HTTPS issuer and never accepts endpoint overrides. The exchange configures Spring's OAuth token-response converter ahead of generic JSON handling so `id_token` remains an additional token response parameter without logging or persisting provider tokens. Custom `/auth/oauth/google/*` HTTP integration and Spring callback wiring remain deferred to D; this adapter does not claim that Spring's default login filters handle those routes.

The implementation follows the reviewed primary references: [Google OpenID Connect API reference](https://developers.google.com/identity/openid-connect/reference), [Google OAuth 2.0 web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [Spring Security authorization-grant support](https://docs.spring.io/spring-security/reference/servlet/oauth2/client/authorization-grants.html), and [Spring Security OAuth2 Login advanced configuration](https://docs.spring.io/spring-security/reference/servlet/oauth2/login/advanced.html).

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| B1 residual PTTL focused test | `PASS: 1/0/0/0` | `ValkeyOAuthTransactionStoreIntegrationTest#positiveSubsecondTtlCanConsumeAndCollisionReceiptDoesNotExtendLifetime`, disposable Docker Valkey, no long wait |
| B2 provider focused suite | `PASS: 10/0/0/0` | `GoogleOidcAdapterIntegrationTest`, actual HTTP/JWK/token path with signed local RSA fixtures; no validation mock and no real credentials |
| Focused OAuth/B1/B2 suite | `PASS: 49/0/0/0` | 4 contract + 4 PKCE + 3 URI + 16 real-Valkey + 1 enabled-wiring + 11 config + 10 provider tests |
| Full Identity Maven regression | `PASS: 185/0/0/0` | Surefire XML independently summed 51 reports; Maven 3.9.16, UTC, Docker PostgreSQL/Valkey/Mailpit, `BUILD SUCCESS` (02:07). Existing expected dependency-reconnect and failure-fixture warnings did not fail tests |
| `git diff --check` | `PASS` | Re-run after this log append; targeted trailing-whitespace scan over changed B1/B2 files and this log is clean; no commit/push |

### GitNexus evidence and limits

- Before B2 edits, explicit worktree-bound index refresh had completed at `5,192 nodes / 11,037 edges / 216 clusters / 255 flows`; UNKNOWN impact results were corroborated with targeted source inspection and no HIGH/CRITICAL pre-edit result was found. The refresh after B2 includes `5,311 nodes / 11,420 edges / 219 clusters / 259 flows`; warnings remain: 22 Java files without reliable package facts, cross-language property links absent, 259 flows with 114 candidate entry points omitted and 410 callees skipped. These are lower-bound graph results, not clean coverage.
- Post-refresh `GoogleOidcAdapter` upstream impact resolves the Spring component but reports `UNKNOWN` with zero callers; targeted search confirms only expected component/test references. `OAuthProviderClient` remains target-not-found/UNKNOWN in the index; targeted source inspection confirms the port and adapter/test references. No HIGH/CRITICAL result was returned.
- Worktree `detect-changes --scope all` was run without staging. It reports only the five tracked Task6 persistence files (`5 files / 22 symbols / 8 flows`, risk `high`) and omits the many untracked B1/Slice A/B2 files; this is explicitly partial and not claimed as a clean all-files change scan. Root must review/stage the complete untracked set before any milestone commit.

### Handoff and remaining gates

- No commit/push, secret/.env read, dependency installation beyond the authorized Maven-managed OAuth2 client dependency resolution, Neon mutation, external worker or subagent was used. Existing Task6/Slice A/B1/B2 WIP remains uncommitted on `codex/identity-m3`.
- B2 proves the backend provider adapter against a signed local OIDC/JWK/token stub only. Real Google system-browser registration, Secure-cookie browser acceptance, account-policy races, one-use handoff callback, LOGIN/LINK mutation, web refresh/logout cookies, CSRF/Origin transport and Vite/Gateway integration remain pending later gates. No production callback or web endpoint is claimed.

## 22. Kết thúc session 8

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1 correction và B2 adapter chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `GoogleOidcAdapter.java`, provider stub tests, PTTL B1 test, approved Task7 Google plan, root review checklist` |

## 23. Session 9 — B2 trust-boundary and provider-path validation (2026-09-09)

### Phạm vi correction đã được root mở

- Root yêu cầu một pass validation B2 giới hạn trước khi mở C; không triển khai account use case, controller/route/OpenAPI, browser flow, web transport hay real Google smoke.
- Google issuer production hiện bị pin ở cả binding và immutable `OAuthConfiguration` vào canonical `https://accounts.google.com`; `GoogleOidcAdapter` kiểm tra lại trust anchor trước discovery/JWK. Test-only local discovery override vẫn giữ cho HTTP stub, nhưng không thay đổi production issuer/endpoints. Signed ID token legacy `iss=accounts.google.com` vẫn được chấp nhận theo policy đã duyệt.
- Provider fixture chứng minh chữ ký sai với cùng `kid` (known-key bad signature), unknown `kid` và HS256 riêng biệt; bổ sung positive multi-audience với `azp` đúng, single-audience `azp` sai, thiếu `exp`/`iat`/`nonce`, `nbf` tương lai. Hosted-domain allowlist được kiểm tra cả allow và reject; subject/email claims vẫn không được ghi ra output.
- Discovery, token-denial/timeout và JWK failures dùng hit counters độc lập để chứng minh từng đường HTTP được đi qua, không dùng một server failure kéo theo các assertion sau. Full enabled context assert đúng một `OAuthProviderClient`/store và adapter runtime vẫn chưa khởi tạo sau startup (lazy discovery); core context khi OAuth disabled assert không có provider adapter.

### File ownership trong correction pass

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/dto/OAuthConfiguration.java` | Canonical Google issuer trust anchor và constructor invariant cho enabled config |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/OAuthProperties.java` | Binding-level rejection của non-Google issuer |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapter.java` | Defense-in-depth issuer pin trước runtime discovery |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/application/port/out/OAuthContractTest.java` | Direct enabled-configuration rejection test |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/config/OAuthPropertiesTest.java` | Non-Google binding rejection regression |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapterIntegrationTest.java` | Signed legacy issuer, known-key/unknown-key crypto checks, audience/time/hd claims and independent endpoint-hit evidence |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/IdentityServiceApplicationTests.java` | Disabled OAuth provider absence assertion |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreWiringIntegrationTest.java` | Exactly-one enabled provider plus reflective lazy-runtime assertion |

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Focused validation suite | `PASS: 35/0/0/0` | OAuthContract 5, Identity disabled-context 4, enabled Valkey/provider wiring 1, OAuthProperties 12, signed Google adapter 13; cached Maven 3.9.16, UTC, Docker-backed contexts |
| Full Identity Maven regression | `PASS: 191/0/0/0` | Maven `test` independently summed 51 Surefire XML reports to 191/0/0/0; Docker PostgreSQL/Valkey/Mailpit; `BUILD SUCCESS` (02:12). Expected fixture/dependency warning logs did not fail tests |
| Whitespace/diff | `PASS` | `git diff --check` clean after correction; no commit/push |

### GitNexus evidence and limits

- Before edits, explicit impact in the M3 worktree found `OAuthConfiguration` with exact LOW impact (4 resolved callers, one config process); `OAuthProperties`, `GoogleOidcAdapter` and existing test symbols returned `UNKNOWN`/zero or target-not-found. Targeted `rg` confirmed the expected Spring/config/test references; UNKNOWN was not treated as unused. No HIGH/CRITICAL result was returned, so no pre-edit warning was required.
- Refreshed explicit worktree index after edits: `5,331 nodes / 11,473 edges / 218 clusters / 259 flows`. Post-refresh adapter/properties impacts remain `UNKNOWN` with zero resolved callers. Known lower-bound limits remain: 22 Java files lacked reliable package facts, 4 cross-language property links were not inferred, 114 of 314 candidate entry points were omitted and 410 callees were skipped. These are graph-coverage limits, not clean unused verdicts. No commit was made, so `detect_changes` was not used as a pre-commit gate; tracked/untracked state remains for root review.

### Handoff and remaining gates

- No C/D work started. B2 remains backend-adapter plus local signed OIDC/JWK stub evidence only; real Google registration/system-browser smoke, provider credentials, callback/hand-off consume, account/session mutation, web refresh/logout cookies, CSRF/Origin transport and Vite/Gateway integration remain pending root approval and later slices.
- No secret/.env read, Neon mutation, external worker/subagent, commit or push. Worktree remains uncommitted on `codex/identity-m3`; root should review the issuer invariant/legacy alias, lazy bean assertion, signed token cases, and untracked-file diff before opening C.

## 24. Kết thúc session 9

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1 correction và B2 adapter/correction chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `OAuthConfiguration.java`, `OAuthProperties.java`, `GoogleOidcAdapter.java`, signed provider stub tests, approved Task7 Google plan, root review checklist` |

## 25. Session 10 — C1 Google LOGIN account/session mutation (2026-09-09)

### Recovery and scope

- Recovered the dedicated `T:\Weav\tmp\identity-m3-worktree` on `codex/identity-m3`; no partial C1 files were present. Existing Task6, Slice A, B1 and B2 work remained untouched and uncommitted.
- C1 was limited to the internal use case that consumes a trusted, already-consumed LOGIN handoff/provider identity. No controller, callback/start/exchange transport, web cookie, LINK/unlink behavior, Google credential persistence, Neon mutation, secret/.env read, commit or push was added.
- Worktree-bound GitNexus impacts were run before editing existing symbols. The index was current to base `2e05420`; affected existing symbols returned `UNKNOWN`/partial with no HIGH/CRITICAL result. Targeted source inspection corroborated the repository/config/session callers; the UNKNOWN result was not treated as unused.

### C1 changes

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/usecase/CompleteGoogleLoginUseCase.java` | Google LOGIN policy and one normal session: linked subject-first lookup, user-first lock/re-read, active-user check, subject-only support, no provider-email overwrite; unknown subject requires canonical verified email; Gmail/valid trusted `hd` sets local verification, third-party verified email remains OTP-unverified; new user/OAuth row/session are one transaction |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/domain/exception/OAuthAccountLinkRequiredException.java` | Generic `ACCOUNT_LINK_REQUIRED` domain result for an existing local email; no email enumeration |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/IdentityApplicationConfig.java` | Add the C1 use-case bean using existing repositories, transaction runner and configured JWT refresh lifetime |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/application/usecase/CompleteGoogleLoginUseCaseTest.java` | 10 policy/session tests covering active/disabled/subject-only, authority, rejection, collision, rollback and LOGIN-only handoff |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/persistence/CompleteGoogleLoginPersistenceIntegrationTest.java` | 8 real PostgreSQL/Testcontainers tests covering persistence, configured lifetime, rollback, duplicate-subject race and local-registration race |

The race paths rely on canonical email/provider-subject database uniqueness and let the transaction roll back. They do not catch a failed flush and query/delete/merge inside the rollback-only transaction. No picture is copied to avatar storage, no provider token is stored, and no local email is rewritten.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| C1 focused unit suite | `PASS: 10/0/0/0` | `CompleteGoogleLoginUseCaseTest`; Maven 3.9.16 direct executable with `-Duser.timezone=UTC -Duser.home=C:\Users\nhoan` because the repository wrapper is unavailable in this PowerShell environment |
| C1 focused PostgreSQL suite | `PASS: 8/0/0/0` | `CompleteGoogleLoginPersistenceIntegrationTest`; disposable PostgreSQL 18.6/Testcontainers, including injected failure and real concurrent duplicate/race paths |
| Full Identity Maven regression | `PASS: 209/0/0/0` | `mvn test`, Docker PostgreSQL/Valkey/Mailpit, UTC, `BUILD SUCCESS` (02:36); expected constraint/race and dependency-shutdown warning logs did not fail tests |
| Identity package build | `PASS` | `mvn -DskipTests package`, Spring Boot jar repackaged successfully |
| `git diff --check` | `PASS` | Final check after implementation and this log append; no commit/push |

### Limits and handoff

- The new `OAuthAccountLinkRequiredException` is an internal domain result; the later transport slice must map it to the planned generic HTTP `409` response. C1 deliberately does not change the existing HTTP handler.
- C1 does not claim real Google browser/provider credentials, handoff consumption, callback/start/exchange routes, HttpOnly cookie transport, CSRF/Origin handling, LINK/unlink or mobile/BFF behavior. Root owns those later slices and the final complete/untracked diff review.
- GitNexus `detect_changes` was not presented as a clean pre-commit gate because this worktree intentionally contains many pre-existing untracked Task6/Slice A/B1/B2/C1 files; no commit was made.

## 26. Kết thúc session 10

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2 và C1 chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `CompleteGoogleLoginUseCase.java`, C1 unit/integration tests, `OAuthAccountLinkRequiredException.java`, C1 acceptance checklist in the approved Google plan` |

## 27. Session 11 — C1 bounded corrections (2026-09-09)

### Phạm vi correction và recovery

- Root mở một correction pass hẹp cho C1 sau khi review: hosted-domain authority phải có syntax validation; rollback evidence phải đi qua session save; concurrent tests phải ép overlap sau các absence checks thật; và trusted identity không được có public use-case overload bypass LOGIN handoff.
- Recovery confirmed the dedicated worktree and branch were still intact. Existing Task6, Slice A, B1, B2 and C1 WIP remained uncommitted; no files were deleted, no canonical checkout or secrets/.env was touched, and no commit/push was made.
- C1 remains internal account/session mutation only. No controller, callback/start/exchange transport, web cookie, LINK/unlink, mobile/BFF or real Google credential work was added.

### Thay đổi correction

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/validation/OAuthProtocolPolicy.java` | Add syntax-only DNS-style hosted-domain predicate; no email-domain comparison or product allowlist |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapter.java` | Reject malformed signed `hd` claims before creating provider identity; valid `hd` remains independently authoritative at C1 policy boundary |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/usecase/CompleteGoogleLoginUseCase.java` | Retain malformed trusted `hd` as non-authoritative, and expose only LOGIN-handoff entry points; direct ProviderIdentity execution overloads removed |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/application/validation/OAuthProtocolPolicyTest.java` | Valid/invalid hosted-domain syntax coverage |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapterIntegrationTest.java` | Signed malformed-`hd` fixtures fail before identity creation |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/application/usecase/CompleteGoogleLoginUseCaseTest.java` | Construct trusted LOGIN handoffs and prove malformed `hd` does not verify a third-party email |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/persistence/CompleteGoogleLoginPersistenceIntegrationTest.java` | Inject failure after session save for new and linked users; barrier real absence rechecks; same-subject/different-email race; local-registration winner/loser and persisted ownership assertions |

The C1 policy still accepts Gmail or a syntactically valid signed Workspace `hd` as authoritative without requiring the two domains to match. A malformed `hd` is rejected by the provider adapter and is non-authoritative if a trusted handoff fixture reaches the use case. Subject-only linked login remains supported; provider email never overwrites the local email.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Focused C1 correction suite | `PASS: 40/0/0/0` | CompleteGoogleLoginUseCaseTest 11, OAuthProtocolPolicyTest 5, CompleteGoogleLoginPersistenceIntegrationTest 10, GoogleOidcAdapterIntegrationTest 14; disposable PostgreSQL and signed local OIDC/JWK fixtures where applicable |
| Full Identity Maven regression | `PASS: 214/0/0/0` | Maven 3.9.16 direct executable, `-Duser.timezone=UTC`, Docker PostgreSQL/Valkey/Mailpit/Testcontainers; `BUILD SUCCESS`; expected constraint/dependency-shutdown warning logs did not fail tests |
| Identity package build | `PASS` | `services/identity-service`: Maven `-DskipTests package`; Spring Boot jar repackaged successfully |
| `git diff --check` | `PASS` | Clean after the correction and work-log append; no commit/push |

### GitNexus evidence and limits

- Worktree-bound GitNexus impacts were run before changing existing symbols. New/untracked C1 targets and `OAuthProtocolPolicy`, `GoogleOidcAdapter` and related tests returned target-not-found or `UNKNOWN`/partial; targeted source search and manual inspection corroborated expected callers and references. No HIGH/CRITICAL result was returned, and UNKNOWN was not treated as unused.
- No clean post-edit `detect_changes` claim is made: the worktree intentionally contains many pre-existing untracked Task6/Slice A/B1/B2/C1 files, and no commit/staging milestone was requested. Root owns the complete untracked diff review and final graph gate before any commit.

### Handoff and limits

- C1 correction is complete and stops before C2/D. The later transport slice must map `OAuthAccountLinkRequiredException` to the planned generic HTTP `409` and own handoff consumption, cookies, CSRF/Origin and endpoint behavior.
- No real Google browser/provider smoke, HTTP route, cookie transport, LINK/unlink or mobile/BFF behavior is claimed. No helper setup-refresh error occurred.

## 28. Kết thúc session 11

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-09` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2 và C1 correction chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `OAuthProtocolPolicy.java`, `GoogleOidcAdapter.java`, `CompleteGoogleLoginUseCase.java`, C1 correction tests, root review checklist` |

## 29. Session 12 — C2 authenticated Google LINK application use cases (2026-09-10)

### Phạm vi và recovery

- Root accepted C1 and opened only C2: trusted application use cases for authenticated Google LINK initiation/recheck/completion, safe self metadata listing and owner-scoped unlink. No controller, callback/start/exchange transport, HTTP route/OpenAPI, cookie/CSRF/Origin handling, mobile/BFF work or C2/D transport wiring was added.
- Reused the existing `CurrentIdentityGuard`, user-first lock protocol, `OtpFingerprintPolicy.credential` namespace, canonical email/password validation, OAuth uniqueness constraints and transaction runner. No canonical checkout, secrets/.env, Neon, commit/push or external worker was touched.
- Before existing-symbol edits, the explicit worktree-bound `Weav-identity-m3` GitNexus impacts for the guard/config/fingerprint/input policy and existing Google login path were `UNKNOWN`/partial or target-not-found with zero resolved callers; targeted source inspection corroborated all known consumers and the result was not treated as unused. No HIGH/CRITICAL result was returned. The index was current to commit `2e05420` (`5,331` nodes, `11,473` edges, `218` clusters, `259` flows).

### C2 changes

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/usecase/LinkGoogleAccountUseCase.java` | Active-session/current-password link binding; credential fingerprint capture; callback recheck; consumed LINK handoff completion under a user-first lock and current bearer/session identity; subject/provider uniqueness conflict; authoritative exact-email verification only; no new session/token or local email rewrite |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/usecase/ListOAuthAccountsUseCase.java` | Authenticated self-only safe metadata listing |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/usecase/UnlinkOAuthAccountUseCase.java` | Active self/session check, user-first lock, owner-scoped delete, safe missing/non-owner `404`, password verification and `OAUTH_LAST_LOGIN_METHOD` guard before missing-password rejection; current session remains untouched |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/dto/OAuthAccountMetadata.java` | Safe DTO containing only id, provider, provider email and timestamps; no subject, token or fingerprint |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/domain/exception/OAuthLastLoginMethodException.java` | Generic `OAUTH_LAST_LOGIN_METHOD` conflict result |
| Thêm/Sửa | `services/identity-service/src/main/java/com/weav/identity/application/validation/GoogleEmailAuthorityPolicy.java`, `services/identity-service/src/main/java/com/weav/identity/application/usecase/CompleteGoogleLoginUseCase.java` | Shared C1/C2 Gmail/valid signed hosted-domain authority rule; removed an unused import after review |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/IdentityApplicationConfig.java` | Add the three C2 use-case beans without altering transport wiring |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/application/usecase/LinkGoogleAccountUseCaseTest.java` | 10 policy tests for initiation, fingerprint/session recheck, bearer binding, verification policy, safe list DTO, owner scope, password and last-method behavior |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/persistence/OAuthLinkPersistenceIntegrationTest.java` | 8 real PostgreSQL/Testcontainers tests for link persistence/no session mint, email policy, invalidation, rollback, same-subject and same-user races, list/unlink ownership and OAuth-only protection |

The link completion uses the consumed trusted LINK handoff only after matching it to the current authenticated user/session; it then locks and re-reads the user, active session and credential fingerprint before any mutation. A subject owned by another user and a second Google row for the same user both return a generic conflict without reassignment. The injected persistence failure occurs after local verification is changed and the OAuth save is attempted; the real transaction proves the verification and association roll back. The list/unlink fixture was corrected once after the first focused run exposed an impossible second Google row, consistent with V4's one-Google-provider-per-user constraint; the final run passed.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Focused C2 suite | `PASS: 18/0/0/0` | `LinkGoogleAccountUseCaseTest` 10 + `OAuthLinkPersistenceIntegrationTest` 8; real PostgreSQL 18.6/Testcontainers with barriers and rollback injection |
| Combined C1/C2 focused suite | `PASS: 58/0/0/0` | C1 login policy/persistence, C2 use cases/persistence, OAuth protocol and signed Google adapter tests; UTC and disposable Docker fixtures |
| Full Identity Maven regression | `PASS: 232/0/0/0` | Maven 3.9.16 direct executable, UTC, Docker PostgreSQL/Valkey/Mailpit/Testcontainers, `BUILD SUCCESS` (02:24); expected constraint/dependency reconnect warnings did not fail tests |
| Identity package build | `PASS` | `mvn -DskipTests package`; Spring Boot jar repackaged successfully |
| Whitespace/diff | `PASS` | `git diff --check` clean after C2 edits and log append; no commit/push |

### Handoff and limits

- C2 is complete and stops before D. No HTTP/controller, callback/start/exchange wiring, handoff-store transport invocation, cookies, CSRF/Origin, real Google browser credentials, mobile/BFF or endpoint acceptance is claimed. Future HTTP routes remain the approved `GET/DELETE /users/me/oauth-accounts` and are not added here.
- No clean post-edit `detect_changes` claim is made because the worktree intentionally contains many pre-existing untracked Task6/Slice A/B1/B2/C1/C2 files and no staging/commit milestone was requested. Root owns complete untracked diff review and final graph/change gate.
- No `helper_unknown_error: setup refresh had errors` occurred. No commit, push, secret/.env read, Neon mutation, dependency installation or external worker was used.

## 30. Kết thúc session 12

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1 và C2 chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `LinkGoogleAccountUseCase.java`, `OAuthLinkPersistenceIntegrationTest.java`, C2 acceptance checklist in the approved Google plan, root review checklist` |

## 31. Tiếp tục D1 application OAuth coordinator (2026-09-10)

### Recovery and scope

- Root mở bounded D1 sau khi C2 được chấp nhận: chỉ coordinator application cho start/callback/exchange; không thêm controller, HTTP redirect/cookie, CSRF/Origin/CORS, refresh/logout web, Gateway hoặc mobile.
- Đọc lại plan Task7, các port/config/store/provider và C1/C2 contracts. Không có partial D1 files trước khi bắt đầu; giữ nguyên toàn bộ Task6/Slice A/B1/B2/C1/C2 WIP.
- Explicit `Weav-identity-m3` GitNexus binding là `T:\Weav\tmp\identity-m3-worktree`, branch `codex/identity-m3`, index base `2e05420` (`5,331` nodes, `11,473` edges, `218` clusters, `259` flows). Upstream impacts trước edit cho `OAuthApplicationConfig`, `GoogleOidcAdapter`, OAuth DTOs/ports và config symbols đều `UNKNOWN`/partial hoặc target-not-found, không có HIGH/CRITICAL; targeted source search corroborated the known callers and UNKNOWN was not treated as safe. MCP không expose analyze/reindex trong session, nên new untracked D1 symbols remain outside the base index.

### D1 changes

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/usecase/OAuthFlowCoordinator.java` | Framework-free LOGIN/LINK start, callback and exchange orchestration. Logical IDs resolve only to the configured registration; 32-byte opaque transaction/state/nonce/provider-verifier/handoff values; start publishes only after provider URL construction; bounded pre-publication collisions; callback atomically consumes state before provider network, handles safe cancellation/provider failure, rechecks LINK before handoff; exchange derives S256, atomically consumes the matching handoff, routes intent through separate trusted LOGIN/LINK methods and never retries post-consume mutation. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/dto/OAuthCallbackCommand.java`, `OAuthCallbackResult.java`, `OAuthStartResult.java`, `OAuthExchangeResult.java` | Internal trusted input/output records with safe status discriminators and redacted `toString`; no arbitrary ProviderIdentity or transport/cookie fields. LINK result carries metadata only; LOGIN result wraps existing normal session result without exposing token material from coordinator `toString`. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/application/validation/OAuthFingerprintPolicy.java` | Shared domain-separated state, Google nonce (`oauth-google-nonce`) and handoff namespaces. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/oauth/GoogleOidcAdapter.java` | Uses the shared nonce namespace so adapter verification matches coordinator start state. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/dto/OAuthStartCommand.java` | Redacts the client PKCE challenge in `toString`. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/domain/exception/InvalidOAuthClientException.java`, `OAuthCallbackInvalidException.java`, `OAuthHandoffInvalidException.java` | Fixed generic application error codes for later HTTP mapping; no provider diagnostics or raw protocol values. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/OAuthApplicationConfig.java` | Conditionally wires the coordinator only when the configured Google provider/store adapters are enabled; disabled core-auth startup remains unaffected. |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/application/usecase/OAuthFlowCoordinatorTest.java` | 9 focused tests covering logical registration, provider-before-store ordering, fresh collision retry, invalid state/cancel/provider call ordering, LINK binding/recheck, verifier challenge, intent-specific exchange, wrong-proof non-mutation and secret redaction. |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/persistence/OAuthFlowCoordinatorPersistenceIntegrationTest.java` | 3 real PostgreSQL 18.6 + Valkey 8 integration tests for LOGIN start→callback→exchange, LINK no-new-session completion, and one-use replay rejection. Provider is a local application-port stub; signed local Google ID-token validation remains covered by `GoogleOidcAdapterIntegrationTest`. |

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| D1 coordinator unit suite | `PASS: 9/0/0/0` | `OAuthFlowCoordinatorTest`, UTC, Mockito test doubles only for ordering/failure matrix |
| D1 real persistence suite | `PASS: 3/0/0/0` | `OAuthFlowCoordinatorPersistenceIntegrationTest`; disposable Docker PostgreSQL 18.6 + Valkey 8; LOGIN creates one user/OAuth/session, LINK preserves one existing session, consumed handoff replay is rejected |
| D1 source compile | `PASS` | Maven 3.9.16 direct executable, Java 25, UTC; existing Spring deprecation warning only |
| GitNexus post-edit check | `HIGH / incomplete for D1` | `detect_changes(scope=all, worktree=...)` saw only 7 pre-existing tracked files and 40 symbols; new coordinator/DTO files are untracked and not in the base index. Do not interpret this as a D1-specific HIGH impact or a clean graph gate; root owns final review/reindex/change analysis. |
| Whitespace/diff | `PASS` | `git diff --check` clean after D1 edits and this log append; no commit/push |

### Handoff and limits

- D1 stops before HTTP D2. No public route, cookie transport, CSRF/Origin/CORS, web refresh/logout, Gateway/native wiring, real Google credentials, `.env`/secret or Neon access was used.
- The callback result intentionally returns only a registered target plus an opaque handoff secret for the later transport to place in its approved return URL; it does not build or log a redirect. The provider code, raw state, nonce, provider verifier and provider tokens are not persisted in the final handoff or exposed by result string forms.
- No helper error `helper_unknown_error: setup refresh had errors` occurred. No commit/push or external worker was used.

## 32. D1 stop

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1, C2 và D1 chưa commit trên codex/identity-m3; không commit/push` |
| Cần đọc trước khi tiếp tục | `OAuthFlowCoordinator.java`, D1 focused/integration tests, GitNexus incomplete post-edit note, approved D2 HTTP scope` |

## 33. D1 final verification after wiring correction (2026-09-10)

- Full-suite review found one bounded configuration gap: a minimal `OAuthPropertiesTest` context enabled the Google property but intentionally omitted provider/store/use-case collaborators, so the coordinator bean must not be created there. Added `@ConditionalOnBean` for the six required collaborators alongside the existing Google property condition; production wiring remains available only when the complete trusted flow is present.
- Focused D1 and adjacent OAuth lanes: `81/0/0/0` passed, including coordinator unit, real PostgreSQL/Valkey coordinator persistence, Google adapter, transaction store, C1/C2 use cases and persistence suites.
- Post-correction wiring checks: `OAuthPropertiesTest` `12/0/0/0` and `ValkeyOAuthTransactionStoreWiringIntegrationTest` `1/0/0/0` passed with disposable Docker PostgreSQL 18.6 + Valkey 8.
- Fresh full Identity regression: `244/0/0/0` passed. Package build: `mvn -DskipTests package` `BUILD SUCCESS`; only the existing Spring deprecation warning was emitted.
- `git diff --check` remains clean after this update. No commit/push, HTTP D2, or external worker was started. GitNexus post-edit output remains the previously recorded incomplete lower-bound check because new D1 files are untracked; no clean graph claim is made.

## 34. D1 acceptance corrections and composed-flow proof (2026-09-10)

### Scope and recovery

- Root reopened only the four D1 acceptance gaps: production enabled/disabled coordinator wiring evidence, a real signed Google composition path, real-store callback/exchange failure coverage, and explicit same-endpoint intent dispatch documentation. No D2 controller, cookie, CSRF/Origin, Gateway/native or mobile work was started.
- Recovery found the prior D1 files intact. The earlier three persistence tests used a provider-port stub and were preserved; the new signed local fixture adds composition evidence without replacing the simpler ordering tests. No pre-existing WIP was deleted or reset, and no canonical checkout, secrets/.env or Neon resource was touched.
- Before existing-symbol edits, worktree-bound GitNexus impacts for `IdentityServiceApplicationTests`, `GoogleOidcAdapter` and `OAuthApplicationConfig` were `UNKNOWN`/partial or target-not-found with no HIGH/CRITICAL result. Targeted source search and manual review corroborated known callers; UNKNOWN was not treated as unused. New untracked coordinator/fixture symbols remain outside the base index, so no clean graph gate is claimed.

### Bounded corrections

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/authstate/ValkeyOAuthTransactionStoreWiringIntegrationTest.java` | Enabled Spring context now autowires the coordinator and asserts exactly one coordinator bean alongside the single provider/store; this proves the conditional configuration is not silently skipped. |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/IdentityServiceApplicationTests.java` | Disabled OAuth context asserts no `OAuthFlowCoordinator` bean, in addition to no provider adapter. |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/oauth/SignedGoogleProviderFixture.java` | Disposable local discovery/token/JWK server signs a Google-shaped RS256 ID token and returns a deliberately non-persisted provider access token; no real provider credentials are used. |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/persistence/OAuthFlowCoordinatorPersistenceIntegrationTest.java` | Expanded real Valkey + PostgreSQL proof to 12 tests: signed adapter composition before/after exchange, nonce mismatch, state/correlation-cookie rejection, cancellation replay, wrong-verifier retry, LINK credential/session invalidation, explicit intent dispatch and post-session-save access-token failure with rollback/consumed-handoff assertions. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/application/usecase/OAuthFlowCoordinator.java` | Clarified that future transport dispatch uses an explicit omitted-Authorization LOGIN convention; bearer presence never bypasses handoff/user/session/credential checks and the dispatcher must not probe both consume paths. |
| Sửa | `docs/superpowers/plans/2026-09-09-identity-m3-google.md` | Documented the same approved exchange request shape and the no-Authorization LOGIN / trusted-bearer LINK dispatch convention, including the logged-in-browser LOGIN case. |

The signed composition test performs coordinator start, parses the generated provider request, signs a local Google ID token with the matching nonce, discovers the local JWK, exchanges through the real adapter and Valkey state store, then completes the real PostgreSQL login. It asserts zero account/session rows before exchange, one user/OAuth/session after exchange, no provider access token in the stored handoff, and no handoff/account/session after nonce mismatch. The rollback fixture verifies the access-token issuer is reached after the session row exists, then confirms user/OAuth/session rows are all rolled back while the consumed handoff cannot be replayed.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| D1 focused unit + configuration suite | `PASS: 52/0/0/0` | `OAuthFlowCoordinatorTest` 9, `IdentityServiceApplicationTests` 4, `ValkeyOAuthTransactionStoreWiringIntegrationTest` 1, `OAuthPropertiesTest` 12, `OAuthFlowCoordinatorPersistenceIntegrationTest` 12 and `GoogleOidcAdapterIntegrationTest` 14; Maven 3.9.16 direct executable with UTC and disposable Docker fixtures |
| Real coordinator persistence proof | `PASS: 12/0/0/0` | PostgreSQL 18.6 + Valkey 8; includes signed local Google token/JWK composition and post-session-save rollback |
| Package build | `PASS` | Direct Maven 3.9.16 executable with UTC and `-DskipTests package`; Spring Boot jar repackaged successfully (`BUILD SUCCESS`, 2026-09-10) |
| Full Identity regression | `PASS: 253/0/0/0` | Direct Maven `test` with UTC and disposable Docker fixtures; all current Identity reports are green, including the 12-test coordinator persistence suite. Expected constraint/reconnect/shutdown warnings did not fail the run. |
| `git diff --check` | `PASS` | Clean after the final code/log updates; no commit/push |

### Handoff and limits

- D1 correction is complete and stops before HTTP D2. The prior StubProvider tests remain useful ordering/transaction evidence, but the signed local fixture is now the real adapter/store/database composition proof; neither suite claims a real Google account/browser or production HTTP route.
- Same-endpoint intent remains a future controller concern: the approved DTO has no client intent field; transport must deliberately omit `Authorization` for LOGIN and use the trusted authenticated context for LINK, never retry both intent consumes. No controller or security filter was added.
- No `helper_unknown_error: setup refresh had errors` occurred. No commit/push, external worker, secret/.env read or Neon mutation was used.

## 35. D1 correction handoff

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1, C2 và D1 chưa commit trên codex/identity-m3; không commit/push` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Identity M3 worker` |
| Cần đọc trước khi tiếp tục | `§34, OAuthFlowCoordinatorPersistenceIntegrationTest.java, SignedGoogleProviderFixture.java, approved D2 HTTP scope` |

### Final verification for root review

- The full Identity suite is now `253/0/0/0` (up from the earlier `244/0/0/0` baseline because the bounded D1 additions are included). Focused D1/config evidence remains `52/0/0/0`, with the real coordinator persistence suite at `12/0/0/0`.
- `mvn -Dmaven.repo.local=C:/Users/nhoan/.m2/repository -Duser.home=C:/Users/nhoan -Duser.timezone=UTC -DskipTests package` completed with `BUILD SUCCESS`.
- `git diff --check` completed clean. The worktree intentionally still contains the shared uncommitted/untracked M3 WIP; no files were deleted or reset.

## 36. D2 HTTP OAuth transport (2026-09-10)

### Scope and recovery

- Root accepted the corrected D1 coordinator gate and opened only D2: Spring MVC transport for Google LOGIN start/callback/exchange, authenticated LINK start, self OAuth-account list/unlink, CSRF bootstrap/cookie protection, exact-origin CORS and bounded rate limits. Web refresh/logout remains D3; no Gateway, mobile/native, real Google browser credentials, Neon or `.env` access was added.
- Recovery found the complete D1 coordinator, signed local provider fixture and real Valkey/PostgreSQL proof intact. All existing Task6/Slice A/B1/B2/C1/C2/D1 files and untracked WIP were preserved; no canonical checkout, secret, reset, commit or push was touched.
- Before existing-symbol edits, the explicit `Weav-identity-m3` GitNexus impacts for `SecurityConfig`, `GlobalExceptionHandler`, `AuthRateLimitFilter`, `AuthRateLimiter`, `ApiAuthenticationEntryPoint`, `ApiAccessDeniedHandler`, `AuthController`, `UserController` and `IdentityApplicationConfig` were `UNKNOWN`/partial lower-bound results with no HIGH/CRITICAL result. Targeted source inspection corroborated known callers; UNKNOWN was not treated as unused. The post-edit `detect_changes(scope=all)` is intentionally recorded as `critical`/incomplete because the shared worktree contains many pre-existing tracked changes and untracked OAuth files omitted from the base index; it is not a clean D2 graph gate and root owns final reindex/change review.

### D2 changes

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/presentation/http/OAuthController.java`, `OAuthAccountController.java` | Bounded `/auth/oauth/google/*`, `/auth/web/csrf`, `/users/me/oauth/google/link` and self OAuth-account routes. Controllers use logical registration IDs, trusted bearer user/session IDs, coordinator/C2 use cases and safe DTOs; no arbitrary account identity or raw provider secrets are accepted. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/presentation/http/oauth/OAuthWebProtection.java`, `OAuthCsrfTokenService.java` | Exact configured Origin checks, HMAC-bound 32-byte CSRF tokens with bounded expiry, and `__Secure-` correlation/refresh plus secure non-HttpOnly XSRF cookie builders. Tokens and cookie values are redacted from `toString` forms. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/presentation/http/request/`, `services/identity-service/src/main/java/com/weav/identity/presentation/http/response/` | Validated/redacted start, exchange and link/unlink request DTOs and responses. LOGIN response exposes access token/type/expiry/user only; refresh token is cookie-only. LINK exposes metadata only and never mints a session. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/OAuthCorsConfiguration.java` | Credentialed CORS for only the approved OAuth/web route patterns and configured exact origins; no wildcard or reflected untrusted origin. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/SecurityConfig.java`, `AuthRateLimitFilter.java`, `AuthRateLimiter.java` | Permits only the intended public OAuth start/callback/exchange/bootstrap routes, leaves core bearer routes unchanged, maps bounded IP/session rate scopes and preserves malformed bearer rejection rather than downgrading to LOGIN. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/web/GlobalExceptionHandler.java`, `ApiAuthenticationEntryPoint.java`, `ApiAccessDeniedHandler.java` | Maps OAuth handoff/link/last-method errors to approved 401/409 outcomes and applies no-store/no-referrer headers to OAuth/error responses without exposing provider diagnostics. |
| Sửa | `services/identity-service/src/main/resources/application.properties`, `packages/contracts/http/auth/openapi.yaml`, `packages/contracts/http/auth/README.md` | Added secret-free bounded OAuth web configuration comments and documented only the implemented D2 endpoints, cookies, Origin/CSRF convention and deferred D3 boundaries. |
| Thêm/Sửa | `services/identity-service/src/test/java/com/weav/identity/presentation/http/GoogleOAuthHttpIntegrationTest.java`, `IdentityServiceApplicationTests.java` | Full Spring security-chain HTTP proof with disposable Valkey/PostgreSQL/local signed Google fixture, disabled-bean assertion and negative Origin/CSRF, cookie, replay, bearer, link/unlink and ownership cases. |

The same approved exchange request shape uses an explicit transport convention: an omitted `Authorization` header selects LOGIN, while a valid trusted bearer selects LINK. Any present malformed/expired bearer is a 401 and is never silently treated as anonymous LOGIN. Callback state/correlation validation happens before provider use; cancellation consumes only a valid matching callback and returns a fixed safe result. Successful callbacks redirect only to the configured registered return target with opaque `transaction_id` and `handoff_code`; raw provider code/state/tokens never appear in a Location header, response DTO or request log. Login refresh material is emitted only as an HttpOnly Secure SameSite=Lax cookie with the configured lifetime; LINK does not overwrite it.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Focused D2 HTTP/config/error suite | `PASS: 22/0/0/0` | `GoogleOAuthHttpIntegrationTest` 6, `IdentityServiceApplicationTests` 4, `GlobalExceptionHandlerTest` 4, `SecurityConfigTest` 4 and `AuthRateLimiterTest` 4; full Spring context/security chain with disposable PostgreSQL/Valkey and local signed provider fixture |
| Full Identity Maven regression | `PASS: 259/0/0/0` | Maven 3.9.16 direct executable, UTC, disposable Docker PostgreSQL/Valkey/Mailpit/Testcontainers; expected migration/reconnect/shutdown warnings did not fail the run |
| Identity package build | `PASS` | `mvn -Dmaven.compiler.fork=true -DskipTests package` with the existing local Maven cache; Spring Boot jar repackaged successfully (`BUILD SUCCESS`) |
| Whitespace/diff | `PASS` | `git diff --check` run after the D2 work-log append; no commit/push |

### Handoff and limits

- D2 stops before D3. No web refresh/logout routes or cookie rotation, browser Playwright/real Google smoke, Gateway/native/mobile wiring, provider credentials, `.env`/secret reads or Neon mutation are claimed. Secure-cookie acceptance in a real browser remains a D3 check; MockMvc/full-chain tests prove server transport behavior only.
- The repository contract was updated only for the implemented OAuth routes. The shared worktree still contains intentionally uncommitted/untracked Task6 through D2 WIP; no clean post-edit graph gate is claimed and root owns final complete-diff/reindex review.
- No `helper_unknown_error: setup refresh had errors` occurred. No commit, push, dependency installation, external worker or destructive cleanup was used.

## 37. D2 stop

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1, C2, D1 và D2 chưa commit trên codex/identity-m3; không commit/push` |
| Cần đọc trước khi tiếp tục | `§36, OAuthController.java, OAuthAccountController.java, OAuthWebProtection.java, GoogleOAuthHttpIntegrationTest.java, approved D3 scope` |

## 38. D2 correction gate (2026-09-10)

### Scope and review findings

- Root reopened only the bounded D2 corrections: correct `Referrer-Policy` response headers, unlink admission throttling, direct signed-CSRF edge-case coverage, conditional route inventory, strict handling of any present malformed `Authorization` header, and a core-auth CORS regression assertion. D3 web refresh/logout and browser smoke remain out of scope.
- Before existing-symbol edits, the explicit `Weav-identity-m3` GitNexus upstream impacts for `SecurityConfig`, `AuthRateLimitFilter`, `AuthRateLimiter`, `OAuthController`, `OAuthAccountController` and `IdentityServiceApplicationTests` were `UNKNOWN`/partial lower-bound results or target-not-found for new symbols, with no HIGH/CRITICAL result. Targeted source search and manual review corroborated the known consumers; UNKNOWN was not treated as unused. The shared-worktree post-edit change graph remains incomplete because untracked M3 files and pre-existing WIP are outside the base index; no clean graph gate is claimed.

### Bounded corrections

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/presentation/http/OAuthController.java`, `OAuthAccountController.java` | Use the literal `Referrer-Policy` header name with `no-referrer` value on start, callback, exchange, CSRF and account responses. Any present `Authorization` header, including blank/whitespace, is treated as authenticated intent and is rejected unless valid; it never silently downgrades to LOGIN. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/presentation/http/OAuthAccountController.java`, `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/AuthRateLimitFilter.java`, `AuthRateLimiter.java`, `GlobalExceptionHandler.java` | Add bounded unlink limits of 10 requests/15 minutes per IP and 5 requests/15 minutes per authenticated session, before password verification/use-case work. 429 responses include `Retry-After`, `Cache-Control: no-store` and the OAuth `Referrer-Policy`; the existing core limiter behavior is unchanged. |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/OAuthTransportHeadersFilter.java` | Ensures OAuth transport responses that are rejected before MVC advice (for example exact-Origin/CORS failures) still carry `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. Scope is limited to OAuth/web/self-OAuth paths. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/presentation/http/oauth/OAuthCsrfTokenService.java` | Rejects any CSRF token whose encoded form is not exactly the expected 43 characters before Base64 decoding, bounding malformed-input work while preserving HMAC, expiry and future-time checks. |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/presentation/http/GoogleOAuthHttpIntegrationTest.java`, `IdentityServiceApplicationTests.java` | Real full-chain HTTP assertions now cover header attributes on success/callback/error responses, enabled route inventory and disabled handler absence, empty/present-invalid bearer rejection, duplicate-cookie CSRF rejection, and unlink 429/account preservation. |
| Thêm | `services/identity-service/src/test/java/com/weav/identity/presentation/http/oauth/OAuthCsrfTokenServiceTest.java`, `OAuthAccountControllerTest.java` | Direct tampered-signature, expired, future, oversized, duplicate-cookie and valid-token tests; controller-level proof that the sixth blocked unlink does not call password verification/use-case work. |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/SecurityConfigTest.java`, `AuthRateLimitFilterTest.java`, `GlobalExceptionHandlerTest.java` | Regression coverage for no wildcard/reflected CORS on core auth, DELETE IP admission, and OAuth session-throttle error headers. |
| Sửa | `docs/superpowers/plans/2026-09-09-identity-m3-google.md`, `services/identity-service/src/main/resources/application.properties` | Document the bounded unlink limits and keep the approved OAuth transport scope/configuration secret-free. |

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Focused D2 correction suite | `PASS: 37/0/0/0` | Full Spring security-chain HTTP tests, route inventory, signed-CSRF service cases, controller throttle test, security/error/filter tests; UTC with disposable Docker PostgreSQL/Valkey fixtures |
| Fresh full Identity regression (first run) | `271/0/1/0` | One unrelated `SmtpAuthMailSenderIntegrationTest` Mailpit delivery error under the long multi-context run; no OAuth test failed. Isolated SMTP test then passed `1/0/0/0`. |
| Fresh full Identity regression (rerun) | `PASS: 271/0/0/0` | Same direct Maven command with UTC and disposable Docker fixtures; final Surefire report aggregate is green. |
| Identity package build | `PASS` | Direct Maven 3.9.16 executable, `-Dmaven.compiler.fork=true -DskipTests package`; Spring Boot jar repackaged successfully (`BUILD SUCCESS`, 2026-09-10) |
| Whitespace/diff | `PASS` | `git diff --check` clean after this correction-log append; only the existing LF/CRLF working-copy warning was emitted |

### Handoff and limits

- D2 correction is complete and stops before D3. No web refresh/logout, cookie rotation, real browser/Google smoke, Gateway/native/mobile wiring, provider credentials, `.env`/secret reads or Neon mutation was performed.
- The shared worktree intentionally retains uncommitted/untracked Task6 through D2 WIP. The post-edit GitNexus graph is incomplete/critical due to those pre-existing and unindexed files; root owns final reindex and complete-diff review. No commit/push was made.
- No `helper_unknown_error: setup refresh had errors` occurred. No external worker or destructive cleanup was used.

## 39. D2 correction stop

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1, C2, D1 và D2 chưa commit trên codex/identity-m3; không commit/push` |
| Cần đọc trước khi tiếp tục | `§38, OAuthTransportHeadersFilter.java, OAuthCsrfTokenServiceTest.java, OAuthAccountControllerTest.java, GoogleOAuthHttpIntegrationTest.java, approved D3 scope` |

## 40. D3 web refresh/logout (2026-09-10)

### Scope and review

- Root opened only the approved D3 web transport slice: `POST /auth/web/refresh` and `POST /auth/web/logout`. Existing JSON `/auth/refresh` and `/auth/logout` contracts remain unchanged. Gateway, SPA, mobile/native and live Google/browser acceptance remain deferred.
- Before D3 edits, the explicit `Weav-identity-m3` GitNexus impacts for the existing production symbols (`OAuthController`, `OAuthWebProtection`, `SecurityConfig`, `AuthRateLimitFilter` and `AuthRateLimiter`) were already recorded as UNKNOWN/partial lower-bound results or target-not-found for new symbols, with no HIGH/CRITICAL result. Targeted source search corroborated the known consumers. A direct refresh attempt for the HTTP integration test target returned `EPERM: operation not permitted, realpath 'C:\Users\nhoan'`; no clean graph or unused-symbol claim is made for that runner limitation.
- The shared worktree’s incomplete post-edit graph remains a root review concern because pre-existing tracked changes and untracked M3 files are outside the base index. No files were reset, deleted, committed or pushed.

### D3 changes

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/presentation/http/oauth/OAuthWebProtection.java` | Added cookie-only refresh extraction with unique-cookie rejection and the shared exact 43-character opaque-token bound; added an exact-attribute refresh-cookie clear builder. Missing, duplicate, oversized and malformed values map to the generic authentication failure without exposing cookie material. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/presentation/http/OAuthController.java` | Added web refresh rotation and idempotent web logout using the existing `RefreshSessionUseCase`/`LogoutUseCase`. Exact Origin and signed double-submit CSRF run before cookie/session work; refresh emits access-only LOGIN JSON plus a rotated `HttpOnly; Secure; SameSite=Lax` cookie, while logout emits only a 204 and the exact clearing cookie. Dependency/transaction failure returns through existing sanitized handling before any clear-cookie response is built. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/SecurityConfig.java`, `AuthRateLimitFilter.java`, `AuthRateLimiter.java` | Added only the two approved public POST routes and bounded IP admission: web refresh 30/minute and web logout 10/15 minutes, both with `Retry-After`, no-store and no-referrer on 429. Cookie routes deliberately require clients to omit `Authorization`; a present malformed bearer is rejected by the security chain rather than downgraded to anonymous LOGIN. |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/presentation/http/GoogleOAuthHttpIntegrationTest.java` | Full Spring security-chain proof with signed local Google token/JWK fixture, real Valkey and PostgreSQL: login-to-cookie, one rotation, old-token replay denial, current access validity, logout/revocation/idempotence, concurrent one-winner refresh, expired/disabled sessions, duplicate/malformed/oversized and body-only rejection, Origin/CSRF rejection before mutation, malformed bearer rejection, exact cookie/header attributes and no refresh material in JSON. |
| Sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/AuthRateLimitFilterTest.java`, `OAuthCsrfTokenServiceTest.java` | Added direct refresh/logout rate-limit assertions and canonical decoded-MAC tampering coverage; the latter flips a decoded signature byte and re-encodes it, avoiding a non-canonical Base64-only failure. |
| Sửa | `packages/contracts/http/auth/openapi.yaml`, `packages/contracts/http/auth/README.md` | Documented only `/auth/web/refresh` and `/auth/web/logout`, cookie-only input, exact Origin/CSRF and omit-Authorization convention, access-only response, cookie attributes, safe error behavior and the two bounded IP limits. Core JSON routes remain documented separately. |

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| D3 focused HTTP integration | `PASS: 10/0/0/0` | `GoogleOAuthHttpIntegrationTest` against the full Spring chain with disposable PostgreSQL 18 + Valkey 8 and the signed local Google adapter fixture; includes real cookie rotation, replay, revocation, expiry/disable, malformed bearer and concurrency assertions |
| Final full Identity regression | `PASS: 275/0/0/0` | Direct Maven 3.9.16 executable with `-Duser.timezone=UTC`; disposable Docker PostgreSQL/Valkey/Mailpit fixtures; expected migration, constraint, dependency-failure and shutdown/reconnect warnings did not fail the run |
| Identity package build | `PASS` | Direct Maven 3.9.16 `-DskipTests package`; Spring Boot jar repackaged successfully (`BUILD SUCCESS`, 2026-09-10) |
| `git diff --check` | `PASS` | Clean after the D3 work-log append; Git emitted only the existing shared `application.properties` LF/CRLF working-copy warning |

An intermediate focused attempt briefly returned the intentional `429` start limit after a separate test flow added one extra login from the shared test address. The expiry/disabled assertions were folded into the existing refresh flow, and the final focused run above passed without changing production limits or behavior.

### Real-browser/Google acceptance checklist (pending, no live claim)

Required user-side configuration names only; values and secrets stay out of chat/logs:

- `weav.oauth.google.client-id`
- `weav.oauth.google.client-secret` (secret value supplied out-of-band)
- `weav.oauth.google.issuer-uri`
- `weav.oauth.google.redirect-uri`
- `weav.oauth.web.return-target-uri`
- `weav.oauth.web.allowed-origins[0]`
- `weav.jwt.refresh-expires-in` (must match the configured refresh-session lifetime)

Run the Identity service with the project’s local Maven/Docker startup path and a registered Google callback/return target; do not paste `.env` contents or command-line secret values. For deterministic `Secure` cookie proof, use local HTTPS for the Identity and web return origins. Exercise only these route names: `POST /auth/oauth/google/start`, Google callback, `POST /auth/oauth/exchange`, `GET /users/me`, `POST /auth/web/refresh`, and `POST /auth/web/logout`. Record sanitized statuses, route names and cookie attribute names only. Do not save provider codes, ID/access/refresh tokens, cookies, email addresses or sensitive screenshots. Missing Google client registration, a disposable test account, TLS and a real system browser are the remaining user actions; Gateway/app/mobile client wiring remains deferred.

### Handoff and limits

- D3 web refresh/logout is implemented and stops here for root review. The full HTTP proof is server-side; no real Google account, Playwright/system-browser, HTTPS `Secure`-cookie acceptance or production provider credential was used or claimed.
- The refresh route reads only the uniquely-present cookie, never a request body. Successful refresh rotates the existing session and returns no refresh value/expiry in JSON. Logout clears the cookie only after the existing logout use case returns; Origin/CSRF/cookie admission failures do not clear it.
- No `.env`, secret store, Neon or canonical checkout was read or changed. No commit/push or destructive cleanup was performed. No `helper_unknown_error: setup refresh had errors` occurred.

## 41. D3 stop

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1, C2, D1, D2 và D3 chưa commit trên codex/identity-m3; không commit/push` |
| Cần đọc trước khi tiếp tục | `§40, OAuthController.java, OAuthWebProtection.java, AuthRateLimitFilter.java, GoogleOAuthHttpIntegrationTest.java, approved D4 scope` |

## 42. M3 configuration bridge (2026-09-10)

### Scope and review

- Root opened only the bounded configuration reconciliation after D3: preserve the existing public `.env.example` Google variable names, forward them through the real Compose startup path, supply non-secret local web defaults, and make optional OAuth disabled/partial behavior deterministic. No OAuth use case, HTTP route, cookie, provider, Gateway, mobile or browser behavior was changed in this slice.
- Before existing-symbol edits, the bound `Weav-identity-m3` GitNexus index at `T:\Weav\tmp\identity-m3-worktree` reported `UNKNOWN`/partial lower-bound impacts for `OAuthProperties`, `OAuthApplicationConfig`, `GoogleOidcAdapter` and `ValkeyOAuthTransactionStore`, with no HIGH/CRITICAL result. The controller target was not indexed. Targeted source search and the full Spring tests corroborated the known consumers; UNKNOWN was not treated as unused. The CLI fallback still hit the known Windows `EPERM` realpath limitation, so no clean post-edit graph gate is claimed.

### Configuration bridge

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Thêm | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/OAuthEnabledCondition.java` | Shared condition for the Google provider, Valkey OAuth store, coordinator and both OAuth controllers. Blank mode auto-enables only when a client ID or secret is present; explicit `false` disables all optional OAuth beans/routes; explicit `true` enables validation and rejects incomplete configuration. |
| Sửa | `services/identity-service/src/main/java/com/weav/identity/infrastructure/config/OAuthProperties.java` and OAuth configuration annotations | Added the non-secret `enabled` mode and aligned every optional OAuth bean/controller to the same condition. Empty template values therefore leave the core application bootable with no OAuth routes/providers; partial credentials fail closed through existing validation. |
| Sửa | `services/identity-service/src/main/resources/application.properties` | Maps `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI`; fixes issuer to `https://accounts.google.com`; adds non-secret local defaults for `OAUTH_WEB_RETURN_TARGET_URI` and `OAUTH_WEB_ALLOWED_ORIGIN`. |
| Sửa | `compose.dev.yml` | Explicitly forwards the six OAuth/web environment names from the root Compose environment into `identity-service`; no `env_file` or secret copy was added. |
| Sửa | `.env.example` | Keeps the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` names, adds blank `GOOGLE_OAUTH_ENABLED` plus non-secret localhost return/origin placeholders, and documents the mode semantics. |
| Sửa | `docs/development/SETUP.md` | Documents the exact names, Compose interpolation path, direct-Maven limitation (root `.env` is not loaded automatically), safe startup commands and deferred real-provider/browser acceptance. |
| Thêm/sửa | `services/identity-service/src/test/java/com/weav/identity/infrastructure/config/OAuthEnvironmentBindingTest.java`, `OAuthEnvironmentDisabledBindingTest.java`, `OAuthPropertiesTest.java`, `IdentityServiceApplicationTests.java`, OAuth integration tests | Covers production property binding with dummy values, empty template values, explicit-off/auto/explicit-on/invalid modes, disabled route/provider inventory and enabled wiring under the full test contexts. |

Effective names and mappings are:

- `GOOGLE_OAUTH_ENABLED` → `weav.oauth.enabled` (`blank` = auto, `false` = off, `true` = complete configuration required).
- `GOOGLE_CLIENT_ID` → `weav.oauth.google.client-id`.
- `GOOGLE_CLIENT_SECRET` → `weav.oauth.google.client-secret`.
- `GOOGLE_REDIRECT_URI` → `weav.oauth.google.redirect-uri` (default `http://localhost:8081/auth/oauth/google/callback`).
- `OAUTH_WEB_RETURN_TARGET_URI` → `weav.oauth.web.return-target-uri` (default `http://localhost:5173/auth/callback`).
- `OAUTH_WEB_ALLOWED_ORIGIN` → `weav.oauth.web.allowed-origins[0]` (default `http://localhost:5173`).

Compose users must invoke `docker compose --env-file .env -f compose.yml -f compose.dev.yml ...`; Compose interpolation then forwards these names into the container. Direct Maven/Spring startup does not load the repository-root `.env`; inject the same names through the shell or a secret manager without putting secret values on the command line. The tracked template contains placeholders only.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Focused configuration tests | `PASS: 19/0/0/0` | `OAuthPropertiesTest` plus production `application.properties` binding with dummy environment values and an empty-template context; expected validation warnings for intentional partial fixtures did not fail the run |
| Disabled full application context | `PASS: 4/0/0/0` | Docker PostgreSQL 18/UTC; explicit OAuth-off context had no optional provider/store/coordinator/controller inventory while core booted |
| Enabled Valkey/PostgreSQL wiring | `PASS: 1/0/0/0` | Real Valkey 8 + PostgreSQL 18; exactly one configured provider/store/coordinator wiring path |
| Full OAuth HTTP regression | `PASS: 10/0/0/0` | Full Spring security chain with real Valkey/PostgreSQL and local signed provider fixture |
| Full Identity Maven regression | `PASS: 282/0/0/0` | Direct Maven 3.9.16 executable, UTC, disposable Docker PostgreSQL/Valkey/Mailpit/Testcontainers; no OAuth/config failures |
| Compose template validation | `PASS` | `docker compose --env-file .env.example -f compose.yml -f compose.dev.yml config --quiet`; profile model also confirmed all six forwarding names without printing values |
| Whitespace/diff | `PASS` | `git diff --check`; only the existing shared LF/CRLF working-copy warning was emitted |

### Handoff and limits

- Actual `.env`/secret files, Neon, provider credentials and canonical checkout were not read or changed. Dummy values were used only in test process properties; no secret value was printed or logged.
- No real Google account, system browser, HTTPS Secure-cookie acceptance or production startup was performed or claimed. The configuration bridge is not an M3 completion claim; root review and the separately pending real-provider/browser acceptance remain required.
- No commit, push, external worker or destructive cleanup was used. No `helper_unknown_error: setup refresh had errors` occurred.

## 43. M3 browser acceptance fixture (2026-09-10)

### Scope and graph review

- Root opened only a local, opt-in browser acceptance harness for the already implemented M3 web flow. It is test-only: no production SPA, Gateway, mobile/native client, Google account, provider credential, `.env` read, Neon mutation or canonical-checkout change was performed.
- Before editing the existing signed-provider test fixture, the explicit `Weav-identity-m3` GitNexus upstream impact returned target-not-found with `risk: UNKNOWN` because the fixture was not indexed. Targeted source search and the existing Google HTTP tests corroborated its only test-fixture consumers; no HIGH/CRITICAL result was inferred from the empty graph response. After the harness edits, the explicit worktree-aware `detect_changes(scope=all)` call returned `risk_level: critical`, `changed_count: 92`, `affected_count: 39` and `changed_files: 22` for the shared M3 worktree. This is the known lower-bound/incomplete graph over the large uncommitted Task6-D3 WIP (untracked files are outside the base index), not a clean browser-slice gate; root owns final refresh/reindex and complete-diff review.

### Test-only harness

| Loại | Đường dẫn | Thay đổi chính |
| --- | --- | --- |
| Sửa test fixture | `services/identity-service/src/test/java/com/weav/identity/infrastructure/security/oauth/SignedGoogleProviderFixture.java` | Added a local-only `/authorize` redirect that signs the existing deterministic Google ID-token/JWK fixture and returns only an opaque test code plus the supplied state; no real provider account or network is used. |
| Thêm opt-in integration test | `services/identity-service/src/test/java/com/weav/identity/presentation/http/M3BrowserAcceptanceFixtureTest.java` | Starts disposable PostgreSQL and Valkey, Identity on `localhost:8081`, a static harness on `localhost:5173`, test-only cookie/state probes, and a bounded result receiver. The class is disabled unless `-Dm3.browser.enabled=true`. It asserts sanitized statuses, zero user/session/OAuth rows before exchange, and exactly one of each after exchange through the full Spring chain. |
| Thêm static browser page | `services/identity-service/src/test/resources/m3-browser-harness/index.html` | Uses Web Crypto S256 verifier material in `sessionStorage`, removes the callback query with `history.replaceState` before exchange, omits `Authorization` for LOGIN, keeps access material only in memory, requests CSRF with credentials, and emits only bounded status/boolean fields. It never renders tokens, cookies, provider codes, email addresses or query values. |
| Thêm local runner | `tests/e2e/m3-browser-harness/run-cdp.mjs` | Launches the installed Chrome binary with a disposable profile and DevTools port, clicks the fixture, waits for the sanitized result and captures a proof screenshot. `--no-sandbox` is scoped to this isolated headless test process because the managed Windows sandbox otherwise left the renderer unable to answer CDP; production security/cookie settings are unchanged. |

### Browser evidence

The opt-in test was run with Maven 3.9.16, UTC and disposable Docker PostgreSQL/Valkey containers. The actual browser runner exited successfully against `http://localhost:5173` and `http://localhost:8081`; its sanitized result was:

`start=200&callbackUrlClean=true&login=200&loginOutcome=LOGIN&accessOnly=true&loginAuthorizationOmitted=true&refresh=200&refreshAccessOnly=true&logout=204&afterLogout=401&correlationHttpOnly=true&refreshHttpOnly=true&csrfVisible=true&preExchangeEmpty=true&postExchangePersisted=true&probeTimedOut=false`

This proves the local browser semantics for the signed fixture, including credentialed cross-origin calls, Secure localhost cookie storage/sending, JavaScript invisibility of the correlation and refresh cookies, visible double-submit CSRF token, callback query removal before exchange, zero persisted account/session/OAuth rows before exchange, exactly one of each after exchange, access-only LOGIN/refresh bodies, one refresh/logout path and post-logout replay rejection. The sanitized screenshot is generated at `services/identity-service/target/m3-browser-harness/browser-proof.png`; it contains only the fixture heading and the fields above. The in-app browser connector was unavailable, so the proof used the installed Chrome binary through its local CDP endpoint; no browser extension, global profile or certificate store was changed.

### Verification

| Hạng mục | Kết quả | Evidence/limit |
| --- | --- | --- |
| Browser fixture integration | `PASS: 1/0/0/0` | `M3BrowserAcceptanceFixtureTest` with full Spring security, disposable PostgreSQL/Valkey and signed local provider; no real Google/Neon/.env values; asserts pre/post persistence state |
| Actual browser runner | `PASS` | Installed headless Chrome, isolated user-data directory and local DevTools protocol; no token/cookie/query value printed or captured |
| Browser proof screenshot | `PASS` | Sanitized `target/m3-browser-harness/browser-proof.png` manually inspected; no secret-bearing UI or URL query shown |
| Full Identity Maven regression | `PASS: 283/0/0/1` | Direct Maven 3.9.16 with UTC and disposable Docker fixtures; the one skipped test is the opt-in browser class when the browser property is absent |
| Identity package build | `PASS` | Direct Maven 3.9.16 `-DskipTests package`; Spring Boot jar repackaged successfully |
| Whitespace/diff | `PASS` | `git diff --check` clean; untracked harness files also inspected for trailing whitespace; existing shared LF/CRLF warnings remain only |

### Real Google handoff checklist and limits

- Keep the existing environment variable names: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_WEB_RETURN_TARGET_URI`, `OAUTH_WEB_ALLOWED_ORIGIN` and optional `GOOGLE_OAUTH_ENABLED`. Values remain out-of-band; never paste `.env` contents or put secrets in command arguments/logs.
- Register the exact non-secret callback `http://localhost:8081/auth/oauth/google/callback` and browser return/origin `http://localhost:5173` for local testing. Use HTTPS for non-localhost Secure-cookie testing. A real Google login/consent and a disposable test account are still required for live-provider acceptance; this fixture is not a Google claim.
- Use the documented Compose forwarding path with the existing root `.env`; direct Maven/Spring does not load that file automatically. Do not copy the file into the worktree. Exercise only the approved start/callback/exchange, self-user, web refresh and web logout routes, and record statuses/attribute names only.
- No real Google account, provider network, production browser profile, HTTPS certificate setup, Gateway/app/mobile wiring or live Secure-cookie smoke was performed. No commit or push was made, and no `helper_unknown_error: setup refresh had errors` occurred.

## 44. Browser acceptance stop

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-10` (Asia/Saigon) |
| Trạng thái worktree | `Task6, Slice A, B1, B2, C1, C2, D1, D2, D3, configuration bridge and browser harness chưa commit trên codex/identity-m3; không commit/push` |
| Cần làm tiếp | Root review complete diff, refresh/reindex GitNexus and run the user-assisted real Google/system-browser smoke; do not treat the local signed fixture as live-provider evidence |

## 45. Live Google browser handoff preparation (2026-09-10)

### Scope and safety boundary

- Prepared a separate, local-only browser handoff harness for the real-provider smoke. This slice adds only `tests/e2e/m3-browser-harness/live-compose.yml`, `live.html` and `serve-live.mjs`; it does not add production frontend/Gateway/mobile behavior or a test mutation endpoint.
- The existing root `.env` was checked only for path existence/metadata and was supplied to Compose through `--env-file`; its contents and all Google secret values were not read, printed, copied, logged or committed. Neon and the canonical checkout were not used.
- No existing production symbol was edited in this slice, so no new upstream impact walk was required. The prior worktree-aware graph result remains incomplete over the shared uncommitted M3 WIP; root owns the final reindex/detect-changes review. No HIGH/CRITICAL impact was inferred for these new test-only files.

### Isolated runtime

- Compose project: `weav-identity-m3-live`.
- Owned local endpoints: Identity `http://localhost:8081`, browser harness `http://localhost:5173`, PostgreSQL host port `55432`, Valkey host port `56379`.
- PostgreSQL and Valkey are disposable local services. Identity uses the already-built worktree jar and receives the existing `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` values only through Compose interpolation; database/Valkey settings are explicitly local and do not point at Neon.
- `docker compose --env-file T:\Weav\.env -p weav-identity-m3-live -f tests/e2e/m3-browser-harness/live-compose.yml config --quiet` passed without printing resolved values. The dedicated services started healthy, and `/actuator/health/readiness` returned HTTP 200.
- A sanitized readiness request to `POST /auth/oauth/google/start` returned HTTP 200 with only these checks: provider host canonical, callback exact, response type `code`, and transaction handle present. This caused no account/session mutation; no provider code, state, nonce, client secret or raw authorization URL was recorded.

### Browser handoff

- The static server is running at `http://localhost:5173`; it serves only the local harness and `/auth/callback`. The page starts only after the user clicks **Continue with Google**.
- The page stores the verifier under a transaction-scoped `sessionStorage` key, removes the handoff query with `history.replaceState` before exchange, omits `Authorization` for LOGIN, keeps access material in memory, and displays only bounded status/boolean fields. It does not show email addresses, provider codes, OAuth query values, cookies, tokens or raw error URLs.
- The CUA browser connector exposed no browser surface in this environment, so no automated login or consent was attempted. Use a normal visible user browser for the live handoff; do not use the prior fixture-only `run-cdp.mjs` runner or an automated Google credential flow.
- Current state is **prepared; real Google login/consent and account mutation have not started**. The user must manually open the harness, click the button, complete Google login/consent, and review the sanitized result. The registered non-secret values must remain exactly `http://localhost:8081/auth/oauth/google/callback` and `http://localhost:5173`.

### Reproducible commands and limits

```text
docker compose --env-file T:\Weav\.env -p weav-identity-m3-live -f tests/e2e/m3-browser-harness/live-compose.yml up -d
node tests/e2e/m3-browser-harness/serve-live.mjs
```

Open `http://localhost:5173` in a normal user-visible browser and perform the manual Google step. To stop only these owned resources later:

```text
docker compose --env-file T:\Weav\.env -p weav-identity-m3-live -f tests/e2e/m3-browser-harness/live-compose.yml down
```

- No real Google account, consent, HTTPS certificate setup, system-browser cookie acceptance, production profile, commit or push was performed or claimed. `git diff --check` is clean apart from the pre-existing shared LF/CRLF warnings. No `helper_unknown_error: setup refresh had errors` occurred.

## 46. Live harness diagnostic correction (2026-09-10)

### Reported failure and bounded correction

- The first user-assisted attempt rendered `{status:"failed", callbackUrlClean:false}`. The harness catch block had hard-coded that fallback and therefore discarded the actual stage, HTTP status and URL-clean result; it did not prove that callback query cleanup failed. The Identity root path returning `401` is the expected protected response and is not OAuth callback evidence.
- Updated only the local `live.html` test harness. It now emits a fixed stage enum (`start`, `provider-return`, `csrf`, `exchange`, `current-user`), numeric HTTP status (`0` means no HTTP response), an allowlisted fixed error code, the measured `callbackUrlClean` boolean, and boolean-only presence diagnostics for transaction/handoff/verifier material. It never renders raw callback/provider values or response bodies.
- Provider cancellation and provider-unavailable outcomes are recognized before query cleanup, then the query is removed and only the fixed outcome is displayed. Missing verifier after a new tab/reload is reported as `verifier_missing`; exchange failures are never labeled login-complete.
- Restarted only the owned static harness server so it would load the updated page; the dedicated Identity/PostgreSQL/Valkey project was not restarted or altered. No real Google flow was repeated.

### Sanitized diagnostic evidence

| Scenario | Sanitized result |
| --- | --- |
| Callback with opaque simulated transaction/handoff and no session verifier | `status=failed`, `stage=provider-return`, `httpStatus=0`, `errorCode=verifier_missing`, `callbackUrlClean=true`, `transactionPresent=true`, `handoffPresent=true`, `verifierPresent=false` |
| Callback with fixed cancellation outcome | `status=provider-cancelled`, `stage=provider-return`, `httpStatus=0`, `errorCode=provider_cancelled`, `callbackUrlClean=true` |
| Harness script validation | `new Function` parse passed; no trailing whitespace in harness; `git diff --check` passed with only the existing shared LF/CRLF warnings |

### CORS/runtime diagnosis

- Owned runtime checks: readiness `200`; `/` `401`; preflight `/auth/oauth/google/start` `200` with exact configured origin and credentials; preflight `/auth/oauth/exchange` `200` with exact origin/credentials and requested headers; `/auth/web/csrf` returned `200` with exact origin/credentials.
- Preflight `/users/me` returned `200` but no CORS allow-origin/credentials/method/header response. This matches the production `OAuthCorsConfiguration`, which intentionally registers only OAuth/web and self-OAuth paths. The harness therefore treats a successful exchange separately from the optional current-user fetch: if exchange is `200` but the browser cannot read `/users/me`, it reports `status=exchange-succeeded`, `stage=current-user`, `errorCode=current_user_cors_or_network`, and preserves `exchangeHTTP=200`.
- No production CORS broadening was made. The current-user check is diagnostic only; changing core `/users/me` CORS would be a separate reviewed contract decision.

### Handoff state

- The harness remains ready at `http://localhost:5173`. On retry, the user should manually click **Continue with Google** in a normal visible browser and provide only the sanitized result object if the flow stops. Do not provide callback URLs, tokens, cookies, query values or Google account details.
- No real Google login/consent/account mutation, `.env` read, Neon access, canonical-container action, commit or push was performed. No `helper_unknown_error: setup refresh had errors` occurred.

## 47. Narrow current-user CORS and final live-session harness handoff (2026-09-10)

### Observed live-provider boundary

- The user reported a real Google retry with `exchangeHTTP=200`, `accessOnly=true` and `callbackUrlClean=true`. This is user-provided live-provider evidence and was not replayed or independently logged by the worker. The same report showed `currentUserHTTP=0` and `current_user_cors_or_network`; the earlier harness diagnostic correctly distinguished exchange success from the blocked current-user read.
- GitNexus impact for the existing `OAuthCorsConfiguration` symbol was attempted before the production edit but the Windows runner failed with `EPERM: operation not permitted, realpath 'C:\\Users\\nhoan'`. This is an unresolved/incomplete graph result, not a clean impact gate. Manual corroboration confirmed `SecurityConfig` consumes the global CORS source and the route mappings below are the only changed production CORS scope; root owns the final refresh/reindex and graph review. No HIGH/CRITICAL impact result was available to dismiss.

### Bounded production correction

- `OAuthCorsConfiguration` now adds an exact `/users/me` CORS mapping for only `GET` and `OPTIONS`, the configured allowlisted web origin(s), `Authorization`/`Accept` request headers and credentials. Existing OAuth/web/self-OAuth mappings are unchanged; no wildcard, `/users/**`, core login, core refresh/logout or authentication-guard change was made.
- `GoogleOAuthHttpIntegrationTest` now verifies allowed same-origin GET/preflight, rejects requested POST and malicious origins, and confirms an unrelated `/users/me/sessions` preflight receives no broad CORS grant.

### Verification and owned runtime

| Check | Result | Evidence/limit |
| --- | --- | --- |
| Focused OAuth HTTP tests | `PASS: 10/0/0/0` | `GoogleOAuthHttpIntegrationTest` |
| Core security/auth regression | `PASS: 6/0/0/0` | `SecurityConfigTest,CoreAuthHttpIntegrationTest` |
| Full Identity Maven regression | `PASS: 283/0/0/1` | Direct Maven 3.9.16, UTC, disposable Docker fixtures; one opt-in browser test skipped without its property |
| Identity package | `PASS` | Direct Maven 3.9.16 `-DskipTests package`; worktree jar repackaged |
| Harness syntax/whitespace | `PASS` | `live.html` JavaScript parsed with `new Function`; `git diff --check` clean apart from existing shared LF/CRLF warnings |
| Owned live service | `PASS` | Recreated only `weav-identity-m3-live` Identity with existing env forwarding and the rebuilt jar; disposable PostgreSQL/Valkey were not reset or replaced |
| Sanitized route probes | `PASS` | Readiness `200`; exact-origin `/users/me` preflight `200` with GET/Authorization/credentials; missing bearer GET `401` with CORS; POST preflight and malicious origin `403`; unrelated `/users/me/sessions` has no CORS grant |

### Browser handoff state

- `live.html` now exposes a manual **Run web session checks** button after a successful exchange. It keeps the access token only in memory, checks only boolean refresh-cookie visibility, then runs CSRF → web refresh → current-user with the refreshed bearer → web logout → post-logout current-user rejection. It reports only numeric statuses and fixed booleans/error codes; no token, cookie, query, response body or account data is stored or displayed.
- The owned static harness was restarted at `http://localhost:5173`; the Identity stack remains available at `http://localhost:8081`. The user should open the harness in a normal visible browser, retry one Google login, then click **Run web session checks** after the sanitized exchange result. The worker has not repeated Google login/consent or claimed the final live session sequence; the next result must come from the user's browser.
- No `.env` contents, credentials, cookies, tokens, Neon data or canonical containers were read or changed. No commit, push, external worker or destructive cleanup was used, and no `helper_unknown_error: setup refresh had errors` occurred.

## 48. User-reported live Google session acceptance (2026-09-10)

- The user completed the real Google browser flow and reported the following sanitized result: `exchangeHTTP=200`, `currentUserHTTP=200`, `accessOnly=true`, `callbackUrlClean=true`, `refreshHTTP=200`, `afterRefreshCurrentUserHTTP=200`, `logoutHTTP=204`, `postLogoutHTTP=401`, and the HttpOnly refresh cookie was JavaScript-invisible at all three checkpoints (before refresh, after refresh, after logout). This is user-reported live-provider/browser evidence; no token, cookie value, callback query, account detail or raw browser trace was collected.
- The local signed-provider browser fixture remains separate evidence: its earlier sanitized browser run passed the full disposable PostgreSQL/Valkey flow with `start=200`, `login=200`, `refresh=200`, `logout=204`, `afterLogout=401`, HttpOnly-cookie assertions and pre/post persistence assertions. It is not counted as real Google evidence.
- Latest Identity Maven totals remain `283` tests run, `0` failures, `0` errors, `1` skipped (the opt-in browser fixture when not enabled); package build and focused CORS/security checks also passed. No code scope was expanded after the narrow `/users/me` CORS correction.
- Final graph/index review and commit decision remain root-owned. This worklog records no commit or push, and no secret files, generated artifacts, Neon data or user containers were touched.
