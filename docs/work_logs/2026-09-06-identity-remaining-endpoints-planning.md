# Nhật ký 2026-09-06 — Identity remaining endpoints planning

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày / timezone | 2026-09-06 / Asia/Saigon |
| Repository | T:\Weav |
| Nhánh / HEAD đầu session | feat/identity-service / 85c0d01 |
| Worktree đầu session | Sạch |
| Người thực hiện | Codex coordinator; agent identity_inventory điều tra code chỉ đọc |
| Reviewer | Coordinator self-review; agent rà plan so với code |
| Phạm vi | Đọc trạng thái Identity và viết plan endpoint còn lại |
| Trạng thái | Plan v1 hoàn thành; chưa triển khai |

## 2. Tóm tắt điều hành

- Đã đối chiếu ba tài liệu người dùng chỉ định, auth README/OpenAPI context và source hiện tại.
- Core auth hiện đã có register/login/refresh/logout/current-user. Log core-auth ghi 62 test pass với PostgreSQL 18 và real HTTP; đó là evidence ngày 05/09, không phải test mới trong session này.
- Đã đọc Notion Identity schema, class ownership và intended stack; lấy yêu cầu Google Docs trong phạm vi đến hết chương 3.
- Viết plan có baseline, quyết định đã xác nhận, endpoint catalog, transaction/recovery/OAuth policies, 11 task, file map, commands, acceptance gates và Neon test policy.

| Hạng mục | Kết quả |
| --- | --- |
| Source/document review | Hoàn thành |
| Compile/test/runtime | Không chạy; task chỉ lập kế hoạch |
| DB/migration/Neon | Không kết nối hoặc ghi dữ liệu |
| Notion/Google Docs | Chỉ đọc; không sửa tài liệu ngoài workspace |
| Code/config/secret | Không thay đổi |
| Commit/PR | Không tạo |

## 3. Mục tiêu và phạm vi

Mục tiêu: xác định đã tới đâu, lập plan cho user profile, admin user controls, OAuth, quên/đổi mật khẩu, request/verify OTP và session/avatar liên quan.

Trong phạm vi session: đọc repository, nguồn nghiệp vụ, hướng dẫn skills; hỏi các quyết định có ảnh hưởng; thêm plan và work log. Không implement endpoint, deploy, apply migration hay chạy email thật.

Tiêu chí:
- [x] Phân biệt readiness cũ với implementation mới.
- [x] Ghi lựa chọn người dùng và những dependency kỹ thuật còn phải có.
- [x] Endpoint permissions/status/shape và acceptance theo milestone được mô tả.
- [x] Bảo toàn mọi file có sẵn và trạng thái Git.
- [x] Ghi giới hạn verification trung thực.

## 4. Bối cảnh và nguồn sự thật

Các file đã đọc:
- docs/work_logs/2026-09-05-identity-core-auth.md
- docs/superpowers/specs/2026-09-05-identity-core-auth-design.md
- docs/work_logs/2026-09-05-identity-readiness.md
- packages/contracts/http/auth/README.md
- docs/work_logs/log_template.md và docs/development/SETUP.md

Source đã kiểm tra: Identity controllers/use cases, User/UserSession/OAuthAccount ports và JPA mappings, security/config/POM, V1/V2 và test layout.

Google Docs: connector trả export cả tài liệu; phân tích yêu cầu giới hạn trước heading chương 4 thực tế. Chỉ các yêu cầu WEAV rõ ràng của chương 1–3 được dùng; không dùng các đoạn thuật ngữ đề tài khác làm yêu cầu Identity.

Memory chỉ giúp tìm nguồn canonical model và nhận diện lỗi runner/GitNexus quen thuộc; current source/Notion/Git được kiểm tra lại. Không sửa memory.

## 5. Nhật ký session

