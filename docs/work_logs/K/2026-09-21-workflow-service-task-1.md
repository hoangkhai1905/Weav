# Nhật ký ngày `2026-09-21` — Workflow Service V1 Task 1

## Coordinator review — fix round 1

- Reviewed the worker's Task 1 source/diff/tests and reported 22/22 full suite. Acceptance is pending two reproduced edge cases.
- `JsonValues` currently accepts mutable/custom subclasses of `BigInteger`/`BigDecimal`; a compiled Java probe against current source showed the frozen numeric value changing after source mutation. Reject subclasses or otherwise guarantee the exact supported immutable JSON number contract; add regression coverage for both types.
- `WorkflowExecution.fail`, `NodeExecution.complete`, and `NodeExecutionAttempt.succeed` assign state before JSON validation can throw. A compiled probe showed a rejected update leaving the execution FAILED. Freeze into a local first; verify rejection preserves status, timestamps, and prior output/error for all three methods.
- Probe is in ignored `.superpowers/sdd/2026-09-21-workflow-service-v1/review-probe/Task1ReviewProbe.java`. No production code was changed by the coordinator.
- Probe evidence: `Frozen numeric subclass changed: 2` and `Rejected update left status: FAILED`.
- Worker receives this bounded fix round. A separate Luna MAX assistant will conduct read-only OpenCode/Copilot review of plan Tasks 2–3. No commit or next-task implementation is authorized before coordinator acceptance.
- Fix round 1 resolution: require exact standard `BigInteger`/`BigDecimal` classes, and validate all three mutator JSON arguments into locals before changing aggregate state. RED: 12 `JsonValuesTest` tests, 5 failures (both mutable number subclasses and each partial-state mutation). GREEN: focused suite 17/17 and final full suite 27/27; PostgreSQL JSONB test passed.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối ngày | Task 1 và coordinator fix round 1 hoàn thành; chưa commit |
| Phạm vi session | JSON snapshot utility, aggregate isolation, architecture rules, JSONB round-trip test |
| Liên kết liên quan | Task brief, V1 plan, authoritative Workflow spec, planning log |

## 2. Tóm tắt điều hành

### Kết quả chính

- Thêm `JsonValues.freeze(Object)` và `freezeMap(Map<String,Object>)` để sao chép JSON đệ quy, giữ explicit `null`, từ chối dữ liệu không phải JSON và trả về cấu trúc sâu bất biến.
- Áp dụng sao chép sâu cho tám aggregate Workflow/Execution được giao, gồm các cập nhật output/error hiện có; giữ nguyên trạng thái và lifecycle behavior.
- Chặn custom subclass của `BigInteger`/`BigDecimal`; ba mutator chỉ cập nhật aggregate sau khi JSON hợp lệ đã được freeze.
- Bổ sung kiểm tra kiến trúc, kiểm thử unit cho giá trị và aggregate, và một JSONB round trip qua PostgreSQL thật bằng Testcontainers.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Compile thành công trong full module test |
| Unit / integration test | `PASS` | Final fix-round suite: 27 tests, 0 failures/errors/skips |
| Migration / database | `PASS` | Existing V1 migration và JSONB round trip chạy trên PostgreSQL 18.6 Testcontainers; không sửa migration |
| Health check | `Chưa kiểm tra` | Không khởi chạy application stack |
| Review thay đổi | `Đã kiểm tra` | `git diff --check` sạch; source/diff tự rà soát |
| Commit / PR | Chưa tạo | Giữ thay đổi để coordinator review |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Bảo đảm JSON được lưu trong aggregate là snapshot sâu, không bị thay đổi qua map/list nguồn hoặc getter.
2. Giữ `null` hợp lệ trong JSON, từ chối kiểu/key không hợp lệ và không biến đổi trạng thái aggregate.
3. Chứng minh ranh giới kiến trúc và lưu trữ JSONB bằng kiểm thử.

### Trong phạm vi

- `JsonValues` mới; tám aggregate được nêu trong Task 1.
- Scaffold `WorkflowCleanArchitectureTest`, unit test JSON, PostgreSQL JSONB round trip.
- Work log Task 1 và báo cáo bàn giao.

### Ngoài phạm vi / chủ động chưa làm

