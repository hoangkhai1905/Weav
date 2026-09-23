# Nhật ký ngày `2026-09-21` — Workflow Service V1 Task 3

## Bổ sung sau coordinator review

- Coordinator phát hiện `{{ nodes.a.output. }}` bị chấp nhận như tham chiếu tới toàn bộ output vì parser nhầm dấu chấm cuối thành path rỗng. Đã thêm regression cho ID đơn và ID dotted ở cả `references(value)`, `references(value, knownIds)` và `resolve`; parser nay từ chối empty trailing segment nhưng vẫn chấp nhận `{{ nodes.a.output }}`.
- GitNexus impact cho `nodeReferenceAt`/`MappingResolverTest` trả `UNKNOWN` hoặc target-not-found do index stale; source search xác nhận production caller ở `DefinitionValidator` gọi `references(value, nodeIds)` và tests gọi parser/resolver. Không thu hẹp quy tắc ID dotted.
- TDD RED: `MappingResolverTest` chạy 17 tests và đúng 1 failure vì `references()` không ném `MappingException` cho trailing dot. Sau sửa, cùng selector PASS 17/17.
- Sau khi thêm Task 9 domain/tests, focused selector chung PASS 102/102; full Workflow suite PASS 132/132, gồm Testcontainers PostgreSQL/RabbitMQ. Maven slot đã trả cho security worker; Task 5 và coordinator acceptance vẫn pending.
- Follow-up `git diff --check` exit 0; PowerShell trailing-whitespace scan trên mapping/execution source, tests, logs và reports cũng PASS. Git chỉ in line-ending notices cho application.properties thuộc security lane.
- Log được lưu theo yêu cầu của user tại `docs/work_logs/K/`; mục file cũ dưới `T/` bên dưới đã được sửa.

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-21` |
| Múi giờ ghi log | `Asia/Saigon` |
| Dự án / repository | `Weav` |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de239fe09907a9db11e953f2f3e9588b1e3d` |
| Người thực hiện | Codex Luna MAX worker — graph/mapping lane |
| Người review / nhận bàn giao | `/root` — coordinator |
| Trạng thái cuối session | Task 3 implementation và kiểm tra hoàn tất; chưa commit; chờ coordinator review |
| Phạm vi session | Rà Task 2, hoàn thiện safe mapping và publish-time static upstream validation |
| Liên kết liên quan | `docs/superpowers/specs/workflow-service-spec.md`, Task 2/3 trong plan V1 |

## 2. Tóm tắt điều hành

### Kết quả chính

- Rà lại Task 2 theo spec và tìm hai lỗi cụ thể: mapping ở các field có kiểu/enumeration bị kiểm tra như literal trước khi resolve; JSON Schema cho ID chấp nhận chuỗi chỉ có whitespace trong khi Java từ chối.
- Thêm `MappingContext`, `MappingResolver`, `MappingException` với snapshot JSON sâu, giữ explicit `null`, bảo toàn kiểu cho expression nguyên chuỗi, chỉ nội suy scalar và không đưa expression/input vào diagnostics.
- Thêm grammar publish-only, static node-reference ancestry qua graph, phân giải ID có dấu chấm bằng node IDs đã biết và lỗi khi có nhiều parse hợp lệ. Runtime resolver chỉ dùng output map do engine cấp; nó không tự suy diễn ancestry/active path.
- Thêm regression về mapping, đồ thị, ID/schema parity và các giới hạn đúng tại/qua ngưỡng.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Build / compile | `PASS` | Full Workflow Maven test lifecycle compile thành công |
| Unit / integration test | `PASS` | Focused 88/88; full module 118/118; 0 failure/error/skip |
| Migration / database | `PASS` trong test | Không đổi migration; Testcontainers/PostgreSQL 18.6 round-trip vẫn pass |
| Health check | Chưa kiểm tra | Không chạy service stack |
| Review thay đổi | Đã kiểm tra | `git diff --check` sau khi hoàn tất tài liệu |
| Commit / PR | Chưa tạo | Giữ thay đổi chưa stage để coordinator review |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- Review/fix Task 2 `DefinitionValidator` và JSON Schema trong các path graph lane sở hữu.
- Implement mapping context/resolver/error, nested resolution, parser grammar và publish-time static upstream validation.
- Regression tests, báo cáo Task 3 và work log riêng.

### Ngoài phạm vi

- Task 4 authentication/Workspace client thuộc security worker; không sửa file của lane đó.
- Runtime engine, typed-config validation sau mapping, persistence/API/UI, Task 5 trở đi, plan/progress ledger.
- Stage, commit, push, merge hoặc chạy external agent CLI.

### Tiêu chí hoàn thành