| Việc | Kết quả |
| --- | --- |
| Read workspace/skills/memory registry | AGENTS, brainstorming, writing-plans, dispatching-parallel-agents, parallel-execution-optimizer, GitNexus exploring |
| Khởi chạy shell | Managed runner lỗi helper_unknown_error; escalated read-only commands hoạt động tại chính T:\Weav |
| Git status/history | Sạch; HEAD 85c0d01 trên feat/identity-service |
| Notion | Fetch self rồi content search do ai_search plan_required; schema/model/stack fetch thành công |
| Điều tra song song | Agent đọc code; coordinator đọc nguồn nghiệp vụ, chốt scope, viết plan |
| Google Docs | Xác nhận UC001–004, UC029–030 thuộc Identity; UC031–032 thuộc service khác |
| Hỏi người dùng | Nhận đủ ba lựa chọn, ghi tại mục 6 |
| Graph | Query FTS degraded; context lower-bound; impact User/GetCurrentUserUseCase UNKNOWN/partial |
| Viết tài liệu | Một plan và focused same-day log; không sửa source |
| Review | Rà endpoint matrix, existing paths, source conflicts, concurrency và provider dependencies; agent phát hiện hai điểm cần rõ hơn, đã sửa |

Independent review đã làm rõ hai điểm: Google chỉ xác minh local email khi provider authoritative và canonical email khớp; SMTP dùng bounded asynchronous delivery để không lộ account eligibility qua timeout của provider. Bổ sung acceptance tests và ghi rõ queue development không durable. Coordinator cũng làm rõ credential binding xuyên OTP/grant và reset cập nhật emailVerifiedAt trong cùng transaction.

Không cần workaround junction: escalated shell truy cập đúng repository hiện tại. Không cài claude-mem vì không cần cho task.

## 6. Quyết định

| Quyết định | Căn cứ / hệ quả |
| --- | --- |
| Profile + admin list/detail/status; không user deletion/admin creation | Người dùng xác nhận trực tiếp |
| Login vẫn hoạt động trước email verification | Người dùng xác nhận; thêm nullable verifiedAt additive |
| SMTP port + mail catcher | Người dùng xác nhận chưa chọn provider; SMTP production delivery còn dependency cấu hình |
| Neon được phép test | Người dùng xác nhận DB chỉ test; giữ fixture cleanup theo exact run IDs |
| Milestone end-to-end | Tránh bắt profile phải chờ Google/storage; mỗi mốc có HTTP evidence |
| User-first lock/recheck | Login hiện verify trước transaction; tránh login/reset/disable và stale profile overwrite races |
| OTP Valkey + emailVerifiedAt PostgreSQL | Khớp temporary-state boundary; schema field mới là đề xuất cần đồng bộ source model khi implement |
| Google explicit linking | Local register chưa chứng minh email ownership; không auto-link bằng email bằng nhau |
| Backend/core acceptance tách client delivery | Browser cookies/CSRF/CORS/Gateway chưa được giải quyết bởi core tests |

Ngưỡng TTL/rate-limit, OAuth transport, một Google account/user, admin-target guard và avatar limits là đề xuất kỹ thuật của plan, không được ghi nhầm là quyết định người dùng đã duyệt từng chi tiết.

## 7. Thay đổi thực hiện

### 7.1 Code/hành vi
Không thay đổi. Plan mô tả hành vi tương lai.

### 7.2 Dữ liệu/schema
Không migration chạy. Đề xuất V3 email_verified_at nullable và V4 user/provider uniqueness; giữ V1/V2. V4 phải chọn lại số nếu HEAD thay đổi trước implementation.

### 7.3 Hạ tầng/dependency
Không cài dependency, không đọc/ghi .env. Plan ghi SMTP, Valkey và OAuth2 Client runtime integration sẽ làm theo từng mốc.

### 7.4 API/security/observability
Chỉ mô tả endpoint contract, active-session/current-role checks, password/session revocation, generic recovery errors, atomic OTP và no-secret logging.

## 8. Files ảnh hưởng

