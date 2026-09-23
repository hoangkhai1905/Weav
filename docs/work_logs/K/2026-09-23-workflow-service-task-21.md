# Nhật ký ngày `2026-09-23` — Workflow Service Task 21

## 1. Metadata

| Trường | Giá trị |
| --- | --- |
| Ngày làm việc | `2026-09-23` |
| Múi giờ | `Asia/Saigon` |
| Dự án / repository | `Weav` (`T:\Weav`) |
| Nhánh / commit đầu ngày | `feature/workflow-service` / `c836de2` |
| Người thực hiện | Codex worker — Task 21 |
| Người review / nhận bàn giao | Root agent |
| Trạng thái | Đang chờ review; live Gateway stack chưa kiểm tra |
| Phạm vi | Workflow V1 acceptance, runtime configuration, operational docs |
| Liên kết | `docs/superpowers/plans/2026-09-21-workflow-service-v1.md`, `docs/superpowers/specs/workflow-service-spec.md` |

## 2. Tóm tắt

### Kết quả chính

- Added real HTTP + PostgreSQL + RabbitMQ acceptance over manual, webhook, schedule, immutable publication, pause/resume, multi-root branching/join, version pinning, capability boundaries, and connection-usage HTTP.
- Added safe contract fixtures and a Gateway smoke script that requires an explicit disposable-workspace switch, reads a process-only access token, and never prints token or one-time webhook credentials.
- Wired Workflow limits and service keys through `application.properties`, `.env.example`, and the dev Compose overlay. Readiness now includes PostgreSQL and RabbitMQ while liveness remains process-local; health details are hidden.
- Updated Workflow operational and HTTP contract docs. Existing runtime metrics are not exposed; the README names persisted evidence and present warning events without claiming missing counters.

### Tình trạng nhanh

| Hạng mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Build / compile | PASS | Workflow `verify` compiled main/test sources and packaged the executable JAR |
| Unit / integration test | PASS | Full Workflow `verify`: 354 tests, 0 failures/errors/skips; includes Testcontainers PostgreSQL/RabbitMQ acceptance |
| Workspace inter-service/security selectors | PASS | Task 21 selector set: 63 tests, 0 failures/errors/skips |
| Migration / database | PASS | Acceptance context migrated schema through V4 on its disposable PostgreSQL container |
| Health check | PASS | Acceptance HTTP verifies health, readiness, and liveness return 200 without components or service keys |
| Script and contract fixtures | PASS | PowerShell AST parser and JSON parsing for schema + all three examples passed; service acceptance consumed the fixtures and Workspace contract selector parsed OpenAPI |
| Compose validation | Chưa chạy | Docker, docker-compose, and Podman commands are unavailable; Testcontainers reached the Docker Desktop named pipe |
| Live Gateway stack | Chưa chạy | `WORKFLOW_TEST_ACCESS_TOKEN`, `WORKFLOW_TEST_WORKSPACE_ID`, and `WORKFLOW_GATEWAY_URL` were absent from process environment |
| Diff check | PASS | `git diff --check` returned no errors |
| Commit / PR | Chưa tạo | No stage, commit, or push per task instructions |

## 3. Mục tiêu và phạm vi

### Trong phạm vi

- Workflow service Testcontainers acceptance test and public contract fixtures.
- Root Gateway smoke script, Workflow README and contract docs, runtime property/env wiring, `.env.example`, `compose.dev.yml`, and K member log.

### Ngoài phạm vi

- `apps/web` Task 20, Gateway Task 19 source, OCR implementation, NodeExecutorRegistry, migrations, and production data were not changed.
- No live Gateway/Identity/Workspace/Workflow stack credentials or disposable Workspace were available.

### Tiêu chí hoàn thành

- [x] Persisted HTTP acceptance for trigger lifecycle, parallel branch/join states, immutable versions, and connection usage.
- [x] Configuration and operations documentation use named nonsecret placeholders and preserve disabled integration gates.
- [x] Full Workflow `verify`, focused Workspace contract/security selectors, script parser, and fixture checks pass.
- [ ] Docker Compose config and authenticated live Gateway smoke remain for an environment with Docker CLI, a controlled stack, and short-lived test access.

## 4. Bối cảnh và quyết định

- **Nguồn sự thật:** Task 21 plan and Workflow Service spec. Test fixtures under `packages/contracts/http/workflow/examples` are public inert samples; automated tests substitute the HTTP condition to prove the active parallel branch without making outbound network requests.
- **Test isolation:** Random workspace IDs and Testcontainers keep state out of production. V1 has no workflow-delete endpoint, so the external smoke script requires `-ConfirmDisposableWorkspace` and records created IDs only.
- **Secrets:** `.env.example` keeps all service keys, JWT signing material, and OCR signing file path empty. The script reads `WORKFLOW_TEST_ACCESS_TOKEN` from process environment and does not write or print it.
- **GitNexus:** `impact(OutboundHttpProperties, upstream)` returned `UNKNOWN` because the local index uses Ladybug storage v43 while the installed runtime is v42. Source inspection confirmed the configuration-properties prefix and setters. This change adds property bindings and does not edit the Java symbol.

## 5. Thay đổi