- [x] Draft giữ được mapping chưa hoàn chỉnh; publish kiểm tra grammar và graph ancestry.
- [x] Resolver phân biệt missing với explicit null, giữ nguyên kiểu expression nguyên chuỗi, xử lý map/list lồng nhau và không sửa input.
- [x] Mapping error ổn định `MAPPING_ERROR`, không retry, không echo biểu thức, có node/field khi caller cung cấp destination.
- [x] Regression tại/qua các giới hạn definition/codec và test mapping/graph chạy xanh.
- [x] Work log/report cập nhật; Maven slot trả lại security worker.

## 4. Bối cảnh và giả định

- **Nguồn sự thật:** Spec phần Data mapping; plan Task 2/3 và clarification trong `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md`.
- **Graph semantics:** Static validator kiểm tra node tham chiếu là strict upstream ancestor qua các edge đã biết. Runtime engine về sau chỉ truyền outputs từ successful nodes trên active path; resolver không thể tự xác minh điều này.
- **Dotted IDs:** Không giới hạn thêm cú pháp node ID. Parser so khớp `nodes.<id>.output` với ID trong definition/runtime context; nhiều match hợp lệ là ambiguous và bị từ chối. Overload `references(value)` không có graph dùng marker `.output` đầu tiên; validator phải dùng overload có node IDs.
- **Mapping completeness:** Draft cho phép mapping thiếu/chưa hoàn thiện. Parser và static reference checks chỉ chạy tại publish.
- **Resolved types:** Mapping values cho typed/enum fields được grammar-validate khi publish; kiểm tra giá trị cụ thể sau resolve thuộc runtime Task 11. `connectionId` tiếp tục là UUID literal.

## 5. Nhật ký theo session / thời gian

| Mốc | Việc đã làm | Kết quả / bằng chứng | Trạng thái |
| --- | --- | --- | --- |
| Đầu session | Đọc AGENTS, spec, plan, progress, Task 2 report, work log template, status; kiểm tra Task 2 source/schema/tests | Giữ nguyên thay đổi có trước; ghi nhận GitNexus stale 3 commits và `UNKNOWN` cho symbols chưa index | Xong |
| Trước sửa | GitNexus upstream impact theo yêu cầu trước khi sửa symbol | `DefinitionValidator` chưa có trong index (`UNKNOWN`); `WorkflowDefinition` bị resolve nhầm sang TS UI symbol (`HIGH`, 32 callers). Search source xác nhận file Java là domain mới; không sửa UI | Xong |
| Trước implementation | Viết Task 3 tests trước production và chạy focused suite | RED test-compile vì thiếu `MappingResolver`, đúng trạng thái trước implementation | Xong |
| Implementation | Thêm resolver/context/error và nối validator với publish-time refs | Tests cover type/null/nesting/syntax/unavailable output/dotted IDs/ancestor path | Xong |
| Review Task 2 | Thêm tests/fix mapping typed fields và whitespace-only IDs | `maxLength`, HTTP method, headers có mapping được defer tới resolve; ID pattern schema đồng bộ với Java blank check | Xong |
| Verification | Focused suite với Task 4 source đã sẵn sàng | 88 tests, 0 failure/error/skip | Xong |
| Verification | Full Workflow module suite với UTC và Testcontainers | 118 tests, 0 failure/error/skip; BUILD SUCCESS; PostgreSQL 18.6 | Xong |
| Handoff | Trả Maven slot security worker, cập nhật báo cáo/log | Worker xác nhận sẽ chờ post-test edits; không còn source/test edits từ graph lane | Xong |

### Diễn giải quan trọng

- Task 2 source review thấy draft/publish separation, graph checks, JSON/depth/count bounds, credential-field/header screening, URL userinfo screening và null-preserving snapshots phù hợp hướng plan. Hai issue cụ thể đã sửa được ghi ở mục 6.
- Lần Maven sớm trước production mapping cho feature RED đúng dự kiến. Sau đó Task 4 test sources ban đầu chưa compile vì production types của worker kia đang được thêm; không sửa file Task 4. Khi security worker báo compile-ready, focused selector và full module suite đều chạy thành công.
- Schema được parse bằng PowerShell `ConvertFrom-Json`; pattern `\S` được kiểm tra thủ công cho chuỗi rỗng/whitespace-only và ID hợp lệ. Không có JSON Schema compliance engine riêng trong dependency hiện tại.

## 6. Quyết định kỹ thuật

