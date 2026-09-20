# Nhật ký ngày `2026-09-15`

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-15` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` (`T:\Weav`) |
| Nhánh / commit đầu ngày | `feature/workspace-service` / `b1154a8` |
| Người thực hiện | `Workspace Connection Domain worker` |
| Người review / nhận bàn giao | `/root` coordinator |
| Trạng thái cuối ngày | `Hoàn thành trong phạm vi Task 1 và coordinator correction; chờ coordinator review` |
| Phạm vi session | Connection lifecycle, provider/auth whitelist, and workspace-scoped authorization policies only |
| Liên kết liên quan | `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md`, Task 1, lines 295-428 |

## 2. Tóm tắt điều hành

### Kết quả chính

- `Connection.createNew(...)` now creates a `DISABLED` connection and exposes the requested lifecycle operations.
- Connection names preserve display casing while trimming/collapsing whitespace; `normalizeName` derives the lowercase `Locale.ROOT` key used by later persistence work.
- Provider/auth compatibility and OWNER/MEMBER management, attach, config-view, and workspace-isolation rules are implemented in focused policies.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Installed Maven 3.9.16; Java 25.0.4; UTC timezone |
| Unit / integration test | `PASS` | Focused `15/15`; existing regression `14/14`; full Workspace `151/151` |
| Migration / database | `Chưa áp dụng` | Task 1 does not change migrations; JPA persistence compatibility was exercised by existing Testcontainers test |
| Health check | `Chưa kiểm tra` | Outside Task 1 |
| Review thay đổi | `Đã kiểm tra` | Source corroboration, `git diff --check`, and full module test run |
| Commit / PR | `Chưa tạo` | Worker was instructed not to commit or push |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Implement only Task 1 of the Connection/Credential V1 plan.
2. Preserve existing Workspace domain/JPA conventions and workspace isolation.
3. Produce focused tests and a handoff work log without committing.

### Trong phạm vi

- `Connection.java` lifecycle and name normalization.
- `ConnectionProviderPolicy` provider/auth whitelist and credential requirement rule.
- `ConnectionAuthorizationPolicy` OWNER/MEMBER authorization matrix.
- Focused domain/policy tests and this work log.

### Ngoài phạm vi / chủ động chưa làm

- No persistence migration, `ConnectionJpaEntity` change, mapper, repository adapter, encryption, provider HTTP/OAuth, controller, CRUD use case, Workflow usage check, or generic RBAC.
- No branch/worktree creation, commit, push, or modification of the user-provided untracked plan.

### Tiêu chí hoàn thành

- [x] New connections start `DISABLED`.
- [x] Lifecycle methods, verification timestamp, provider/auth immutability, and name normalization are covered.
- [x] Null verification timestamps are rejected before mutation, preserving `DISABLED` and `INVALID` state.
- [x] Every provider/auth combination is allowed or rejected according to the Task 1 matrix.
- [x] OWNER manages/attaches/views config for all same-workspace connections; MEMBER can do so only for their own connection.
- [x] Cross-workspace authorization is rejected and usage-dependent rules remain deferred.
- [x] Focused, regression, full Workspace tests and diff checks pass.

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Workspace currently has a domain `Connection` scaffold plus JPA entities used directly by existing persistence tests. Connection repositories/adapters are not yet implemented. `Membership` already exposes `workspaceId`, `userId`, and `role`.
- **Nguồn sự thật:** Task 1 of the 2026-09-14 agent-ready plan, current Workspace source/tests, `services/workspace-service/README.md`, Workspace core plan, and work logs from 2026-09-12 through 2026-09-14. The referenced design spec path does not exist.
- **Name decision:** The plan gives an exact lowercase `normalizeName` rule but does not define response/display casing. Existing `Workspace` preserves display casing, so `Connection` preserves casing while trimming/collapsing display whitespace; the explicit normalized key is lowercase `Locale.ROOT`.
- **Config decision:** `updateConfig` replaces the top-level immutable copy produced by `Map.copyOf` and updates `updatedAt`; nested values remain shallow/shared. Task 3 remains responsible for calling `markDisabled()` when a config change can affect runtime validity.
- **JPA compatibility:** The domain class was changed without changing the existing `ConnectionJpaEntity` constructor or enum fields. The existing persistence test passed against PostgreSQL/Testcontainers.

## 5. Nhật ký theo session / thời gian

