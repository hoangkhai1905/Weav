# Nhật ký ngày `2026-09-21` — Workflow Service V1 Task 2

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối ngày | Task 2 hoàn thành; chưa commit |
| Phạm vi session | Workflow definition records/catalog, draft/publish validation, Jackson codec, JSON Schema và test |
| Liên kết liên quan | Workflow Service V1 plan, authoritative spec, Task 2 report |

## 2. Tóm tắt điều hành

### Kết quả chính

- Thêm immutable domain records `WorkflowDefinition`, `Node`, `Edge`, catalog 13 node V1, `ValidationIssue` và validator thuần Java.
- Phân biệt draft structural/security validation với publish required-config, graph/DAG, reachability, trigger-root, port và schedule validation.
- Thêm Jackson 3 codec cùng JSON Schema 2020-12 cho draft envelope và catalog/config shapes; schema và catalog được kiểm tra field-by-field trong test.
- Kiểm thử codec giữ nested JSON `null`, snapshot mutation, malformed fields, UUID, credential safety, limits và graph rules.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú ngắn |
| --- | --- | --- |
| Build / compile | `PASS` | Full Workflow module Maven test compile thành công; không có compiler deprecation/warning |
| Unit / integration test | `PASS` | Focused 35/35; full suite 62/62, không failure/error/skip |
| Migration / database | `PASS` | Không thêm migration; full suite chạy JSONB round trip trên PostgreSQL 18.6/Testcontainers |
| Health check | `Chưa kiểm tra` | Không khởi chạy service stack; Task 2 là domain/codec/schema |
| Review thay đổi | `Đã kiểm tra` | Scope rà soát, `git diff --check` và kiểm tra whitespace file mới sạch |
| Commit / PR | Chưa tạo | Thay đổi được giữ cho coordinator review |

## 3. Mục tiêu và phạm vi

### Mục tiêu đầu session

1. Tạo model executable graph bất biến và catalog node V1 rõ ràng.
2. Kiểm tra drafts cho cấu trúc/giới hạn/ID/credential safety; chỉ yêu cầu đầy đủ config và graph semantics khi publish.
3. Decode/encode JSON bằng hạ tầng Jackson mà không kéo framework vào domain; công bố schema draft.

### Trong phạm vi

- `WorkflowDefinition`, `DefinitionValidator`, `NodeCatalog`, `ValidationIssue`.
- `DefinitionJsonCodec`, `packages/contracts/http/workflow/definition.schema.json`.
- Hai test suite tập trung và log/report Task 2.

### Ngoài phạm vi / chủ động chưa làm

- Tasks 3–21; mapping parser/static upstream reference checks thuộc Task 3.
- Wiring application/use case, Spring schedule adapter, HTTP endpoint, persistence behavior hoặc rejected-draft database proof (Task 5).
- Migration, UI, agent/task execution, provider integrations, commit/stage/push/merge.
- Chỉnh sửa `JsonValues` hoặc các Task 1 aggregate; không sửa plan/ledger dùng chung.

### Tiêu chí hoàn thành

- [x] Deep immutable snapshots cho graph lists, node config và variables; giới hạn JSON depth/definition size.
- [x] 13 types được hỗ trợ; `agent.task` và `google.docs` bị từ chối.
- [x] Draft và publish checks tách riêng; schedule callback không phụ thuộc Spring.
- [x] Codec và schema draft/config shape có test; config field parity với `NodeCatalog` được kiểm tra.
- [x] Focused và full Workflow tests, diff check, work log/report.

## 4. Bối cảnh và giả định