- Tasks 2–21, use case/engine/lifecycle mới, API hoặc schema/migration mới.
- `AgentRun` và `AgentStep` JSON placeholder; không sửa các aggregate ngoài danh sách được giao.
- Docker/Compose/configuration, UI, contract liên service, startup application stack.
- Commit, stage, push, merge hoặc dọn file không thuộc Task 1.

### Tiêu chí hoàn thành

- [x] Deep copy, explicit JSON null, kiểm tra key/value/container, và immutable getters.
- [x] Aggregate constructors cùng các phương thức cập nhật JSON hiện có dùng utility.
- [x] ArchUnit rules và unit/integration evidence chạy được.
- [x] Work log và report được ghi; các file untracked có trước được giữ nguyên.

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Workflow Service V1 đang ở trạng thái scaffold. Spec `docs/superpowers/specs/workflow-service-spec.md` là nguồn sự thật; Task 1 không thêm lifecycle behavior.
- **Giả định đã dùng:** `freezeMap(null)` giữ hành vi tùy chọn hiện có bằng empty map; `freeze(null)` trả JSON null. Số được nhận là các kiểu Java chuẩn bất biến (`Byte`, `Short`, `Integer`, `Long`, `BigInteger`, `BigDecimal`) và `Float`/`Double` hữu hạn.
- **Ràng buộc:** Không sửa database schema, service/API contract, dependency hoặc framework configuration. Giữ nguyên ba tài liệu untracked đã có trước khi làm việc.
- **Nguồn sự thật:** Task brief, Task 1 trong `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, `docs/superpowers/specs/workflow-service-spec.md`, và POM/source hiện hành.

## 5. Nhật ký theo session / thời gian

### Session 1 — Task 1

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước sửa code | Đọc hướng dẫn/spec/plan/work log; kiểm tra branch và status | HEAD `c836de2`; ba file plan/spec/planning log untracked đã có được giữ nguyên | Xong |
| Trước sửa code | GitNexus query/context/upstream impact và baseline Workflow suite | Baseline 12 tests pass; impact không báo HIGH/CRITICAL | Xong |
| Trong phiên | Viết test trước, sau đó triển khai utility và aggregate integration | RED: compile thiếu `JsonValues`; 7 unit tests có 5 failures + 2 errors với stub identity; JSONB test 1 failure trước deep copy | Xong |
| 10:12 | Chạy nhóm test mục tiêu sau triển khai | 12 tests pass, gồm ArchUnit, JSON freeze, JSONB round trip và persistence test hiện có | Xong |
| 10:17 | Chạy full suite, phát hiện deprecation trong assertion test mới | 22 tests pass; thay assertion deprecated bằng structural `JsonNode` equality và kiểm tra lại riêng JSONB test | Xong |
| 10:18 | Chạy cuối full suite sạch sau lần sửa assertion | 22 tests pass, không có compiler deprecation; `git diff --check` sạch trước khi ghi log | Xong |

### Session 2 — Coordinator review fix round 1

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước sửa | Chạy GitNexus `impact` cho `fail`, `complete`, `succeed` và helper mới; tìm call sites | `fail`/`succeed`: UNKNOWN, 0 caller; `complete`: UNKNOWN/lower-bound, 1 receiver-typing gap; helper chưa có trong index. Source search không tìm production call sites | Xong |
| 10:48 | Bổ sung regression test trước implementation | RED: 12 unit tests, 5 failures gồm BigInteger/BigDecimal subclasses và state bị đổi bởi `fail`/`complete`/`succeed` khi input không hợp lệ | Xong |
| 10:49 | Sửa nhận diện immutable number và thứ tự cập nhật | Chỉ exact standard numeric classes được nhận; freeze vào biến local trước khi gán error/output/status/timestamp | Xong |
| 10:50 | Chạy focused suite | 17 tests pass, gồm 12 unit tests, 2 ArchUnit rules, 2 persistence tests và PostgreSQL JSONB round trip | Xong |
| 10:51 | Chạy full Workflow suite cuối fix round | 27 tests pass, 0 failures/errors/skips; compiler warning/deprecation output sạch; PostgreSQL 18.6/Testcontainers | Xong |

### Diễn giải quan trọng

- TDD RED đầu tiên là compile failure vì class chưa có; sau đó dùng stub identity tạm để quan sát lỗi hành vi, rồi thay stub bằng utility thực. Không giữ stub trong diff cuối.
- JSONB test dùng `Workflow` snapshot, Jackson tree và `WorkflowJpaEntity` hiện có; test flushes, clears persistence context, reloads row rồi xác minh `null` và list value còn nguyên.
- Review probe do coordinator cung cấp tái hiện BigInteger subclass đổi giá trị hiển thị sau khi freeze và `WorkflowExecution.fail` đổi trạng thái thành `FAILED` trước khi JSON rejection xảy ra. Regression RED lần này xác nhận cả BigDecimal subclass và ba mutator; source search sau đó chỉ thấy mutator call sites trong `JsonValuesTest`, không có production callers.
- GitNexus method impact: `fail` và `succeed` có `risk=UNKNOWN`, 0 caller được resolve; `complete` có `risk=UNKNOWN`, 0 caller và `epistemic=lower-bound` do 1 call site bị rơi vì receiver typing. `isImmutableNumber` không có trong index vì là symbol mới; source search cho thấy chỉ có khai báo private và call từ `JsonValues.freeze`.
- Maven wrapper trong sandbox gặp lỗi path `$MAVEN_M2_PATH.Target[0]` và quyền đọc cache/JAR; quyền Docker CLI cũng bị sandbox từ chối. Chạy kiểm thử được ủy quyền qua tool escalation, với `MAVEN_USER_HOME` trỏ tới junction tạm của `.m2` hiện có, `-Dmaven.repo.local` trỏ repository cache hiện có và `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC`. Không thay đổi wrapper, POM hay repo config.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Dùng `LinkedHashMap`/`ArrayList` để copy rồi bọc unmodifiable | Giữ thứ tự duyệt và tạo snapshot sâu; không dùng `Map.copyOf` vì nó từ chối explicit null và chỉ copy nông | Shallow copy hoặc stringify | Map/list lồng nhau được bảo vệ; dữ liệu không JSON báo lỗi rõ ràng |
| Chỉ nhận map string-keyed, list và scalar JSON chuẩn | Không âm thầm serialize arbitrary objects; từ chối container chu kỳ và số không hữu hạn | Chấp nhận mọi `Number`/`Collection` | Kiểu số custom/mutable và collection không phải list bị từ chối |
| Chỉ nhận exact standard `BigInteger`/`BigDecimal` class | Các class có thể subclass; probe chứng minh custom subclass có thể thay đổi `toString()` sau khi `freeze` | `instanceof` | Subclass tùy chỉnh bị từ chối; BigInteger/BigDecimal chuẩn vẫn giữ nguyên độ chính xác và scale |
| Freeze JSON update vào biến local trước khi đổi aggregate | Kiểm tra invalid/cyclic input có thể ném; mọi status/timestamp/output/error phải giữ nguyên khi validation thất bại | Gán status/timestamp trước khi freeze | `fail`, `complete`, `succeed` chỉ mutate sau khi freeze thành công |
| Dùng `.allowEmptyShould(true)` cho rule application | Các lớp application hiện là file scaffold rỗng | Bỏ rule đến khi có code | Rule có hiệu lực khi application source được thêm; kiểm thử hiện chạy qua scaffold |
| Thêm test JSONB độc lập | Giữ nguyên `WorkflowPersistenceTest` đang có tác động GitNexus `UNKNOWN` | Mở rộng test hiện hữu | Dùng PostgreSQL/Testcontainers thật; test context còn khởi động RabbitMQ theo cấu hình dùng chung |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `JsonValues.freeze` bảo toàn null, scalar JSON và số bất biến/hữu hạn; deep-copy map/list; từ chối object, key không phải chuỗi, số mutable/custom, số không hữu hạn và chu kỳ.
- Số `BigInteger`/`BigDecimal` chỉ được nhận khi runtime class chính xác là class chuẩn; subclass mutable bị từ chối, trong khi test giữ nguyên số nguyên lớn và scale của decimal chuẩn.
- `freezeMap` giữ optional null map thành immutable empty map.
- `Workflow`, `WorkflowVersion`, `WorkflowTrigger`, `WorkflowExecution`, `NodeExecution`, `NodeExecutionAttempt`, `ExecutionLog`, `OutboxEvent` dùng deep copy ở điểm nhận/cập nhật JSON; `fail`, `complete`, `succeed` validate JSON trước khi đổi status/timestamp/output/error.
- `WorkflowCleanArchitectureTest` cấm domain phụ thuộc Spring/framework, JPA, Hibernate, Jackson, RabbitMQ và các package HTTP phổ biến; cấm application phụ thuộc infrastructure/presentation.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Workflow schema hiện có.
- **Migration:** Không thêm/sửa migration; Testcontainers tự áp dụng migration V1 hiện có.
- **Dữ liệu test:** Một JSON definition có nested null và array chứa null/value; không dùng dữ liệu cá nhân.
- **Tính tương thích:** Không đổi schema/API; JSONB giữ explicit null sau persist/reload.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi cấu hình hay dependency. Test sử dụng Docker Desktop/Testcontainers có sẵn; test container ghi nhận PostgreSQL `18.6`.

### 7.4. API, bảo mật và quan sát hệ thống

- Không đổi route, contract, security, logging hoặc health endpoint.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/JsonValues.java` | JSON deep freeze utility | Utility framework-free |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/model/aggregate/{workflow,execution}/...` (8 aggregate) | Thay shallow copy bằng `freezeMap` | Không bao gồm AgentRun/AgentStep |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/architecture/WorkflowCleanArchitectureTest.java` | Bổ sung 2 ArchUnit rules | Rule app cho phép scaffold rỗng |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/definition/JsonValuesTest.java` | Scalar/null/list/map/invalid/cycle/aggregate/update-state assertions | 12 unit tests |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/WorkflowJsonbRoundTripTest.java` | PostgreSQL JSONB integration round trip | Testcontainers chạy Postgres và RabbitMQ dùng chung |
| `Thêm` | `docs/work_logs/T/2026-09-21-workflow-service-task-1.md` | Log Task 1 | Theo template work log |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-1-report.md` | Báo cáo cho coordinator | Không sửa plan/ledger dùng chung |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| Baseline | Module `services/workflow-service`: `mvnw.cmd -B '-Dstyle.color=never' test` với UTC timezone | PASS; 12 tests, 0 failures/errors/skips | Trước sửa code; Testcontainers đã dùng Docker |
| TDD RED ban đầu | `-Dtest=JsonValuesTest` khi `JsonValues` chưa tồn tại; sau đó stub identity; `-Dtest=WorkflowJsonbRoundTripTest` | Compile failure thiếu class; unit RED 7 tests (5 failures, 2 errors); JSONB RED 1 failure | Lỗi trước implement ở Task 1 |
| Fix round 1 RED | `-Dtest=JsonValuesTest test` | RED; 12 tests, 5 failures, 0 errors: BigInteger subclass, BigDecimal subclass, và ba aggregate mutators đổi state trước khi JSON rejection | Regression mới tái hiện cả hai finding |
| Task 1 focused GREEN | `-Dtest=JsonValuesTest,WorkflowCleanArchitectureTest,WorkflowPersistenceTest,WorkflowJsonbRoundTripTest test` | PASS; 12 tests, 0 failures/errors/skips | Trước coordinator fix round 1 |
| Fix round 1 focused GREEN | Cùng focused selector trên | PASS; 17 tests, 0 failures/errors/skips | 12 JSON tests, 2 ArchUnit, 2 persistence, 1 PostgreSQL JSONB |
| Sau assertion cuối | `-Dtest=WorkflowJsonbRoundTripTest test` | PASS; 1 test | Không còn compiler deprecation ở test mới |
| Task 1 full module | `clean test`, compiler warnings/deprecations enabled, UTC timezone | PASS; 22 tests, 0 failures/errors/skips | Trước fix round 1 |
| Fix round 1 full module | `clean test`, compiler warnings/deprecations enabled, UTC timezone | PASS; 27 tests, 0 failures/errors/skips | Full Workflow Service suite; real PostgreSQL 18.6/Testcontainers JSONB test |
| Static/diff | `git diff --check` và kiểm tra whitespace file mới | PASS, không có whitespace error | Re-run after final log/report edits |

Lệnh full module cuối cùng (PowerShell):

```powershell
$junction = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repo = 'C:\Users\nhoan\.m2\repository'
if (-not (Test-Path -LiteralPath $junction)) {
  New-Item -ItemType Junction -Path $junction -Target 'C:\Users\nhoan\.m2' | Out-Null
}
$junctionTarget = (Get-Item -LiteralPath $junction).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junction
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
Set-Location 'T:\Weav\services\workflow-service'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repo" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' clean test
```

Junction tại `C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home` trỏ tới `C:\Users\nhoan\.m2`; `-Dmaven.repo.local` trỏ chính xác tới `C:\Users\nhoan\.m2\repository`. Do wrapper/cache/Docker access bị sandbox chặn, lệnh đã chạy qua authorized escalation. Không có thay đổi cấu hình trong repo.

### Điều chưa được kiểm tra

- Không khởi chạy service thật/health check; Task 1 là domain snapshot và test persistence.
- Không chạy GitNexus `detect_changes`, vì không có commit trong phần việc này; chạy trước khi commit theo hướng dẫn repo.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Thấp | GitNexus index cũ | Index `4aad0cec6b572c085f3d51cee311db2a0d82753e` đứng sau HEAD 3 commit docs-only; lần refresh trước ghi nhận EPERM/stall | Dùng MCP graph với cảnh báo độ cũ, rồi tìm source/manual; không coi UNKNOWN là an toàn | Coordinator cân nhắc refresh index khi có môi trường ổn định |
| Thấp | `WorkflowExecution.fail`, `NodeExecution.complete`, `NodeExecutionAttempt.succeed` có impact `UNKNOWN` | Index không giải quyết receiver call; không có caller trong graph | Trước khi thêm regression test, `rg` trên Workflow main/test chỉ thấy declarations trong các class mục tiêu; test mới hiện gọi các method update để xác minh deep copy | Review coordinator; không mở rộng sang agent aggregates |
| Thấp | `NodeExecution.complete` caller walk là lower-bound | GitNexus ghi nhận một callsite không được resolve do receiver typing; `fail`/`succeed` đều 0 caller được resolve | Source search hiện chỉ thấy test calls; production callsite không tìm thấy. Giữ `UNKNOWN`, không coi 0 là all-clear | Index refresh/review trước commit nếu cần |
| Thấp | Helper `JsonValues.isImmutableNumber` không có trong index | Helper được tạo trong Task 1 sau snapshot index | Source review xác nhận helper private và chỉ được gọi từ `JsonValues.freeze`; graph không đưa ra risk verdict | Re-index trước commit nếu cần |
| Thấp | Wrapper/Docker bị sandbox chặn lúc đầu | Wrapper null array path và access denied trên cache/JAR/Docker CLI | Dùng escalation cho lệnh test được yêu cầu và junction Maven tạm | Không còn blocker; không đổi repo tooling |

Không có HIGH/CRITICAL GitNexus risk được ghi nhận. Với các aggregate, upstream class impact được báo `LOW`, thường có một factory/caller trong cùng class và không có process/module impact. `WorkflowPersistenceTest` được GitNexus báo `UNKNOWN`, nên không sửa; test JSONB mới được thêm riêng. Không đọc hay ghi secret.

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Review Task 1 diff và report: `.superpowers/sdd/2026-09-21-workflow-service-v1/task-1-report.md`.
2. Nếu chấp nhận, coordinator tiếp tục Task 2 theo shared plan; giữ Task 1 riêng để dễ review.
3. Chạy `detect_changes` trước commit; không có commit nào được tạo trong session.

### Cần quyết định / quyền truy cập từ người khác

- Không cần quyết định để review Task 1. Coordinator quyết định thời điểm index GitNexus được làm mới trước commit nếu cần.

### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, Task 1 report, spec và `git status` trước khi sửa.
- Không sửa các Task 2–21 khi review Task 1; không xóa/sửa ba file untracked ban đầu.
- Chạy `detect_changes` trước commit theo `AGENTS.md`.

## 12. Tham chiếu

- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-1-brief.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` — Global Constraints và Task 1
- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/work_logs/T/2026-09-21-workflow-service-planning.md`
- `docs/work_logs/log_template.md`

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 10:57 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi Task 1 chưa commit; ba file untracked đã có trước được giữ nguyên |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker |
| Cần đọc trước khi tiếp tục | Phần 11, Task 1 report, `git status` |

---

## Checklist trước khi đóng log

- [x] Tóm tắt nói rõ kết quả và phần chưa hoàn thành.
- [x] Quyết định kỹ thuật có lý do và hệ quả.
- [x] File thay đổi, migration và dependency được nêu.
- [x] Có lệnh tái lập cho kiểm tra đã tuyên bố.
- [x] Rủi ro và bước tiếp theo có chủ sở hữu.
- [x] Không có secret hoặc dữ liệu nhạy cảm.
- [x] Trạng thái commit/PR và worktree được ghi chính xác.