### Session `1` - `09:00-09:45 Asia/Saigon`

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| `09:00` | Read AGENTS, Task 1 requirements, Workspace README/core plan, logs, log template, and GitNexus guidance. | Confirmed scope and no existing design spec; initial status had only the user-provided untracked plan. | Xong |
| `09:10` | Bound GitNexus repository and inspected `Connection` context/upstream impact. | Repository `Weav`, index at `b1154a8`; impact reported `CRITICAL`, 327-341 nodes, 127 processes, one direct caller, truncated listing. | Xong |
| `09:15` | Corroborated graph warning with literal source search and JPA inspection. | No production callers of domain `Connection` were found; only the domain port/JPA scaffold and tests reference the type. | Xong |
| `09:20` | Implemented Connection lifecycle, provider policy, authorization policy, and focused tests. | Five requested code/test files changed or added; no persistence/provider/controller code touched. | Xong |
| `09:28` | Ran focused Maven tests using installed Maven after wrapper failure. | `ConnectionDomainTest` `8/8`; `ConnectionAuthorizationPolicyTest` `7/7`; total `15/15`. | Xong |
| `09:36` | Ran existing persistence/domain/architecture regression set. | `14/14` passed; PostgreSQL/Testcontainers persistence `2/2`; architecture checks passed. | Xong |
| `09:39` | Ran full Workspace module suite. | `151/151` passed, zero failures/errors/skips; real PostgreSQL/Valkey Testcontainers paths exercised. | Xong |
| `09:43` | Reviewed worktree and whitespace. | `git diff --check` passed; no commit/push performed. | Xong |
| `09:49` | Applied coordinator correction for null verification ordering and added state-preservation tests. | `ConnectionDomainTest` `10/10`; `ConnectionAuthorizationPolicyTest` `7/7`; total `17/17` passed. | Xong |

### Diễn giải quan trọng

The first wrapper attempt failed in the managed PowerShell runner with `icm : Cannot index into a null array`; using the repository's installed Maven path via `cmd.exe` reached compilation. The sandbox then denied read access to the existing Maven dependency cache, so Maven test commands were rerun with approved elevated access. This was an environment/toolchain access issue, not a source failure.

GitNexus's `Connection` risk is recorded as unresolved/high-warning because its upstream walk mixed same-name/cross-language relationships and returned a truncated graph. Targeted source search and full tests provide the bounded evidence for this Task 1 change. The coordinator must run staged `detect_changes --scope all` with all new files visible before any commit.

### Coordinator finding and correction - 2026-09-15

The coordinator identified that `markVerified` assigned `ACTIVE` before validating `verifiedAt`. A null timestamp could therefore throw while leaving a `DISABLED` or `INVALID` connection active without a successful verification. The implementation now assigns the validated local timestamp first, then mutates `status`, `lastVerifiedAt`, and `updatedAt`. Two regression tests verify that a rejected null timestamp leaves all three observable state values unchanged for both starting states. The focused rerun passed `17/17` with zero failures/errors/skips.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Create new connections as `DISABLED`. | Explicit Task 1/global lifecycle requirement; verification is the only re-enable path. | Existing scaffold created `ACTIVE`, which contradicted the plan. | Task 2/3 must persist and expose the disabled state until verification. |
| Preserve display casing but normalize whitespace; lowercase only `normalizeName`. | Matches existing Workspace display/normalized-name convention and Task 2's planned separate `nameNormalized` field. | Storing all names lowercase would lose user-facing casing. | Task 2 mapper must derive `nameNormalized` from `Connection.normalizeName(connection.getName())`. |
| Return `false` for every cross-workspace policy check. | Prevents authorization from crossing the Workspace boundary while keeping boolean policy APIs simple. | Role-only checks would incorrectly authorize an OWNER against another workspace. | Later use cases must load a membership from the target workspace and retain this check. |
| Keep usage out of `canManageIgnoringUsage`. | Task 1 explicitly defers Workflow usage protection. | Calling Workflow from a domain/application policy would violate scope and architecture. | Task 3+ must perform authoritative usage checks in the update/delete flows. |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `Connection.java`: defensive name/config normalization, `createNew` disabled status, `rename`, `updateConfig`, `markDisabled`, `markInvalid`, and `markVerified` with prevalidated non-null verification timestamps.
- `ConnectionProviderPolicy.java`: exact seven allowed provider/auth pairs, `BadRequestException` for rejected pairs, and `requiresCredential` (`NONE` false; all other auth types true).
- `ConnectionAuthorizationPolicy.java`: same-workspace OWNER-wide access and MEMBER creator-only manage/attach/config access; no usage or generic RBAC logic.
- Focused tests cover all provider/auth enum combinations, lifecycle transitions, matrix cases, and nonmatching workspace IDs.

