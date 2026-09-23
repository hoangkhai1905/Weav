# Workflow Service V1 smoke handoff — 2026-09-23

- Branch: `feature/workflow-service`; shared checkout remains uncommitted.
- Current verification: Workflow Service 354/354 tests and package passed; Gateway unit 90/90, e2e 74/74, typecheck, and build passed; web Workflow Playwright 33/33 plus OCR builder 7/7 passed in mock mode. These do not prove the live cross-service path.
- Corrected the Workflow README smoke example to use Gateway port `3000`, matching `compose.dev.yml`; port `8081` belongs to Identity.
- `scripts/test-workflow-v1.ps1` is ready for a disposable workspace and a short-lived Identity token held only in the user's PowerShell process. It creates a persistent test workflow; the default false-branch fixture makes no outbound HTTP call. The runtime worker must be enabled for the execution to finish.
- Compose validation passed with both `.env.example` (user PowerShell) and `.env` (coordinator, elevated read-only Docker invocation). Docker is installed at `C:\Users\nhoan\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`; sandboxed execution is denied, elevated execution works. `docker ps` reported no running containers at inspection time.
- User authorized reading `.env`; inspected only relevant setting presence without displaying secrets. Database and JWT settings are populated. `IDENTITY_INTERNAL_SERVICE_KEY`, `WEAV_INTERNAL_SERVICE_KEY`, and `WORKFLOW_INTERNAL_SERVICE_KEY` are absent. `WORKFLOW_EXECUTION_WORKER_ENABLED` is absent, so Compose defaults to disabled. No smoke access token or workspace ID was available to the coordinator. `.env` remains unchanged and ignored by Git.
- User confirmed `.env` points to shared project databases, then explicitly authorized testing against them. All three Spring services support `DB_SCHEMA` for Hibernate and Flyway. Live acceptance will reuse the authorized database connections with unique test schemas, a separate local broker/cache/email sink, generated test-only credentials, and a test account/workspace created through service APIs. This avoids picking up existing Workflow schedules/executions. Keep existing schemas and `.env` unchanged.
- GitNexus `detect_changes` remains unresolved because the local index storage version is newer than the installed engine. Do not commit before rebuilding the index and rerunning graph change analysis.
- `git diff --check` passed; only existing LF/CRLF notices were reported.

## Next acceptance slice

- Scope: local smoke Compose configuration and PowerShell launcher reusing `scripts/test-workflow-v1.ps1`; bounded to test tooling and documentation, with no changes to business behavior. Test schemas are additive within the user-authorized shared database servers.
- Acceptance: real Gateway, Identity, Workspace, Workflow, PostgreSQL, and RabbitMQ path passes the existing safe false-branch smoke; auth/workspace setup uses public APIs and a local email sink if needed. Existing database schemas/data, shared `.env`, default Docker resources, and member T logs remain untouched.
- Verification: validate the standalone Compose model, verify endpoints are local and data stores are task-owned, run the smoke, review the diff, and record redacted results. If runtime exposes a source defect, report exact evidence for coordinator review instead of widening the worker scope.
