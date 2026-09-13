# Nhật ký ngày `2026-09-13`

## Commit gate resolved — 2026-09-13

- User authorized committing Tasks 4–5 and continuing with Tasks 6–7. Rebuilt the local index using `GITNEXUS_MEMORY=off` and `node .gitnexus/run.cjs analyze --force --index-only`; metadata records completion at 07:35:01 UTC. This changes only the index, not source guidance.
- Installed CLI/backend now reads the rebuilt index; the separately installed MCP runtime still has a storage-version mismatch. Used the CLI backend's `LocalBackend.callTool('detect_changes', {scope:'all', repo:'T:/Weav'})` for the complete structured check: 48 files, 382/382 listed changed symbols, 43 affected flows, critical risk, no partial/truncated flag. CLI prose output abbreviates the listing, so the full structured result was reviewed.
- Critical risk was communicated before commit. Reviewed all reported flows: workspace creation/rename and response mapping, Identity directory match/search/batch/email queries, internal-key checks, and adapter payload/error handling. These align with the reviewed scope and existing worker full-suite plus coordinator 32 focused PostgreSQL/HTTP tests. No new blocking finding.
- Index construction still reports Java package-resolution and bounded process-enumeration limitations; absence from the graph is not evidence of no impact. Source review and runtime regression evidence remain necessary.
- Tasks 4–5 accepted for the local milestone commit. No push. Next worker batch: Tasks 6–7 only.

## Final coordinator review — 2026-09-13

- Tasks 4–5 code review accepted after the email-policy correction. All previously raised transaction, constraint translation, servlet-context security, valid-JWT, downstream-status, and email validation findings are addressed. Tasks 6+ remain untouched.
- Independently verified Workspace `WorkspaceUseCasesTest,WorkspaceUseCasePersistenceIntegrationTest,IdentityDirectoryHttpClientTest`: **24/24 passed**, zero failures/errors/skips, BUILD SUCCESS in 28.281 seconds. Includes real PostgreSQL collision/retry/rollback and local HTTP adapter checks.
- Independently verified Identity `DirectoryUserQueryServiceTest,DirectoryUserQueryIntegrationTest,InternalDirectoryHttpIntegrationTest`: **8/8 passed**, zero failures/errors/skips, BUILD SUCCESS in 25.882 seconds. Includes PostgreSQL and HTTP security with `/identity` context path.
- Commands used the documented local Maven distribution/cache with UTC JVM timezone, `-B -Dstyle.color=never -Dtest=<selectors> test`, from each service directory. Sandbox escalation allowed local cache and Docker access. No full-suite rerun claimed by coordinator; earlier full-suite results above remain worker evidence.
- `git diff --check` passed. No further code issue found in the scoped correction review.
- Pre-commit MCP `detect_changes(scope=all, repo=Weav)` failed with stored LadybugDB version 43 versus installed build version 42. This is an unresolved graph check, not a clean result. Implementation review is complete, but the commit gate remains blocked; no commit/push performed. Rebuild/repair the local index and rerun change analysis before committing.

## Coordinator review — first pass

- Worker initially reported Workspace 62/62 and Identity 311 passed / 1 skipped; those were worker results, not a coordinator rerun. The final correction reruns are recorded below. Milestone is not accepted yet; no commit/push.
- Blocking Task 4 findings: `RenameWorkspaceUseCase` does not translate a DB uniqueness race into `WORKSPACE_NAME_ALREADY_EXISTS`; `CreateWorkspaceUseCase` translates every `DataIntegrityViolationException` into a name conflict, including unrelated membership/integrity failures, and retries them for generated names.
- Retry boundary concern: the injected default REQUIRED transaction template joins an ambient transaction, so retry iterations are not guaranteed independent after a PostgreSQL constraint failure. Existing persistence tests cover ordinary commit and rollback, not a real uniqueness collision/retry or ambient transaction. Require explicit supported boundary and real PostgreSQL regression evidence.
- Task 5 security/adapter review delegated read-only to the existing Luna MAX reviewer. Findings will be included in the correction assignment. Tasks 6+ remain outside scope.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-13` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu session | `feature/workspace-service` / `4d44cda` |
| Người thực hiện | `Workspace use-case/directory worker (Luna MAX)` |
| Người review / nhận bàn giao | `Coordinator /root` |
| Trạng thái cuối session | `Implementation complete; coordinator review pending` |
| Phạm vi session | `Workspace Service Tasks 4-5 only` |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-12-workspace-core.md` |