### 7.2. Dữ liệu, schema và migration

- No database or migration changes.
- Existing JPA entities remain unchanged and compatible with the updated domain class.

### 7.3. Cấu hình, hạ tầng và dependency

- No dependency or configuration changes.
- Maven used the existing local dependency cache; no secret or `.env` file was read.

### 7.4. API, bảo mật và quan sát hệ thống

- No HTTP route or external contract changes.
- Authorization is a reusable application policy and explicitly enforces workspace equality before role/creator checks.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Sửa` | `services/workspace-service/src/main/java/com/weav/workspace/domain/model/Connection.java` | Lifecycle, name/config normalization, disabled creation. | Review display-name decision against Task 2 mapper expectations. |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionProviderPolicy.java` | Provider/auth compatibility and credential requirement policy. | No provider network behavior. |
| `Thêm` | `services/workspace-service/src/main/java/com/weav/workspace/application/service/ConnectionAuthorizationPolicy.java` | Workspace-scoped OWNER/MEMBER access matrix. | Usage check intentionally deferred. |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionDomainTest.java` | Lifecycle and normalization tests. | Focused unit tests. |
| `Thêm` | `services/workspace-service/src/test/java/com/weav/workspace/domain/ConnectionAuthorizationPolicyTest.java` | Provider matrix and authorization tests. | Includes cross-workspace rejection. |
| `Thêm` | `docs/work_logs/2026-09-15-workspace-connection-domain.md` | Evidence and handoff. | No secrets or generated output. |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| GitNexus context/impact | GitNexus `list_repos`, `context(Connection)`, `impact(Connection, upstream)` | Context exact; impact warning `CRITICAL`, one direct caller, 127 affected process entries, truncated result. | Index is at base commit and graph has same-name/cross-language noise; corroborated by source search. |
| Focused test | See exact command below. | Correction rerun `17/17` passed, zero failures/errors/skips (`ConnectionDomainTest` `10/10`, policy `7/7`). | Domain/policy tests only. |
| Existing regression | Same executable/cache paths below with `WorkspacePersistenceTest,WorkspaceDomainTest,MembershipDomainTest,WorkspaceAuthorizationPolicyTest,WorkspaceCleanArchitectureTest,WorkspaceDomainArchitectureTest` | `14/14` passed before this correction. | Includes real PostgreSQL/Testcontainers JPA compatibility. |
| Full Workspace | Same executable/cache paths below with `test` | `151/151` passed before this correction, zero failures/errors/skips. | Includes real PostgreSQL/Valkey Testcontainers and HTTP/security tests; expected dependency/outage warning logs appeared in tests. |
| Static/diff check | `git diff --check` | `PASS`. | New untracked files were inspected separately; no commit made. |

Exact focused command used by this Windows workspace (the wrapper itself is currently unusable under managed PowerShell):

```text
cmd.exe /d /c "set MAVEN_ARGS=-Dmaven.repo.local=C:\Users\nhoan\.m2\repository&& set JAVA_TOOL_OPTIONS=-Duser.timezone=UTC&& call C:\Users\nhoan\.m2\wrapper\dists\apache-maven-3.9.16\0daed3be3ebd1c706f0e69e8b07c6b73f5cc4ea3dfce72a8d0ec2e849ca2ddb0\bin\mvn.cmd -B -Dstyle.color=never -Dtest=ConnectionDomainTest,ConnectionAuthorizationPolicyTest test"
```

The same executable and `MAVEN_ARGS` cache path were used for the existing regression command with its listed class selector and for the full Workspace command with the `test` goal and no `-Dtest` selector.

### Điều chưa được kiểm tra

- No Task 2 persistence mapper/migration or Task 3 CRUD behavior was implemented or validated.
- No external provider, OAuth, credential encryption, Workflow usage, or browser flow was exercised because those tasks are out of scope.
- Coordinator has not yet run staged GitNexus `detect_changes`; it must include the new untracked classes/tests before commit.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| `Trung bình` | GitNexus reports `CRITICAL` upstream impact for `Connection`; method-level `markVerified` lookup is `UNKNOWN`. | One direct domain caller but hundreds of same-name/cross-language graph hits and a truncated listing; current index does not resolve the method directly. | Ran targeted source search at `Connection.java:80` and tests; source shows only the focused tests call `markVerified`. | `/root` reruns staged `detect_changes`, reviews graph/source diff before commit. |
| `Thấp` | Coordinator found an invalid partial mutation on null verification timestamps. | Original method assigned `ACTIVE` before `requireNonNull`; focused regression exposed the state-safety gap. | Validate into a local before mutation; `17/17` focused tests pass. | Coordinator reviews the correction; no broader rerun was needed for this domain-only ordering fix. |
| `Thấp` | Maven wrapper cannot start under current PowerShell runner. | `icm : Cannot index into a null array`. | Used installed Maven via `cmd.exe`; dependency-cache read required approved elevation. | Reuse the installed Maven invocation for current Windows environment. |
| `Thấp` | Display-case behavior was not specified in Task 1. | Plan specifies normalized key but Task 2 later introduces separate `nameNormalized`. | Preserved casing and normalized display whitespace, matching Workspace convention; recorded decision above. | Coordinator confirms during review; adjust before Task 2 if the final contract requires lowercase display names. |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. `/root` reviews the five implementation/test files and this log against Task 1, especially display-name semantics and `updateConfig` status behavior.
2. `/root` runs staged GitNexus change detection with all new files visible, then decides whether to commit the complete Task 1 milestone.
3. Future Task 2 work should add `nameNormalized` persistence and derive it only via `Connection.normalizeName(connection.getName())`.

### Cần quyết định / quyền truy cập từ người khác

- No user decision is required to review or test this bounded implementation. Coordinator review is still required before any commit.

### Hướng dẫn cho AI agent tiếp theo

- Read this log, Task 1 and Task 2 sections of the agent-ready plan, Workspace README, and `git status` before editing.
- Preserve the user-provided untracked plan and all unrelated changes.
- Do not expand into persistence, encryption, provider/OAuth, controllers, CRUD, Workflow usage, or generic RBAC in this milestone.
- If the exact `helper_unknown_error: setup refresh had errors` appears, stop immediately without retry/workaround.

## 12. Tham chiếu

- `docs/superpowers/plans/2026-09-14-workspace-connection-credential-v1-agent-ready.md` - Task 1 and global lifecycle/authorization constraints.
- `services/workspace-service/README.md` - Workspace ownership and deferred Connection/Credential boundary.
- `docs/superpowers/plans/2026-09-12-workspace-core.md` - Workspace architecture and conventions.
- `docs/work_logs/2026-09-12-workspace-foundation.md` through `docs/work_logs/2026-09-14-workspace-task12.md` - current Workspace milestone context.
- `.claude/skills/gitnexus-exploring/SKILL.md` and `.claude/skills/gitnexus-impact-analysis/SKILL.md` - graph-first exploration/impact requirements.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-15 09:45 Asia/Saigon` |
| Trạng thái worktree | `Có thay đổi chưa commit; user-provided plan preserved unchanged` |
| Commit/PR đã tạo | `Chưa tạo` |
| Người cập nhật log | `Workspace Connection Domain worker` |
| Cần đọc trước khi tiếp tục | `Task 1/2 plan sections, this log, and current git status` |