| Loại | Path | Mục đích |
| --- | --- | --- |
| Add | docs/superpowers/plans/2026-09-06-identity-remaining-endpoints.md | Plan v1 và acceptance |
| Add | docs/work_logs/2026-09-06-identity-remaining-endpoints-planning.md | Bối cảnh và handoff |

## 9. Kiểm tra và evidence

- git status --short và git log -4 --oneline: baseline sạch, 85c0d01; log cũ “uncommitted” đã stale.
- Existing test commands và tên suite xác nhận từ service-local mvnw.cmd/POM/test source; không chạy lại tests.
- Source confirms OAuthAccountRepositoryAdapter và SpringDataOAuthAccountRepository rỗng; không coi domain/JPA scaffolds là OAuth hoạt động.
- Source confirms SecurityConfig dùng authenticated cho generic protected routes; current-user/session check hiện chỉ được use case cụ thể thực hiện; admin current-role enforcement chưa có.
- GitNexus Weav index theo agent inventory khớp HEAD, indexed 2026-09-06T04:03:28Z. FTS Windows dependency khiến query không trả flow; context GetCurrentUserUseCase có wiring/controller/test refs nhưng completeness lower-bound.
- Upstream impact User và GetCurrentUserUseCase: UNKNOWN, partial=true, 0 resolved callers/processes. Targeted rg + đọc source xác nhận consumers: UserController, IdentityApplicationConfig, application use cases, DTO/mappers/repositories và tests. Không diễn giải graph zero là safe.
- Whitespace/content/link checks trên hai tài liệu mới được chạy trước bàn giao; git diff --check dùng thêm --no-index cho untracked files.
- Không chạy detect_changes vì không commit và không sửa code symbol. Plan yêu cầu chạy lại trước implementation commits.

Giới hạn: chưa có fresh build, HTTP, SMTP, Google login, Valkey hay Neon evidence. Không dùng 62 pass lịch sử để tuyên bố endpoint mới đã hoạt động.

## 10. Rủi ro và blocker

| Mức | Vấn đề | Bước tiếp theo |
| --- | --- | --- |
| Cao khi implement | Reset/disable có thể race với session creation; stale user save có thể overwrite field khác | Làm Task 1 trước endpoint mutation, test DB concurrency |
| Cao khi implement | Auto-link bằng email chưa verified có thể gán nhầm account | Explicit password reauthenticated linking + provider subject |
| Trung bình | OTP cache consume và DB commit không atomic chung | Fail-closed, grant one-use, request OTP mới khi DB failure; ghi UX/test |
| Trung bình | Immediate revoke toàn hệ thống chưa có | M6 Gateway/downstream session validation gate |
| Dependency | Google client/redirects và avatar bucket chưa cấu hình | Cấu hình đúng mốc, không chặn M1/M2 catcher |
| Tooling | Graph UNKNOWN/partial và FTS degraded | Re-run impact/repair index ở implementation; manual inspection bổ sung |

## 11. Trạng thái bàn giao

Có thể bắt đầu khi có yêu cầu implementation: Task 0 baseline/contracts, rồi Task 1 concurrency/authorization foundation và M1 profile/session/password change.

Không cần hỏi lại ba lựa chọn scope/email/SMTP hoặc quyền dùng Neon test đã được người dùng cung cấp. Google credentials/bucket chỉ cần khi tới đúng dependency; dùng secret configuration, không paste vào chat.

Người tiếp nhận đọc plan, core contract, source model và git status trước sửa. Giữ boundary Identity/Workspace; cập nhật source model đồng thời nếu triển khai field mới. Mỗi milestone cập nhật test/runtime evidence và work log.

## 12. Tham chiếu