## 2. Tóm tắt điều hành

### Kết quả chính

- Task 4 now provides transaction-bound create/list/get/rename application use cases. Creation derives the actor from the command, creates the workspace and exactly one OWNER membership atomically, supports bounded separate-transaction retries for generated names, and preserves scoped authorization/name invariants.
- Task 5 now provides Identity's minimal internal directory query/controller surface and fail-closed `X-Internal-Service-Key` protection. The canonical nullable `User.displayName` is used for matching and deterministic sorting; inactive users remain visible in directory summaries.
- Workspace now has a typed Identity directory port and RestClient adapter with finite transport timeouts, sanitized dependency failures, 500-ID transport chunking, and exact global display-name k-way merge pagination.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Final Workspace `mvn test`; final Identity `mvn test`. |
| Unit / integration test | `PASS` | Workspace 66/66; Identity 311 passed, 1 existing opt-in skip. Focused correction tests also pass. |
| Migration / database | `PASS` | Existing V1/V2 Workspace and Identity Flyway migrations applied by PostgreSQL Testcontainers; Task 4/5 adds no migration. |
| Health check | `Chưa kiểm tra` | Public Workspace HTTP controllers are Task 8. |
| Review thay đổi | `Chưa hoàn tất` | Self-review and `git diff --check` passed; coordinator review remains pending. |
| Commit / PR | `Chưa tạo` | Coordinator deferred commit/push pending review; changes remain uncommitted and reviewable. |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- Workspace Task 4 application DTOs, transaction integration, create/list/get/rename use cases, stable errors, and focused tests.
- Identity Task 5 internal directory DTO/query/controller/security implementation, plus the minimal repository batch query required by the directory.
- Workspace Identity directory domain port/result shape, RestClient adapter/configuration, typed downstream failures, and focused HTTP/merge tests.
- Work log and reproducible verification evidence.

### Ngoài phạm vi / chủ động chưa làm

- Tasks 6+ membership mutations/list enrichment, Task 7 cache, Task 8 public Workspace controllers/JWT integration, and later internal authorization work.
- Connection/Credential behavior, V1 migration changes, live data, secrets, branch/worktree creation, commit, and push.
- No Identity persistence field was added for `displayName`; the existing canonical nullable field is reused.

### Tiêu chí hoàn thành

- [x] Task 4 create/list/get/rename use cases and application transaction behavior are implemented and tested.
- [x] Task 5 bounded Identity directory and Workspace adapter contracts are implemented and tested.
- [x] Real PostgreSQL/Flyway and real HTTP/Testcontainers paths cover persistence, security, inactive summaries, chunking, timeout/refusal/5xx/4xx mapping, and exact ordering/totals.
- [x] Worktree, diff, and work log are reviewable; no commit/push performed.
- [ ] Coordinator review and any requested follow-up remain pending.

## 4. Bối cảnh và quyết định phạm vi

- The checked-out branch was reverified as `feature/workspace-service`, tracking `origin/feature/workspace-service`; HEAD was `4d44cda (feat(workspace): establish core contracts and persistence)`. Existing user/coordinator changes were preserved.
- The committed Task 1-3 domain query/result types are reused. `IdentityUserSummary` is kept in Workspace's domain-facing model layer so the domain port does not depend on application DTOs or Spring HTTP types; the Workspace application maps domain workspace results to `WorkspaceResponse`.
- A small `TransactionRunner` port and Spring `TransactionTemplate` adapter provide a real required transaction while allowing generated-name conflict retries to begin a fresh transaction after PostgreSQL rollback. No retry is performed inside an aborted transaction.
- Identity directory requests accept at most 500 IDs per HTTP request. Workspace deduplicates and chunks larger inputs, fetches all per-chunk display-name pages, then performs an explicit priority-queue k-way merge using case-folded non-null `displayName`, null-last in both directions, and ascending `userId` as the tie-break. It sums exact totals and slices the global page; there is no arbitrary aggregate cap.
- The existing Identity field `User.displayName` is the canonical human-readable name. Exact email lookup uses the existing trim/case-insensitive repository query and includes disabled users.
- Internal directory routes are permitted by Spring Security only after the infrastructure filter validates the configured key. Missing, blank, or mismatched keys fail closed before bearer authentication can grant access. The public JWT-only integration assertion remains explicit.
- The closed capability enum from the approved plan remains unchanged. Tolerant-reader behavior and runtime consumer coverage stay with the coordinator's planned Task 9 work.

