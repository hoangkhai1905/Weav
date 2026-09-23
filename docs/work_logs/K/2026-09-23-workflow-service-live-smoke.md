# Workflow Service V1 live smoke — 2026-09-23

## 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-23 / Asia/Saigon |
| Repository / branch | Weav / `feature/workflow-service` |
| Owner / reviewer | Codex worker / coordinator |
| Final status | Blocked before application startup |
| Scope | Isolated local smoke tooling and attempted live Workflow acceptance |

## 2. Outcome

- Added a dedicated Compose file and PowerShell launcher for the real Identity → Workspace → Gateway → Workflow acceptance path. The launcher uses new random database schema names, loopback-only ports, local Valkey/RabbitMQ/Mailpit, and generated process-only credentials.
- PowerShell syntax and the isolated Compose model passed validation. Source and migration inspection found schema selection through `DB_SCHEMA`/JDBC `currentSchema`, with no hardcoded Identity, Workspace, Workflow, or `public` relation qualifiers in the reviewed application paths.
- The live run stopped at Identity schema bootstrap. The PostgreSQL client exited with status 2; a separate read-only `SELECT current_schema()` probe also exited 2. PostgreSQL documents status 2 as a failed connection for a non-interactive session. No application container, API account/workspace, or Gateway workflow was started.

## 3. Scope and decisions

### In scope

- `compose.workflow-smoke.yml`
- `scripts/start-workflow-v1-live-smoke.ps1`
- The Workflow README local-acceptance section
- This new K work log

### Out of scope

- Application business code, migrations, root `.env`, the existing acceptance script, other work logs, and the member T logs.
- Stage, commit, push, external AI CLI use, or further agents.

### Isolation decisions

- Reuse the authorized root database connections only with freshly generated service-specific schemas. Bootstrap is the only database operation; it creates a schema and asks `current_schema()` to verify the search path before app startup.
- Never fall back to default schemas. Stop if a schema connection or verification fails.
- Use local broker/cache/email services, and do not send mail outside the local sink.
- Retain any created test schema for coordinator cleanup review; never drop database schemas from this helper.

## 4. Changes

| File | Change |
| --- | --- |
| `compose.workflow-smoke.yml` | Added isolated schema-bootstrap profiles and the minimal local Workflow smoke services with project-scoped resources and loopback bindings. |
| `scripts/start-workflow-v1-live-smoke.ps1` | Added safe Compose validation, unique schema generation, local-service/API smoke orchestration, secret-suppressed diagnostics, and cleanup after Compose resource attempts. |
| `services/workflow-service/README.md` | Documented the isolated live acceptance launcher and the existing direct Gateway smoke entry point. |
| `docs/work_logs/K/2026-09-23-workflow-service-live-smoke.md` | Recorded this attempt, its evidence, and the blocker. |

## 5. Verification

| Check | Command / evidence | Result |
| --- | --- | --- |
| PowerShell parse | `[void][scriptblock]::Create((Get-Content .\scripts\start-workflow-v1-live-smoke.ps1 -Raw))` | PASS |
| Smoke Compose config | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-workflow-v1-live-smoke.ps1 -ValidateOnly` | PASS; standalone config, schema-bootstrap profile, resolved service routing, and loopback/resource assertions; no schema or container created. |
| Repository Compose overlay | `docker compose --env-file .env -f compose.yml -f compose.dev.yml --profile app config --quiet` | PASS; no services started and resolved values were not printed. |
| Live database bootstrap | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-workflow-v1-live-smoke.ps1` | BLOCKED at `schema-bootstrap-identity`; `psql` exit 2. |
| Read-only connection probe | `SELECT current_schema()` with the generated test schema first in `search_path` | BLOCKED; `psql` exit 2, so schema isolation could not be established. |
| Docker cleanup | Inspected project-labeled networks and removed only unattached networks from this task’s smoke/probe projects | PASS; 4 removed, 0 attached. No app service or volume was started. |
| Existing automated suites | Prior results recorded in `2026-09-23-workflow-service-smoke-handoff.md` | Not rerun; this slice changed test tooling and documentation only. |
| Diff check | `git diff --check` plus a trailing-whitespace scan of the four owned files | PASS; Git emitted only existing LF/CRLF notices for unrelated `.env.example` and Workflow application property files. |

The PostgreSQL exit status is documented at [psql exit status](https://www.postgresql.org/docs/current/app-psql.html#APP-PSQL-EXIT-STATUS). The connection attempt failed before application startup; no normal-schema fallback or table read/write was performed.

## 6. Database and local-resource state

Identity schema names attempted, with creation status unconfirmed because the database connection could not be established or verified:

- `weav_workflow_smoke_identity_20260923_be8760492d00`
- `weav_workflow_smoke_identity_20260923_25bd95e0888a`
- `weav_workflow_smoke_identity_20260923_c9ac2730e1e5`
- `weav_workflow_smoke_identity_20260923_1f1ae75c5636`

Workspace and Workflow schema bootstrap did not run. No schema was intentionally dropped. Review the four Identity names before any cleanup; do not assume their creation state from the helper’s `confirmedSchemas=none` field alone.

Compose projects used for failed bootstrap attempts were `weav-workflow-smoke-20260923-be8760492d00`, `weav-workflow-smoke-20260923-25bd95e0888a`, `weav-workflow-smoke-20260923-c9ac2730e1e5`, and `weav-workflow-smoke-20260923-1f1ae75c5636`. A separate read-only probe project used the `weav-workflow-schema-probe-` prefix. The exact probe suffix was not retained; its project-labeled network was included in the cleanup sweep. Four unattached networks were removed, and no attached containers remained. No application service, RabbitMQ volume, local port binding, SMTP message, test account, workspace, or Workflow record was created by the live attempt.

## 7. Blocker and handoff

The isolated Identity bootstrap could not establish a PostgreSQL connection (`psql` exit 2), and the read-only schema-path probe failed the same way. The server’s exact connection cause is not established; do not infer a schema-permission failure. Do not proceed until a coordinator can verify the authorized database connectivity path. The helper should then be rerun with new unique schemas; review the four names above for possible partial creation before cleanup.

The repository was not committed. GitNexus change analysis remains unresolved per the existing handoff because the local index storage version does not match the installed engine.