- [Plan](../superpowers/plans/2026-09-06-identity-remaining-endpoints.md)
- [Core auth log](2026-09-05-identity-core-auth.md)
- [Core design](../superpowers/specs/2026-09-05-identity-core-auth-design.md)
- [Notion Identity schema](https://app.notion.com/p/3bd8722217d580b7b5d3c26e86ffaab3)
- [Notion model](https://app.notion.com/p/3cd8722217d58188a279e4aed16b657e)
- [Google Docs, đến hết chương 3](https://docs.google.com/document/d/15b2BPSs9HFyN2Ki3spTWXw6To7_QpmWiAKm58qek5cA/edit?tab=t.0)

Google OIDC, Spring Security OAuth2 Login và OWASP recovery docs đã được mở để đối chiếu; link và phần áp dụng nằm trong plan. Không copy provider secrets hoặc toàn bộ tài liệu bên ngoài vào repository.

## 13. Kết thúc

Plan và log là hai file mới chưa commit. Không source/API/schema/runtime/remote-doc changes. Người dùng có thể review plan v1 và chọn milestone triển khai tiếp.

## 14. Follow-up — env mẫu cho người dùng tự cấu hình

- Yêu cầu: bổ sung .env.example để người dùng tự điền các dịch vụ ngoài.
- Baseline: .env.example đã có chỉnh sửa của người dùng thêm GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET. Giữ nguyên toàn bộ nội dung/giá trị có sẵn; không đọc hoặc sửa .env.
- Thêm GOOGLE_REDIRECT_URI theo callback local của plan; SMTP host/port/auth/TLS/from với default mail catcher; OTP_HMAC_SECRET rỗng; AVATAR_S3 endpoint/region/bucket/credentials/path-style.
- Comment nêu rõ đây là cấu hình chuẩn bị cho milestone tiếp theo, chưa được runtime sử dụng. SMTP thật cần thay host/port và bật TLS theo provider; localhost chỉ dành cho chạy service trên host.
- GitNexus upstream impact .env.example tại repo Weav: target không có trong index, risk UNKNOWN, không có caller/process count khả dụng. Targeted search trong source/Compose không tìm thấy consumer của các biến mới. Thay đổi chỉ env mẫu, không thay symbol/runtime.
- Verification: so sánh prefix xác nhận nội dung trước chỉnh sửa được bảo toàn; không trùng tên biến; git diff --check đạt. Không chạy application tests vì không sửa code. Không commit.
- Files thay đổi trong follow-up: .env.example và log này. Plan giữ nguyên.

## 15. Follow-up — Gmail App Password và Cloudflare R2

- Người dùng xác nhận dùng Google App Password cho SMTP, Cloudflare R2 cho storage và đã chọn OTP secret riêng. Các lựa chọn provider này thay thế trạng thái chưa chọn provider trong plan ban đầu; mail catcher vẫn là test dependency.
- Chỉnh .env.example: smtp.gmail.com:587, auth=true, STARTTLS enabled/required=true, implicit SSL=false; hướng dẫn full-email username, App Password và sender cùng email hoặc verified alias.
- R2: giữ AVATAR_S3 keys tương thích adapter S3, region=auto, path-style=true; hướng dẫn endpoint S3 của dashboard, bucket và R2 S3 access-key pair. Không dùng public r2.dev URL làm endpoint.
- Giữ nguyên credentials/OAuth/OTP_HMAC_SECRET/endpoint/bucket đã có; kiểm tra programmatic trước write. Trên bản env mẫu đọc từ đĩa, các ô credential/OTP đang trống; không đọc .env để lấy/copy secrets và không xác nhận OTP entropy.
- GitNexus .env.example không được index, risk UNKNOWN; source/Compose search không có runtime consumer của SMTP/AVATAR_S3/OTP_HMAC_SECRET. Chỉ sửa mẫu, không gửi mail, gọi R2 hoặc đổi runtime.
- Verification: credential preservation, unique env keys và whitespace checks; không chạy tests vì không đổi code. Không commit.
- Nguồn: https://support.google.com/a/answer/176600 ; https://support.google.com/mail/answer/185833 ; https://developers.cloudflare.com/r2/api/s3/api/ .