## 5. GitNexus impact evidence

- Before the final existing-test symbol edit, CLI `node .gitnexus/run.cjs impact "DirectoryUserQueryServiceTest" --direction upstream --repo .` failed with `EPERM: operation not permitted, realpath 'C:\\Users\\nhoan'`.
- The available GitNexus MCP impact call for `DirectoryUserQueryServiceTest` returned `risk: UNKNOWN` because the persisted LadybugDB index was written with storage version 43 while the installed engine expects version 42. This is a tooling/index freshness failure, not an all-clear. Targeted source inspection confirmed the symbol is a local Identity directory test and found no other production callers.
- Earlier Task 4/5 existing-symbol edits used the same required upstream-impact workflow. The stale index produced UNKNOWN/target-not-found results for new or unindexed Java symbols; targeted source searches corroborated local callers and interface wiring. No HIGH or CRITICAL impact result was observed.
- A force reindex had already been attempted in the approved environment and stalled; no retry/workaround was used after the bounded attempt. `helper_unknown_error: setup refresh had errors` did not occur.

## 6. TDD red-green evidence

### Task 4

- Red focused `WorkspaceUseCasesTest` run failed at test compilation because the new application use cases/DTOs and transaction boundary did not yet exist.
- Green `-Dtest=WorkspaceUseCasesTest` passed 12/12 after the minimum implementation.
- Green real persistence `-Dtest=WorkspaceUseCasePersistenceIntegrationTest` passed 5/5 with PostgreSQL/Flyway. It proved a committed workspace has exactly one OWNER, real unique-collision translation/retry, and rollback/no orphan on membership failure.

### Task 5

- Red Workspace adapter run `-Dtest=IdentityDirectoryHttpClientTest` failed at test compilation while the typed dependency/port/client classes were absent.
- Red Identity directory run `-Dtest=DirectoryUserQueryServiceTest` failed at test compilation while directory DTO/query classes were absent.
- Green Workspace adapter run passed 6/6, including email/not-found/inactive mapping, timeout, connection refusal, 5xx/4xx sanitized mapping, empty short-circuits, 501-ID chunking, and global null-last/tie-break merge.
- Green Identity unit run passed 4/4. The final ordering test covers distinct names in both directions, duplicate case-folded names, null-last behavior, candidate scoping, inactive email lookup, and empty-input short-circuits.
- Green Identity PostgreSQL/HTTP run `-Dtest=DirectoryUserQueryIntegrationTest,InternalDirectoryHttpIntegrationTest` passed 3/3, covering canonical email lookup, inactive state, candidate-bounded search, missing/wrong key, public bearer bypass rejection, and valid-key HTTP access.

## 7. Thay đổi đã thực hiện

### 7.1 Code và hành vi

- Workspace `CreateWorkspaceUseCase`, `ListWorkspacesUseCase`, `GetWorkspaceUseCase`, and `RenameWorkspaceUseCase` implement actor-scoped operations, stable 404/403/409/400 behavior, max-positive default numbering, same-normalized rename support, and repository page metadata mapping.
- Workspace `CreateWorkspaceRequest` now allows omitted/null names for default generation while still rejecting oversized input; explicit whitespace remains rejected by the use case.
- Workspace `TransactionRunner` and `SpringTransactionRunner` wrap operations in Spring required transactions. Generated-name retries are capped at three fresh attempts and handle integer numbering exhaustion explicitly.
- Identity `DirectoryUserQueryService` provides exact normalized email lookup, IDs-only candidate matching, bounded search/batch, and deterministic display-name pages. `UserRepository.findAllByIds` is additive; the JPA adapter uses one `findAllById` query.
- Identity `InternalDirectoryController` exposes `/internal/directory/users/by-email`, `/match`, `/search`, and `/batch` with bounded validation and the existing error envelope.
- Identity `InternalServiceKeyFilter` uses constant-time key comparison and fail-closed behavior. `SecurityConfig` wires it before bearer authentication while preserving existing auth routes.
- Workspace `IdentityDirectoryHttpClient` maps downstream failures to stable typed errors, omits downstream payloads from messages, validates response ownership/shapes, applies finite configured connect/read timeouts, chunks IDs at 500, and performs exact global merge/paging.
- Workspace global handling maps `DEPENDENCY_UNAVAILABLE` to sanitized HTTP 503. No raw headers, keys, credentials, or downstream bodies are logged or returned.