- **Bối cảnh hệ thống:** Task 1 đã được coordinator chấp nhận. `JsonValues.freezeMap` là helper deep-freeze cho JSON. Spec tại `docs/superpowers/specs/workflow-service-spec.md` là nguồn sự thật.
- **Giả định đã dùng:** Email dùng `to`, `subject`, `body`, theo default hiện tại của UI catalog đã được coordinator làm rõ. `to` nhận string hoặc danh sách string.
- **Ràng buộc:** Draft cho phép thiếu required config/nguồn OCR nhưng vẫn từ chối shape sai, catalog field sai, ID sai, credential fields và URL userinfo. Mapping grammar không được nhân đôi trong Task 2.
- **Nguồn sự thật:** Task 2 và clarification trong `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, authoritative spec, `JsonValues` và POM hiện tại.

## 5. Nhật ký theo session / thời gian

### Session 1 — Task 2

| Thời điểm | Việc đã thực hiện | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Trước sửa | Đọc spec, plan Task 2/clarification, hướng dẫn, work log/template và Task 1 JSON helper; kiểm tra branch/status | HEAD `c836de2`; file plan/spec/planning log và Task 1 files có sẵn được giữ nguyên | Xong |
| Trước sửa | GitNexus upstream impact cho tên symbol mới | `DefinitionValidator`/`DefinitionJsonCodec`: target không có trong index, `risk=UNKNOWN`; `WorkflowDefinition` bị resolve nhầm sang web TypeScript interface, HIGH/32 callers; source search xác nhận Java record là file backend mới và UI không sửa | Xong |
| 11:39 | Viết test Task 2 trước implementation và sửa cú pháp test | Sau khi sửa text block/generic-map assertion, RED compile báo 12 lỗi thiếu đúng các production types Task 2 | Xong |
| 11:45–12:11 | Thêm domain records/catalog/validator, codec, schema; lặp focused tests | Sau khi thêm schema, suite tập trung lần lượt đạt 30/30, 31/31 rồi 35/35 qua các thay đổi cuối | Xong |
| 12:14 | Chạy full Workflow module suite với Docker/Testcontainers | 62 tests, 0 failures/errors/skips; PostgreSQL 18.6 JSONB round trip pass | Xong |
| 12:15 | Rà scope và whitespace | `git diff --check` cùng trailing-whitespace check cho file mới đều pass | Xong |

### Diễn giải quan trọng

- RED đầu tiên sau khi test syntax hợp lệ là test-compile failure với 12 missing-symbol errors cho `DefinitionValidator`, `WorkflowDefinition`, `NodeCatalog` và `DefinitionJsonCodec`; đó là feature RED dự kiến trước production implementation. Trước bước này có một text-block syntax typo và hai generic `Map<?,?>.put` assertion không compile; đã sửa cả hai trước khi nhận feature RED.
- Một focused run trung gian sau production code có 30 test, 1 failure duy nhất vì schema file chưa được tạo. Sau khi schema và các parity assertions được thêm, focused run cuối pass 35/35.
- `WorkflowDefinition` copy lists và freeze nested config/variables. Depth 32 tính trên cả envelope; codec kiểm tra depth trước khi chuyển tree sang Java objects. JSONB round trip test là test Task 1 có sẵn và được chạy lại trong full suite.
- Draft không parse mapping. Kiểm tra ordering operand chỉ hoãn type khi thấy delimiter; parser/grammar và static upstream checks vẫn thuộc Task 3. `DefinitionValidator()` từ chối schedule publish với `SCHEDULE_VALIDATION_UNAVAILABLE`; application wiring sẽ cấp callback khi Task 16 cung cấp cron/timezone adapter.
- Schema cố ý để `config` fields không bắt buộc trong draft. Schema thể hiện node/config type/enum/UUID/count; Java làm thêm unique IDs, depth/bytes, credential checks và graph semantics. Test kiểm tra schema config property names khớp `NodeCatalog` cho toàn bộ 13 types.
- GitNexus index báo stale ba commits. Hai symbol backend mới không được indexed (`UNKNOWN` không được coi là low/safe); tên `WorkflowDefinition` bị trùng với TypeScript UI interface có HIGH impact, nhưng `rg` xác nhận đây là path khác và không có UI edit. Không thử reindex do giới hạn/tooling caveat được ghi ở Task 1.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả và việc theo dõi |
| --- | --- | --- | --- |
| Ghi nhận definition bằng Java records và immutable list/map snapshots | Definition là giá trị JSON thuần; `JsonValues.freezeMap` giữ explicit null và deep copy | Mutable DTO/JPA entity | Domain tách khỏi storage/framework; cấu hình sau khi nhận không đổi theo nguồn/getter |
| Tách draft structural/security checks khỏi publish completeness/graph checks | Task 2 clarification cho phép node chưa hoàn thiện khi lưu draft | Bắt buộc mọi field ở draft | UI có thể lưu cấu hình chưa xong; publish vẫn fail theo field/graph |
| Dùng nested `ScheduleValidation` callback | Domain không được import Spring `CronExpression`; no-arg phải fail closed khi schedule cần xác minh | Parse cron hoặc timezone trong domain | Task 16 cung cấp adapter qua application wiring |
| Không tạo mapping parser trong Task 2 | Task 3 sở hữu grammar và static upstream references | Regex/second parser trong validator | Mapping expression được giữ ở config; Task 3 phải hoàn thiện publish integration |
| Dùng JSON Schema 2020-12 làm draft/config envelope | Tài liệu contract có thể biểu diễn shape/enum/UUID/count nhưng không graph/depth-byte rules | Yêu cầu publish-complete required fields ở schema | Java là enforcement bổ sung; `$comment` mô tả parity boundary |
| Không chọn provider-specific email fields | Spec chỉ định typed recipient/subject/body; coordinator xác nhận `to`/`subject`/`body` từ current UI default | Thêm cc/bcc/provider options | Các field ngoài hợp đồng bị từ chối; không thay đổi UI |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `WorkflowDefinition`, `Node`, `Edge` deep-freeze JSON config/variables, copy graph lists, giữ null value và enforce depth tổng thể 32.
- `NodeCatalog` cho đúng 13 types và allowed config field whitelist.
- `DefinitionValidator` kiểm tra schema version, field/type shape, required publish fields, connection UUID, credential/header names không phân biệt hoa thường, URL userinfo, giới hạn, graph IDs/edges/DAG/reachability, trigger roots, branch ports và schedule callback.
- `DefinitionJsonCodec` decode/encode JSON qua Jackson 3; reject malformed/unknown envelope/node/edge fields, non-object config, JSON depth vượt 32 và serialized input vượt 1 MiB; chuyển nested JSON null qua lại.
- `definition.schema.json` mô tả 13 types, config field type/enum shapes, connection UUID và draft node/edge bounds; không bắt buộc publish-complete fields.

### 7.2. Dữ liệu, schema và migration

- **Database/schema:** Không đổi Workflow database schema.
- **Migration:** Không thêm/sửa migration.
- **Dữ liệu test:** Nested null/map/list, test credentials tổng hợp, UUID giả ngẫu nhiên và graph hư cấu; không dùng secret/PII.
- **Tính tương thích:** Không thay endpoint/database contract; Task 2 chỉ thêm domain/codec/schema types.

### 7.3. Cấu hình, hạ tầng và dependency

- Không đổi dependency/configuration. Test dùng Maven cache hiện có qua junction tạm; Testcontainers kết nối Docker Desktop hiện có.

### 7.4. API, bảo mật và quan sát hệ thống

- Chưa thêm route. Validator không echo rejected values; diagnostics giữ node/field/code/message tổng quát. HTTP SSRF destination controls vẫn thuộc execution/integration work, không được xem là hoàn tất ở Task 2.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý cho người tiếp nhận |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/WorkflowDefinition.java` | Immutable definition/node/edge records | Pure Java, dùng `JsonValues` |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java` | Draft/publish/security/graph validation | Mapping parser được để Task 3; schedule callback cần adapter sau |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/NodeCatalog.java` | Whitelist 13 types và config fields | Loại bỏ UI legacy/provider-only fields |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/ValidationIssue.java` | Safe validation diagnostic record | Không giữ rejected config values |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodec.java` | Jackson JSON/record conversion | Infrastructure-only Jackson dependency |
| `Thêm` | `packages/contracts/http/workflow/definition.schema.json` | JSON Schema draft/config contract | Graph/credential/depth/size validation ở Java |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/domain/definition/DefinitionValidatorTest.java` | Catalog/draft/publish/graph/security/limit tests | 31 test cases |
| `Thêm` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodecTest.java` | JSON codec/schema/immutability/limits | 4 test cases |
| `Thêm` | `docs/work_logs/T/2026-09-21-workflow-service-task-2.md` | Work log theo template | No plan/ledger edits |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-2-report.md` | Coordinator report | Ignored local artifact, no commit |

## 9. Kiểm tra và bằng chứng

| Hạng mục | Lệnh / thao tác tái lập | Kết quả thực tế | Phạm vi và giới hạn |
| --- | --- | --- | --- |
| TDD RED | Focused Maven selector trước khi có Task 2 production types | Test compile thất bại với 12 missing-symbol errors | Sau khi sửa test syntax/generic assertions; đúng trạng thái trước implementation |
| Focused Task 2 | `-Dtest=DefinitionValidatorTest,DefinitionJsonCodecTest test` | PASS; 35 tests, 0 failures/errors/skips | 31 validator + 4 codec/schema tests |
| Full Workflow module | Maven module `test`, UTC timezone, compiler warnings/deprecations enabled | PASS; 62 tests, 0 failures/errors/skips | Bao gồm ArchUnit, SecurityConfig, persistence và actual PostgreSQL JSONB round trip |
| PostgreSQL JSONB | `WorkflowJsonbRoundTripTest` trong full suite | PASS; 1 test, PostgreSQL 18.6 Testcontainers, V1 migration applied | Database test dùng container; không thêm migration |
| Docker | Testcontainers probe qua Maven suite | Docker Desktop 29.8.0, local Npipe socket, kết nối thành công | RabbitMQ/PostgreSQL là test fixtures; không khởi chạy compose application stack |
| Static/diff | `git diff --check` và PowerShell trailing whitespace scan cho các file mới | PASS | Lặp lại sau work log/report |

Focused lệnh PowerShell đã chạy (Maven cache junction đã được xác minh):

```powershell
$junction = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repo = 'C:\Users\nhoan\.m2\repository'
$junctionTarget = (Get-Item -LiteralPath $junction).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junction
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
Set-Location 'T:\Weav\services\workflow-service'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repo" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' '-Dtest=DefinitionValidatorTest,DefinitionJsonCodecTest' '-DfailIfNoTests=false' test
```

Final full suite command:

```powershell
$junction = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repo = 'C:\Users\nhoan\.m2\repository'
$junctionTarget = (Get-Item -LiteralPath $junction).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junction
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
Set-Location 'T:\Weav\services\workflow-service'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repo" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' test
```

### Điều chưa được kiểm tra

- Không chạy JSON Schema compliance engine riêng; test đọc schema bằng Jackson, so catalog type/field parity và các giới hạn chính. Không thêm dependency schema-validator.
- Không chạy route/service end-to-end; endpoint, persistence wiring và Task 5 rejected-draft proof vẫn chưa được implement.
- Không chạy GitNexus `detect_changes` vì không commit; trước commit cần chạy theo `AGENTS.md`.

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Nguyên nhân / dấu hiệu | Cách xử lý hiện tại | Chủ sở hữu / bước tiếp theo |
| --- | --- | --- | --- | --- |
| Trung bình | GitNexus chưa bao phủ symbol backend mới | Index 3 commits behind; impacts trả `UNKNOWN`; trùng tên `WorkflowDefinition` resolve web TS interface HIGH | Source `rg` xác nhận khác file/layer; không đổi UI; ghi caveat, không reindex loop | Coordinator đánh giá; refresh index khi công cụ ổn định |
| Trung bình | Mapping grammar/static upstream reference chưa validate | Task 3 owns parser và validation | Không tạo parser thứ hai; giữ rõ trong code/worklog/schema comment | Task 3 cập nhật validator |
| Thấp | Schedule publish chưa thể được xác thực bởi no-arg validator | Spring cron/timezone adapter thuộc Task 16 | No-arg publish fail closed bằng `SCHEDULE_VALIDATION_UNAVAILABLE` | Task 16 wiring |
| Thấp | Mockito dynamic-agent JVM warning trong full suite | Existing security tests dùng inline Mockito trên Java 25 | Test pass; không chỉnh POM/dependencies trong Task 2 | Theo dõi nếu JDK tương lai cấm dynamic attach |

### Lỗi có thể tái lập

```text
Initial valid test-only RED: test compilation failed on 12 missing Task 2 production symbols.
Final focused: 35 tests passed. Final full Workflow module: 62 tests passed.
```

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator review Task 2 diff/schema/test and decide whether to accept progression.
2. Task 3 can add mapping parser/static upstream validation to `DefinitionValidator` without reimplementing Task 2 shape/security rules.
3. Task 16 can supply `ScheduleValidation` adapter; no-arg validator intentionally stays fail-closed.

### Cần quyết định / quyền truy cập từ người khác

- Không có quyền truy cập còn thiếu. Mapping validation behavior is explicitly Task 3; schedule cron/timezone validation implementation is Task 16.

### Hướng dẫn cho AI agent tiếp theo

- Đọc file log này, authoritative spec, Task 2/3 clarification và `git status` trước khi sửa.
- Không thay Task 1 changes hoặc các plan/spec/planning/CLI logs có trước Task 2.
- Không sửa parser/credential rules trước impact và source review; giữ diagnostics sanitized.
- Không commit/push cho tới khi coordinator review/ủy quyền.

## 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`
- `docs/work_logs/T/2026-09-21-workflow-service-planning.md`
- `docs/work_logs/log_template.md`
- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-2-report.md`
- GitNexus findings: `DefinitionValidator` and `DefinitionJsonCodec` target not found/UNKNOWN; `WorkflowDefinition` name resolves to the unrelated web interface, HIGH; index three commits stale.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 12:15 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit: Task 1 + Task 2, cùng các pre-existing untracked planning/spec/CLI files |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker |
| Cần đọc trước khi tiếp tục | Mục 10 (GitNexus/mapping/schedule caveats), Task 2 report, current plan Task 3 |