| Quyết định | Lý do / bằng chứng | Phương án đã cân nhắc | Hệ quả / theo dõi |
| --- | --- | --- | --- |
| Freeze context/input bằng `JsonValues` và giữ null | Context là JSON snapshot; nested `null` phải khác missing | Mutable source maps hoặc quy null thành rỗng | Resolver không sửa input; giá trị lồng nhau trả về bất biến |
| Dùng graph IDs / available output keys để tách node ID dotted | IDs hiện không bị giới hạn ký tự ngoài blank check; parser cần biết boundary `output` | Cấm dấu chấm trong IDs | Không tạo API restriction; ambiguous graph parse trả MAPPING_ERROR |
| Không xác định runtime ancestry trong resolver | Runtime caller sẽ đưa đúng successful active-path outputs; resolver chỉ xử lý map được cấp | Resolver tự đọc toàn graph/branch | Engine chịu trách nhiệm cung cấp context đúng; absent output luôn lỗi |
| Defer field type/enum checks cho mapped values | Plan yêu cầu grammar publish và kiểm tra kiểu sau khi resolve | Từ chối mapping trên method/maxLength/header-object | Typed runtime revalidation thuộc Task 11; connectionId vẫn literal UUID |
| Schema IDs dùng `pattern: \\S` | `minLength: 1` cho phép ID toàn whitespace trong khi Java `isBlank()` từ chối | Restrict toàn bộ ký tự/cú pháp ID | Chỉ đồng bộ nonblank; giữ nguyên các ID hợp lệ hiện có |

## 7. Thay đổi đã thực hiện

### 7.1. Code và hành vi

- `MappingContext` deep-freeze trigger input, outputs và variables; giữ explicit JSON null.
- `MappingResolver` xử lý recursive map/list, `trigger.input`, `nodes.<nodeId>.output`, `variables`, dot property paths; expression nguyên chuỗi giữ nguyên JSON type; embedded expression chỉ scalar/null text. Brackets, calls, operators, malformed delimiters, missing properties, traversal qua non-object, unavailable output và ambiguous node candidates trả non-retryable `MAPPING_ERROR`.
- `MappingException` cung cấp code ổn định, `retryable=false`, destination node/field khi `resolve(..., destinationNodeId, destinationField)` được gọi; không đưa expression vào message.
- `DefinitionValidator` chỉ parse mapping khi publish và dùng transitive edge closure để yêu cầu node reference là upstream ancestor. Draft chưa hoàn chỉnh vẫn editable.
- Mapped string values qua shape/enum checks ban đầu; connectionId không được map. Literal fields tiếp tục được kiểm tra sớm. Runtime sau resolve cần validate typed config theo plan.
- JSON Schema từ chối whitespace-only node ID, edge ID/source/target; không áp thêm format hạn chế khác cho ID.

### 7.2. Dữ liệu, schema và migration

- Không thay đổi database schema hay migration.
- Schema JSON draft/config được cập nhật duy nhất cho tính nhất quán nonblank identifier.

### 7.3. Cấu hình, hạ tầng và dependency

- Không thêm dependency hoặc đổi cấu hình.
- Maven dùng cache junction đã xác minh và UTC timezone; Testcontainers Docker được sử dụng bởi test hiện có.

### 7.4. API, bảo mật và quan sát hệ thống

- Không thêm route.
- Diagnostics không echo mapping text, credential values hoặc output data.
- Resolver chỉ nhận outputs do caller cung cấp; “successful active-path only” là contract tương lai của engine, chưa được chứng minh bởi implementation engine trong session này.

## 8. Danh sách file ảnh hưởng