### 7.2 Dữ liệu, schema và migration

- No new migration was needed for Tasks 4-5. Existing Workspace V1/V2 and Identity V1-V4 migrations remain unchanged.
- Directory summaries are read-only projections; Workspace persists user IDs only and does not duplicate Identity profile fields.

### 7.3 Cấu hình, hạ tầng và dependency

- Added `weav.internal.service-key=${IDENTITY_INTERNAL_SERVICE_KEY:}` to Identity main/test configuration and `weav.identity.internal-service-key=${IDENTITY_INTERNAL_SERVICE_KEY:}` to Workspace main/test configuration. Blank defaults fail closed; actual values remain environment-managed.
- Workspace identity base URL and existing connect/read timeout properties are consumed by a `SimpleClientHttpRequestFactory`; no unbounded retry or new resilience dependency was introduced.

### 7.4 API, bảo mật và validation

- Internal Identity routes use the committed bounded contract and `X-Internal-Service-Key`; request DTOs enforce 1-500 IDs, page/size bounds, direction, and search/email lengths.
- `by-email` returns 404 for an absent user and includes inactive summaries. Match/search/batch are candidate/request bounded and never return profiles outside requested IDs.
- Workspace adapter maps downstream 404 email lookup to `Optional.empty`, other 4xx to a sanitized bad-request error, transport/refusal/timeout/5xx/malformed responses to `DEPENDENCY_UNAVAILABLE`, and no raw response body is exposed.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn / nhóm | Thay đổi chính |
| --- | --- | --- |
| `Sửa` | `services/workspace-service/src/main/java/com/weav/workspace/application/**` | Create command/response, transaction port, and Task 4 use cases. |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/domain/{model,port,out,exception}/**` | Identity summary/port and typed Task 4/5 errors. |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/{config,identity,persistence}/**` | Spring transaction runner, Identity properties/config/RestClient adapter. |
| `Sửa` | `services/workspace-service/src/main/java/com/weav/workspace/infrastructure/web/GlobalExceptionHandler.java`, `presentation/http/request/CreateWorkspaceRequest.java` | Dependency 503 mapping and nullable default-name request validation. |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/{application,infrastructure}/**` | Use-case persistence, adapter, and sanitized handler coverage. |
| `Sửa` | `services/identity-service/src/main/java/com/weav/identity/domain/port/out/UserRepository.java`, `infrastructure/persistence/repository/UserRepositoryAdapter.java` | Additive bounded batch query. |
| `Thêm` | `services/identity-service/src/main/java/com/weav/identity/{application,presentation}/**` | Directory DTOs, query service, request validation, and controller. |
| `Thêm` | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/{InternalServiceKeyFilter,InternalServiceKeyProperties}.java` | Internal key protection. |
| `Sửa` | `services/identity-service/src/main/java/com/weav/identity/infrastructure/security/SecurityConfig.java`, main/test properties | Filter wiring and environment configuration. |
| `Thêm` | `services/identity-service/src/test/java/com/weav/identity/{application,infrastructure,presentation}/**` | Directory unit, PostgreSQL, and HTTP security tests. |

## 9. Kiểm tra và bằng chứng

All commands below ran from the affected service directory with Docker/Testcontainers enabled, Maven 3.9.16 from the configured local wrapper distribution, local Maven cache, and `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`.

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Task 4 focused | `.../mvn.cmd -B -Dstyle.color=never -Dtest=WorkspaceUseCasesTest test` | `PASS`, 12/12 | Mockito application behavior. |
| Task 4 persistence | `.../mvn.cmd -B -Dstyle.color=never -Dtest=WorkspaceUseCasePersistenceIntegrationTest test` | `PASS`, 5/5 | Real PostgreSQL/Flyway/Testcontainers; unique-race translation, fresh retry, atomic commit, and rollback/no-orphan proof. |
| Task 5 Workspace adapter | `.../mvn.cmd -B -Dstyle.color=never -Dtest=IdentityDirectoryHttpClientTest test` | `PASS`, 6/6 | Real local HTTP server; mapping, chunking, merge, timeout/refusal/4xx/5xx. |
| Task 5 Identity unit | `.../mvn.cmd -B -Dstyle.color=never -Dtest=DirectoryUserQueryServiceTest test` | `PASS`, 4/4 | Candidate matching and both-direction ordering. |
| Task 5 Identity DB/HTTP | `.../mvn.cmd -B -Dstyle.color=never -Dtest=DirectoryUserQueryIntegrationTest,InternalDirectoryHttpIntegrationTest test` | `PASS`, 3/3 | Real PostgreSQL/Flyway and random-port HTTP security tests. |
| Full Workspace | `.../mvn.cmd -B -Dstyle.color=never test` | `PASS`, 66/66 | Entire Workspace module, including contract/security/persistence tests. |
| Full Identity | `.../mvn.cmd -B -Dstyle.color=never test` | `PASS`, 311 passed, 1 existing opt-in skip | Entire Identity module; no failures/errors. |
| Diff check | `git diff --check` | `PASS` | Only Git line-ending notices were emitted. |
| Worktree review | `git status --short --branch`, targeted `git diff`, `rg` scope checks | `PASS` for intended scope | Uncommitted Task 4-5 files only; no Tasks 6+ implementation, live data, or secrets. |

The exact Maven prefix used was:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never <selector> test"
```

### Điều chưa được kiểm tra

- Public Workspace HTTP controllers and JWT-derived actor flow are intentionally Task 8 scope.
- Dedicated OpenAPI semantic validation remains limited to the committed structural/shape checks; no external validator was introduced.
- GitNexus graph refresh/change analysis remains blocked by the persisted LadybugDB version mismatch; targeted source review is the documented complement.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| `Trung bình` | GitNexus impact is UNKNOWN | Stored DB version 43, installed engine version 42; CLI also hit Windows `realpath` EPERM. | Recorded exact errors; corroborated every edited existing symbol with targeted source inspection; no high/critical result was treated as safe. | `/root`: refresh/re-index before any commit/review decision. |
| `Thấp` | One full Identity test remains skipped | Existing opt-in skip from the pre-existing suite, unrelated to directory tests. | Full run passed all executed tests; skip is reported explicitly. | `/root`: retain/inspect according to normal suite policy. |
| `Thấp` | Public Workspace runtime path is absent | Deliberately deferred to Task 8. | Use-case/adapter behavior is covered at application, persistence, and adapter boundaries. | Future Task 8 worker. |

No live database, credentials, `.env` contents, JWTs, service keys, or downstream payloads were accessed or written to the log.

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. `/root` should review the uncommitted Task 4-5 diff and contract compatibility, then run GitNexus refresh/change analysis when the index engine is aligned.
2. If accepted, coordinator can stage and commit the Task 4 and Task 5 logical batches; no commit was made by this worker.
3. Future work starts at Task 6 and must preserve the 500-ID candidate/chunk protocol and global display-name merge semantics.

### Cần quyết định / quyền truy cập từ người khác

- Coordinator review is required before committing. No product decision is currently blocked; the only tooling concern is the GitNexus storage-version mismatch.

### Hướng dẫn cho AI agent tiếp theo

- Read this log, the global constraints, and plan Tasks 4-5 before editing.
- Preserve the existing `displayName` canonical field, internal-key fail-closed security, exact k-way merge semantics, and separate transaction retry boundary.
- Do not implement Tasks 6+ in this milestone and do not commit/push until coordinator review changes the instruction.

## 12. Tham chiếu

- `docs/superpowers/plans/2026-09-12-workspace-core.md` — approved global constraints and Tasks 4-5.
- `docs/work_logs/2026-09-12-workspace-foundation.md` — Task 1-3 coordinator review and contract rulings.
- `packages/contracts/http/auth/openapi.yaml` and `packages/contracts/http/workspace/openapi.yaml` — committed internal directory and Workspace shapes.
- `docs/work_logs/log_template.md` — work-log format.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-13 13:55 Asia/Saigon` |
| Trạng thái worktree | `Có thay đổi chưa commit; branch preserved; user plan preserved` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Workspace use-case/directory worker (Luna MAX)` |
| Cần đọc trước khi tiếp tục | `Plan global constraints/Tasks 4-5; this log; Task 1-3 foundation log` |

---

### Checklist trước khi đóng log

- [x] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [x] Mọi quyết định ảnh hưởng thiết kế đều có lý do.
- [x] File thay đổi và migration/configuration quan trọng đã được nêu.
- [x] Có lệnh hoặc thao tác tái lập cho các kiểm tra đã tuyên bố.
- [x] Rủi ro, blocker và next step có chủ sở hữu hoặc hành động rõ ràng.
- [x] Không có secret, token, connection string nhạy cảm hoặc PII không cần thiết.
- [x] Trạng thái commit/PR và worktree chính xác tại thời điểm ghi.

## 14. Correction batch — coordinator findings — 2026-09-13

Coordinator review identified five concrete defects requiring correction before
the Task 4-5 milestone can be accepted:

1. A concurrent owner/name collision during rename escaped as a generic
   persistence conflict instead of `WORKSPACE_NAME_ALREADY_EXISTS`.
2. Create translated every `DataIntegrityViolationException` and broad conflict
   into a generated-name retry, including unrelated membership failures.
3. Generated-name retries could reuse an aborted ambient REQUIRED transaction.
4. The internal directory key filter matched the raw URI and could be bypassed
   when Identity ran under a servlet context path; the filter also needed to be
   disabled for servlet auto-registration because Spring Security owns its
   invocation.
5. Workspace mapped downstream 401/403/404/429 responses to the public bad
   request error, conflating dependency failures with caller validation.

### TDD evidence for the correction batch

- Red Workspace focused run using
  `-Dtest=WorkspaceUseCasesTest,WorkspaceUseCasePersistenceIntegrationTest`
  stopped at test compilation while the new `requiresNew` transaction contract
  was not yet implemented.
- Red Identity HTTP run using
  `-Dtest=InternalDirectoryHttpIntegrationTest` failed its nonroot-context
  bearer-bypass assertion: a public bearer request without the internal key
  returned `200` instead of the expected `401`.
- GitNexus upstream impact was attempted for the edited persistence test symbol.
  The MCP returned `risk: UNKNOWN` because the stored LadybugDB database is
  version 43 while the installed engine expects version 42. Targeted `rg`
  inspection confirmed the test and helper have no production callers; this
  UNKNOWN result was treated as unresolved rather than safe.
- Green Workspace use-case and PostgreSQL persistence run passed `17/17`.
  The final persistence-only rerun after strengthening the race fixture passed
  `5/5`; its logs show a real PostgreSQL violation of
  `ux_workspaces_owner_name_normalized` followed by a successful fresh default
  name attempt, plus the unrelated `uk_membership_workspace_user` failure.
- Green Workspace Identity HTTP adapter run passed `6/6`, including 400 versus
  401/403/404/429 mapping, timeout/refusal/5xx sanitization, and bounded
  chunking/merge behavior.
- Green Identity internal HTTP/security run passed `2/2` with a real signed
  Identity JWT, `server.servlet.context-path=/identity`, missing/wrong/valid
  key requests, and a disabled `FilterRegistrationBean` assertion.

### Corrections implemented

- `WorkspacePersistenceExceptionTranslator` recognizes only the exact
  `ux_workspaces_owner_name_normalized` Hibernate constraint while walking
  wrapped causes. The Workspace repository adapter and transaction runner use
  this narrow translation, so rename races become the stable domain error and
  unrelated integrity failures remain unchanged.
- `CreateWorkspaceUseCase` catches only that typed name error. Every create
  attempt runs through a `TransactionRunner.requiresNew` boundary, capped at
  three generated-name attempts; workspace and its OWNER membership remain one
  atomic attempt. The final real PostgreSQL fixture inserts the colliding name
  in a committed nested transaction between precheck and save, then verifies
  the next attempt and membership.
- `TransactionRunner` now has separate required and REQUIRES_NEW Spring
  `TransactionTemplate` instances. List/get/rename continue using the required
  path; generated create retries never execute in an aborted transaction.
- `InternalServiceKeyFilter` evaluates `getServletPath()` for the same
  context-relative directory prefix used by the security chain. A disabled
  servlet `FilterRegistrationBean` prevents a second filter registration while
  the filter remains in the Spring Security chain.
- `IdentityDirectoryHttpClient` preserves email 404 as `Optional.empty`, maps
  legitimate 400 responses to `BadRequestException`, and maps 401/403/404/429,
  5xx, transport, timeout, refusal, and malformed responses to the sanitized
  `DependencyUnavailableException`.

### Reproduction commands and final status

All commands were run from the affected service directory with Maven 3.9.16,
the configured local Maven cache, Docker/Testcontainers, and
`JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`:

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never -Dtest=WorkspaceUseCasesTest,WorkspaceUseCasePersistenceIntegrationTest test"
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never -Dtest=IdentityDirectoryHttpClientTest test"
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never -Dtest=InternalDirectoryHttpIntegrationTest test"
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never test"
```

The final full Workspace suite passed `66/66` after the atomic competing
workspace fixture strengthening, and the final focused persistence rerun passed
`5/5`. The full Identity suite passed `311` tests with one pre-existing opt-in
skip.
`git diff --check` remains clean. The correction batch is implementation
complete but coordinator review is still pending; no commit or push was made.

## 15. Final Task 5 email-policy correction — 2026-09-13

### Finding and impact

Coordinator review identified that the first directory implementation only
trimmed, lowercased, and length-checked email values. That did not reuse
Identity's established `AuthInputPolicy.canonicalizeEmail` rules and allowed
malformed, internally spaced, or non-ASCII values to reach directory queries.

Upstream GitNexus impact was attempted for `DirectoryUserQueryService`,
`IdentityDirectoryHttpClient`, and the three affected test classes. The index
again returned `UNKNOWN` because it was written with LadybugDB storage version
43 while the installed engine expects version 42. Targeted source search then
confirmed the only `DirectoryUserQueryService` construction sites were the
Spring-managed service and its focused test, and the only adapter construction
sites were its configuration bean and focused tests. No high or critical impact
was reported; the stale-index limitation remains a coordinator review concern.

### Red evidence

- Identity focused Maven test compilation failed because the new test required
  the policy-injected `DirectoryUserQueryService` constructor, which did not
  exist yet.
- Workspace `IdentityDirectoryHttpClientTest` ran 7 tests with 1 failure:
  `validatesEmailUsingIdentityRulesBeforeNetworkCall` expected
  `BadRequestException` for invalid email input, but the old adapter sent it to
  the HTTP server.

### Implementation

- `DirectoryUserQueryService` now receives the existing Spring-managed
  `AuthInputPolicy` and delegates email canonicalization to it. This preserves
  the established ASCII grammar, outer-space handling, internal-whitespace and
  non-ASCII rejection, length bound, and lowercasing behavior.
- `IdentityDirectoryHttpClient` applies the same bounded email-only rules
  locally, without a cross-service dependency, before any RestClient call.
- Focused tests cover mixed-case values with outer spaces, malformed values,
  internal whitespace, non-ASCII input, excessive length, repository/network
  short-circuiting, inactive summaries, and the real internal HTTP endpoint's
  `400` response for invalid email input.

### Green evidence and status

```text
Identity service:
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never -Dtest=DirectoryUserQueryServiceTest,InternalDirectoryHttpIntegrationTest test"
Result: 7/7 passed (5 unit, 2 PostgreSQL-backed HTTP tests).

Workspace service:
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:/Users/nhoan/.m2/repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:/Users/nhoan/.m2/wrapper/dists/apache-maven-3.9.16/0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0/bin/mvn.cmd -B -Dstyle.color=never -Dtest=IdentityDirectoryHttpClientTest test"
Result: 7/7 passed.
```

The final focused email-policy correction is implementation-complete and no
commit or push was made. Tasks 6+ remain out of scope; coordinator review is
pending.
