# Nhật ký Identity M4/M5 - 2026-09-11

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-11` |
| Múi giờ ghi log | `Asia/Saigon` |
| Repository / worktree | `Weav` / `T:\\Weav\\.worktrees\\identity-m4-m5` |
| Nhánh / commit đầu ngày | `codex/identity-m4-m5` / `5fdf923` |
| Phạm vi | Identity M4 admin users và M5 avatar storage/lifecycle |
| Người review / nhận bàn giao | `/root` |
| Commit / push | Chưa tạo theo yêu cầu bàn giao |

## 2. Mục tiêu, acceptance và ràng buộc

### Mục tiêu

1. Thêm `GET /admin/users`, `GET /admin/users/{userId}` và `PATCH /admin/users/{userId}/status` với quyền ADMIN hiện tại trong DB.
2. Thêm upload/get/delete avatar qua storage S3-compatible, với kiểm tra file/ảnh, namespace server sở hữu và lifecycle dọn object an toàn.
3. Giữ tương thích M1-M3, cập nhật contract/config/tests/work log; không làm M6, Gateway, web/mobile hoặc provider thật.

### Acceptance chính

- 401 anonymous/revoked/disabled actor; 403 USER; stale ADMIN JWT không cấp quyền; target ADMIN/self trả 409; target thiếu trả 404; cùng status idempotent.
- Disable và revoke toàn bộ session trong một transaction; enable không khôi phục session; admin khóa hai user theo UUID tăng dần và recheck actor dưới lock; audit chỉ có actorId/targetId/action/result/correlationId.
- Admin page có page/size/search/status bounded, query parameterized, sort ổn định; response không serialize password/hash/storage key.
- Avatar chỉ nhận JPEG/PNG/WebP <=2 MiB, magic+decoder+dimension <=4096, re-encode loại metadata; key do server sinh trong namespace user.
- Upload commit reference mới dưới user lock rồi dọn key cũ; DB failure dọn key mới; cleanup failure tạo retryable sanitized event và reconciliation idempotent. GET signed URL khoảng 5 phút/no-store; DELETE bỏ reference trước rồi dọn object.
- Có test HTTP/DB concurrency và runtime storage disposable chứng minh upload, signed URL fetch bytes, delete; không dùng mock-only làm bằng chứng duy nhất.

### Rủi ro / cách giảm thiểu

- GitNexus index bound tới `Weav` tại `T:\\Weav`, commit `5fdf923`, nhưng các upstream walks cho `CurrentIdentityGuard`, `User`, repository adapters, config và `SecurityConfig` trả `partial:true`, `risk:UNKNOWN`, zero callers; đây là unresolved graph signal. Manual source search xác nhận các symbols được Login/Refresh/Profile/Session/OAuth wiring và Spring bean graph sử dụng. Không có HIGH/CRITICAL result để dismiss; giữ thay đổi additive và review diff đầy đủ.
- S3 dependency và disposable storage có thể phụ thuộc Maven/Docker availability; sẽ ghi rõ command/evidence hoặc blocker, không đọc `.env` và không cần credential thật.
- Đường storage cleanup không nằm trong transaction PostgreSQL; dùng bounded in-process reconciliation retry state, sanitized và idempotent. Process restart can lose a pending task; no durable compliance/outbox claim is made in M5.

## 3. Kế hoạch triển khai đã được chốt

1. Mở rộng UserRepository/Spring Data với UserPage và bounded parameterized search; thêm safe admin DTO/controller/use cases; bổ sung current-admin guard và lock ordering.
2. Thêm domain avatar mutation, AvatarStorage port, S3 properties/adapter, image normalization và update/delete use cases/controller; wire bean/config/env placeholders.
3. Thêm focused unit/integration/concurrency tests và disposable object storage; cập nhật OpenAPI/README; chạy focused rồi full Identity Maven regression với UTC.
4. Review `git diff`, `git diff --check`, work log và để nguyên thay đổi chưa commit cho `/root`; root tự chạy GitNexus refresh/detect-changes trước commit.

## 4. Trạng thái session

- Baseline source/docs/work logs/plan đã đọc; latest M3 sections 47-48 ghi nhận live Google session acceptance do user cung cấp.
- Worktree mới tạo sạch từ `5fdf923`; mọi thay đổi vẫn chưa commit.
- Ngoài phạm vi: M6 client delivery, Gateway/mobile, Google/Neon mutation, secret values và canonical containers.

## 5. Đã triển khai

- M4: `UserPage`, bounded user search/pagination với thứ tự `createdAt DESC, id ASC`, safe admin DTOs/mappers/controllers, current DB ADMIN guard, UUID-ordered actor/target locks, same-status idempotency, atomic disable plus session revoke, and sanitized admin audit logging.
- M5: `AvatarStorage` và cleanup queue ports, S3-compatible adapter/presigner with strict server-owned UUID keys, image magic/decoder/dimension validation and metadata-stripping re-encode, configured multipart bounds, avatar update/get/delete use cases, signed URL/no-store responses, bounded idempotent retry reconciliation, and unavailable-storage fallback.
- Contracts/config: OpenAPI and Identity contract README now describe M4/M5; Compose, main/test properties, and `.env.example` contain only non-secret avatar setting placeholders/defaults.
- Tests added/extended: `AdminUserHttpIntegrationTest`, `AvatarHttpIntegrationTest`, `AvatarImageValidatorTest`, `AvatarLifecycleUseCaseTest`, `AvatarTransactionRollbackIntegrationTest`, and `S3AvatarStorageIntegrationTest`.

## 6. Verification

- `mvn -DskipTests compile` passed with `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC` using the local Maven 3.9.16 distribution. The repository `mvnw.cmd` still has the existing managed PowerShell wrapper failure (`icm : Cannot index into a null array`), so direct Maven invocation was used.
- `AvatarImageValidatorTest`: 4 tests passed.
- `AvatarLifecycleUseCaseTest`: 6 tests passed, including cleanup queue failure after commit, bounded queue-full behavior, DB failure cleanup, cleanup retry/reconciliation, and delete reference preservation.
- `AvatarTransactionRollbackIntegrationTest`: 2 tests passed against disposable PostgreSQL plus MinIO. A real `TransactionTemplate` fails after the repository save callback; replacement rollback preserved the old DB reference/object and removed the newly uploaded object, while delete rollback preserved both reference and object.
- `S3AvatarStorageIntegrationTest`: 2 tests passed against disposable MinIO; actual object upload, signed URL HTTP fetch, cross-user key rejection, delete/missing-object handling, and outage mapping were exercised.
- `AvatarHttpIntegrationTest`: 2 tests passed against disposable PostgreSQL and MinIO; real multipart validation, signed URL image fetch, concurrent replacement plus replace/delete race, delete, storage outage `503`, and revoked/disabled-session `401` behavior were exercised.
- `AdminUserHttpIntegrationTest`: 5 tests passed against disposable PostgreSQL. The matrix covers anonymous/USER/stale-role/revoked/disabled authorization on list/detail/status, missing detail/PATCH targets, self and non-self ADMIN target `409`, safe list/detail, status lifecycle, session revocation, audit fields/results/sanitization, actor-role recheck under a deterministic lock gate, status versus login/refresh lock windows, and post-update revoke failure rollback.
- The post-commit cleanup catch scope is covered by `cleanupQueueFailureAfterCommitDoesNotDeleteCurrentAvatar`: queue-enqueue failure after the new reference commits leaves the current new object intact.
- The WebP ImageIO provider emits the JDK native-access warning during tests; it does not fail the test run.
- Full Identity Maven regression: `304` tests run, `0` failures, `0` errors, `1` existing opt-in skip (`303` passed); `BUILD SUCCESS` in `03:16` with disposable PostgreSQL/Valkey and the M5 MinIO-backed tests. The final report includes the corrected admin, avatar HTTP, lifecycle, and rollback integration suites.
- Current-tree package gate: direct Maven 3.9.16 invocation with UTC (`MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository`, `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`), `-B -Dstyle.color=never -DskipTests package`, passed with `BUILD SUCCESS` in `5.332 s`. The repository `mvnw.cmd` still has the existing managed PowerShell `icm : Cannot index into a null array` failure.
- `git diff --check`: passed; Git emitted only normal LF-to-CRLF autocrlf notices for modified text files.
- GitNexus repository binding: `Weav` at `T:\Weav`, index commit `5fdf923d8dd45f45524319ee9796c8a593726e51`, index date `2026-09-11T08:24:47.649Z`; worktree diff was `T:\Weav\.worktrees\identity-m4-m5` on `codex/identity-m4-m5`.
- GitNexus `detect_changes(scope=all, worktree=...)`: `47` changed symbols, `28` affected processes, `14` changed tracked files, reported `risk_level=critical` because the base graph attributes broad `User` getter/config/exception-handler changes to existing flows. The worktree-aware run still omits the new untracked classes, so this is a review signal rather than a complete graph review or clean result. A CLI status refresh from the worktree was unavailable because the project runner hit `EPERM: operation not permitted, realpath 'C:\Users\nhoan'` before analysis.
- Unresolved GitNexus coverage list for new production files: `application/dto/{AdminUserPageResult,AdminUserResult,AvatarImage,AvatarUrlResult}.java`; `application/port/out/{AvatarCleanupQueue,AvatarStorage}.java`; `application/usecase/{ChangeUserStatusUseCase,DeleteAvatarUseCase,GetAvatarUseCase,GetUserDetailUseCase,ListUsersUseCase,UpdateAvatarUseCase}.java`; `application/validation/AvatarImageValidator.java`; `domain/model/UserPage.java`; `infrastructure/config/AvatarStorageProperties.java`; `infrastructure/storage/{AvatarCleanupReconciler,S3AvatarStorage,UnavailableAvatarStorage}.java`; `presentation/http/{AdminUserController,AvatarController}.java`; `presentation/http/mapper/AdminUserPresentationMapper.java`; `presentation/http/request/ChangeUserStatusRequest.java`; `presentation/http/response/{AdminUserPageResponse,AdminUserResponse,AvatarUrlResponse}.java`.

## 7. Handoff state

- All changes remain uncommitted on `T:\Weav\.worktrees\identity-m4-m5` / `codex/identity-m4-m5`; `/root` owns review, GitNexus change detection, and commit decision.
- No `.env` or secret values were read or changed. No Neon, real bucket, provider, Gateway, web, mobile, or M6 work was performed.

## 8. Root correction review (2026-09-11)

- Reviewed the narrowed UpdateAvatarUseCase transaction catch: post-commit cleanup failure no longer triggers deletion of the committed new object. Reviewed actual PostgreSQL/MinIO rollback tests, deterministic admin lock gates, actor-role recheck, revoke-failure rollback and expanded authorization/audit assertions.
- Independently reran AvatarLifecycleUseCaseTest, AvatarTransactionRollbackIntegrationTest, AdminUserHttpIntegrationTest and AvatarHttpIntegrationTest with Maven 3.9.16 and UTC: 15 run, 0 failures, 0 errors, 0 skipped; BUILD SUCCESS in 54.634 seconds. Initial sandbox run could not discover Docker; the approved elevated rerun passed. This was an environment failure, not a source defect.
- Before rerun, independently summed worker Surefire XML: 304 run, 0 failures/errors, 1 skipped (303 passed). Root did not rerun the entire suite or package; those remain worker evidence.
- Reviewed correction findings are resolved. Implementation remains uncommitted in the isolated worktree. Complete GitNexus coverage remains unresolved and must be resolved before commit/merge approval; the reported CRITICAL tracked-flow result is not an all-clear. Cleanup restart/overflow loss remains an explicit operational limitation.

## 9. Final pre-commit graph review (2026-09-11)

- Rebuilt dedicated Weav-M4-M5 index at T:\Weav\.worktrees\identity-m4-m5 using analyze --force --index-only --name Weav-M4-M5 with approved elevated execution. Index timestamp 2026-09-11T11:42:32.233Z, base 5fdf923, 763 files, 10952 nodes, 25480 edges, 451 flows. No application source changed during this gate.
- Staged all 46 reviewed files so additions participate in git diff. detect_changes(scope=all, repo=Weav-M4-M5, worktree=...) reports 507 symbols (507 returned), 41 affected processes and 46 changed files. Neither partial nor truncated flag is set. This resolves the former omission of untracked implementation files from the change input.
- Risk remains CRITICAL and was explicitly reported before commit. Reviewed affected process families: admin list/detail/status and current DB role/session guard; avatar validation, upload/read/delete, storage wiring and credentials configuration. Context confirms controller/config consumers for new use cases. Reviewed shared guard consumers in password/profile/session/OTP/OAuth via targeted source search; existing guard behavior is unchanged and full regression evidence remains applicable.
- Static-analysis limits remain: process discovery reports entry-point/branch/walk caps; context reports lower-bound completeness; AvatarStorage interface lookup is not resolved. These are not evidence of unused interfaces or exhaustive flow coverage. Ports and their injected S3/unavailable/reconciler adapters were manually reviewed and exercised by real HTTP/PostgreSQL/MinIO acceptance and the independent 15-test rerun. No claim of a globally exhaustive graph is made.
- Root approves the tested M4/M5 logical milestone for a local commit, based on complete staged-file input, graph-guided review plus manual/runtime corroboration. Cleanup queue restart/overflow limitation remains documented. No push or merge is included.