| Loại | Đường dẫn | Thay đổi chính | Lưu ý |
| --- | --- | --- | --- |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingContext.java` | Immutable runtime mapping values | Giữ nested null |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingException.java` | Safe stable mapping error | Caller thêm destination context |
| `Thêm` | `services/workflow-service/src/main/java/com/weav/workflow/domain/mapping/MappingResolver.java` | Parser, recursive resolver, reference collection | Không tự tính ancestry |
| `Sửa` | `services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java` | Publish mapping/ancestor checks; defer typed mapping values | Task 2 file mới/untracked trước lane này |
| `Sửa` | `packages/contracts/http/workflow/definition.schema.json` | Nonblank identifier pattern | Giữ ID rules rộng |
| `Thêm/Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/domain/mapping/MappingResolverTest.java` | Mapping grammar/type/null/nesting/error/graph refs | Không thực thi code người dùng |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/domain/definition/DefinitionValidatorTest.java` | Mapping publish/draft, ancestry, dotted IDs, field deferral, count/byte/depth boundaries | Credential and graph tests retained |
| `Sửa` | `services/workflow-service/src/test/java/com/weav/workflow/infrastructure/definition/DefinitionJsonCodecTest.java` | Schema/Java ID parity, exact codec byte limit | Không có compliance engine dependency |
| `Thêm` | `.superpowers/sdd/2026-09-21-workflow-service-v1/task-3-report.md` | Coordinator handoff report | Local scratch artifact |
| `Thêm` | `docs/work_logs/K/2026-09-21-workflow-service-task-3.md` | Session work log | Không sửa plan/ledger |

## 9. Kiểm tra và bằng chứng

Maven commands chạy trong `services/workflow-service` sau khi xác minh junction trỏ `C:\Users\nhoan\.m2`:

```powershell
$junctionPath = 'C:\Users\nhoan\AppData\Local\Temp\weav-workflow-task1-fixround1-maven-home'
$repoPath = 'C:\Users\nhoan\.m2\repository'
$junctionTarget = (Get-Item -LiteralPath $junctionPath).Target
if ($junctionTarget -ne 'C:\Users\nhoan\.m2') { throw "Unexpected Maven home junction target: $junctionTarget" }
$env:MAVEN_USER_HOME = $junctionPath
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repoPath" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' '-Dtest=MappingResolverTest,DefinitionValidatorTest,DefinitionJsonCodecTest,WorkspaceClientTest,WorkflowSecurityTest' '-DfailIfNoTests=false' test
.\mvnw.cmd -B '-Dstyle.color=never' "-Dmaven.repo.local=$repoPath" '-Dmaven.compiler.showDeprecation=true' '-Dmaven.compiler.showWarnings=true' test
```

| Hạng mục | Kết quả | Phạm vi / giới hạn |
| --- | --- | --- |
| RED | test compile thất bại do thiếu `MappingResolver` trước implementation | Feature RED dự kiến |
| Focused | PASS, 88 tests, 0 failure/error/skip | Mapping/definition/codec và Task 4 Workspace/security regressions |
| Full Workflow | PASS, 118 tests, 0 failure/error/skip | Bao gồm architecture, existing Task 1 tests, Task 4, PostgreSQL JSONB/Testcontainers |
| Byte/depth/count | PASS | Definition exact 1 MiB và over; codec exact 1 MiB và over; depth max/over; nodes/edges max/over |
| Schema syntax | PASS | PowerShell `ConvertFrom-Json`; không chạy full JSON Schema validator |
| Static/diff | PASS | `git diff --check` sau khi viết docs |

## 10. Sự cố, rủi ro và blocker

| Mức độ | Vấn đề | Dấu hiệu | Xử lý / việc tiếp theo |
| --- | --- | --- | --- |
| Trung bình | GitNexus index stale và symbols backend mới chưa indexed | `DefinitionValidator` impact trả `UNKNOWN`; `WorkflowDefinition` đụng tên với UI TS symbol và báo HIGH | Source search xác nhận file/layer backend mới; không sửa UI; trước commit coordinator cần xem lại impact/change detection |
| Thấp | Chưa có runtime engine/type check sau resolve | Lane này chỉ thêm context/resolver/static validation | Task 11 phải validate resolved config; engine phải cấp outputs của successful active path |
| Thấp | JSON Schema chưa được validate bằng standalone schema engine | POM không có compliance dependency; test so field/catalog/bounds và pattern | Có thể thêm schema-validator khi contract tooling được phê duyệt; không block Java tests |
| Thấp | Mockito dynamic-agent warning trong suite | Runtime warning từ test framework trên JDK 25 | Tests pass; không thay đổi build configuration |

## 11. Trạng thái bàn giao

### Có thể tiếp tục ngay

1. Coordinator review hai Task 2 findings, Task 3 code và combined Task 4 diff.
2. Task 11 cần gọi `MappingResolver.resolve` với node/field và chỉ successful active-path outputs, sau đó revalidate typed config.
3. Chạy GitNexus `detect_changes` theo AGENTS trước commit; chưa stage/commit/push.

### Cần quyết định / quyền truy cập từ người khác

- Không có blocker cần user input. Coordinator acceptance cho Task 2/3 vẫn pending.

### Hướng dẫn cho AI agent tiếp theo

- Đọc log này, spec, plan/progress và `git status` trước khi tiếp tục.
- Chỉ sửa graph lane paths nếu đang sửa Task 3; security lane có ownership riêng và Maven runs cần được serialize.
- Giữ các mapping/ancestry decisions ở mục 4/6 trừ khi coordinator chỉ đạo khác.

## 12. Tham chiếu

- `docs/superpowers/specs/workflow-service-spec.md`, section 6.
- `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, Tasks 2–3 và clarified interfaces.
- `.superpowers/sdd/2026-09-21-workflow-service-v1/progress.md`, mapping decisions and ownership.
- `.superpowers/sdd/2026-09-21-workflow-service-v1/task-2-report.md`.

## 13. Kết thúc session

| Trường | Giá trị |
| --- | --- |
| Thời điểm dừng | `2026-09-21 17:08 Asia/Saigon` |
| Trạng thái worktree | Có thay đổi chưa commit; có Task 1/2 và security-worker files cùng branch |
| Commit/PR đã tạo | Chưa tạo |
| Người cập nhật log | Codex Luna MAX worker — graph/mapping lane |
| Cần đọc trước khi tiếp tục | Mục 4/6/11 và `task-3-report.md` |