---

## Checklist trước khi đóng log

- [x] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [x] Mọi quyết định ảnh hưởng thiết kế đều có lý do.
- [x] File thay đổi và migration/dependency quan trọng đã được nêu.
- [x] Có lệnh hoặc thao tác tái lập cho các kiểm tra đã tuyên bố.
- [x] Rủi ro, blocker, and next step có chủ sở hữu hoặc hành động rõ ràng.
- [x] Không có secret, token, connection string nhạy cảm hoặc PII không cần thiết.
- [x] Trạng thái commit/PR và worktree là chính xác tại thời điểm ghi.

## Coordinator acceptance - 2026-09-15

Reviewed Task 1 production code and focused tests against the plan. The rejected-null verification mutation finding is fixed: validation now precedes every mutation, with DISABLED and INVALID regression cases preserving status, verification time, and updatedAt.

Independent focused Maven rerun using the exact command above passed 17/17 (10 domain, 7 policy), zero failures/errors/skips. Initial sandbox compilation could not read the existing Tomcat Maven cache JAR; approved elevated rerun passed. Worker full-suite evidence remains 151/151 before the bounded correction; no claim of a post-correction full-suite rerun. Whitespace check passed. No remaining blocking Task 1 findings. Config copying is shallow; provider/config validation and persistence remain later tasks.

Task 1 accepted for progression to Task 2. No commit or push performed. GitNexus CRITICAL/truncated class impact and UNKNOWN method impact remain graph coverage limitations, corroborated by source review and tests, not an all-clear graph verdict. Complete change detection remains required before any commit.