| File | Thay đổi |
| --- | --- |
| `services/workflow-service/src/test/java/com/weav/workflow/acceptance/WorkflowV1AcceptanceTest.java` | Real HTTP + Testcontainers tests: v1/v2 queued version pinning, pause/resume, webhook secret storage/404 behavior, paused schedule suppression, manual/webhook/schedule runs, condition branches and join attempts, capability and workspace scoping, hidden health details, fail-closed dependency, and draft/version connection usage. |
| `packages/contracts/http/workflow/examples/manual-http-condition.json` | Safe false branch by default for manual Gateway smoke; graph has manual/webhook/schedule roots, two parallel HTTP nodes, condition, inactive path, and join. |
| `packages/contracts/http/workflow/examples/google-sheets-read.template.json` | Google Sheets sample with explicit connection and spreadsheet replacement placeholders. |
| `packages/contracts/http/workflow/examples/manual-unconfigured-dependency.json` | Public inert fail-closed Email dependency sample. |
| `scripts/test-workflow-v1.ps1` | Gateway smoke; validates create/draft/list/publish/admission/SUCCESS/branch state and prints safe IDs/correlation only. Requires a disposable workspace and process env token. |
| `services/workflow-service/src/main/resources/application.properties` | Hide health details, readiness checks DB + Rabbit, keep liveness local, expose ingress limits and outbound HTTP bounds. |
| `services/workflow-service/src/test/resources/application.properties` | Match safe health detail/readiness settings; existing OCR test gates remain disabled. |
| `.env.example`, `compose.dev.yml` | Add nonsecret Workflow limits, Workspace client settings, worker/outbox/schedule settings, outbound bounds, and closed OCR defaults. Keys remain empty placeholders. |
| `services/workflow-service/README.md` | Runtime config, security, readiness, recovery, side-effect semantics, integration matrix, observability limits, and local smoke instructions. |
| `packages/contracts/http/workflow/README.md`, `openapi.yaml` | Mark webhook/schedule implementation live; describe one-time secrets, generic 404, schedule coalescing; correct local Workflow server port to 8080. |

## 6. Verification evidence

| Check | Command / action | Result |
| --- | --- | --- |
| Workflow verify | `Set-Location services/workflow-service`; `$env:JAVA_TOOL_OPTIONS='-Duser.timezone=UTC'`; cached Maven 3.9.16 with `-Dmaven.repo.local=C:\Users\nhoan\.m2\repository verify` | PASS, `Tests run: 354, Failures: 0, Errors: 0, Skipped: 0`; executable JAR packaged; Testcontainers connected through Docker Desktop named pipe |
| Workspace inter-service/security selectors | `Set-Location services/workspace-service`; cached Maven 3.9.16 with UTC and `-Dtest=WorkspaceHttpSecurityIntegrationTest,WorkspaceConnectionHttpIntegrationTest,InternalConnectionUseCasesTest,ConnectionUsageProtectionTest,WorkflowContractValidationTest test` | PASS, `Tests run: 63, Failures: 0, Errors: 0, Skipped: 0` |
| Script and fixtures | PowerShell `Parser.ParseFile` for `scripts/test-workflow-v1.ps1`; `ConvertFrom-Json` for Workflow schema and all JSON examples; covered fixtures in Workflow acceptance and OpenAPI in `WorkflowContractValidationTest` | PASS; schema and three examples parse, acceptance and contract tests pass |
| Compose tool check | `Get-Command docker,docker-compose,podman -ErrorAction SilentlyContinue`; checked standard Docker Desktop CLI paths | No Compose-capable CLI found; no installation or runtime changes attempted |
| Live config check | `Test-Path Env:WORKFLOW_TEST_ACCESS_TOKEN`, `...WORKFLOW_TEST_WORKSPACE_ID`, `...WORKFLOW_GATEWAY_URL` | All false; no live Gateway request attempted |
| Git diff | `git diff --check` | PASS |

The repository's `mvnw.cmd` wrapper did not start in this managed PowerShell shell (`Cannot start maven from wrapper`); the runs used the installed cached Maven binary and existing local Maven repository. An initial sandboxed compiler attempt was denied while resolving a cached Tomcat JAR; the full `verify` then passed with Maven cache access enabled. No Maven process remains active, and the Task20 peer confirmed its Maven slot was free.

## 7. Risks and blockers

| Mức độ | Vấn đề | Bằng chứng | Bước tiếp theo |
| --- | --- | --- | --- |
| Trung bình | Compose interpolation was not validated with Docker Compose | Docker CLI absent, although Java Testcontainers connected to the Docker Desktop daemon | Run `docker compose --env-file .env.example -f compose.yml -f compose.dev.yml config --quiet` when CLI is installed |
| Trung bình | Authenticated Gateway-to-Workflow smoke was not run | No controlled Gateway URL, workspace UUID, or process token was provisioned | Run script only against a controlled disposable Workspace with a short-lived scoped token |
| Thấp | Workflow-specific Micrometer metrics do not exist | Source search found no `MeterRegistry`/counter/gauge instrumentation; actuator exposes only health/info | README documents persisted evidence and existing warnings; add instrumentation in a separately scoped task before production dashboards |

## 8. Trạng thái bàn giao

- Ready for root review. The full Workflow `verify` passed 354/354 after the health configuration changes, and the focused Workspace inter-service/security selectors passed 63/63.
- No files were staged or committed. Shared worktree remains dirty with other task owners' changes; this log describes Task 21 files only.

## 9. Scratch report

Detailed compact handoff is stored at `.superpowers/sdd/2026-09-21-workflow-service-v1/scratchtask-21-report.md`. The path is ignored by `.superpowers/sdd/.gitignore` and must remain untracked.

## 10. Kết thúc

| Trường | Giá trị |
| --- | --- |
| Thời điểm bàn giao | `2026-09-23 20:05 Asia/Saigon` |
| Worktree | Dirty shared branch; Task 21 changes uncommitted |
| Commit / PR | Chưa tạo |
| Người cập nhật | Codex worker — Task 21 |
| Cần đọc trước khi tiếp tục | This log, Workflow Task 21 section in the plan, and the acceptance test |
