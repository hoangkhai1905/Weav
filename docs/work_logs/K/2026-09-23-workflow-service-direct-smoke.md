# Workflow Service V1 direct live acceptance — 2026-09-23

## 1. Metadata

| Field | Value |
| --- | --- |
| Date / timezone | 2026-09-23 / Asia/Saigon |
| Repository / branch | Weav / `feature/workflow-service` |
| Owner / reviewer | Codex coordinator / user |
| Status | Workflow direct live smoke passed; Gateway handoff pending partner |
| Scope | Workflow-only smoke tooling, plan scope note, and verification |

## 2. Outcome

- User moved Gateway integration to their partner. The earlier Task 19 Gateway changes were discarded by the user; this session did not edit those shared files. The plan now labels Task 19 as partner-owned.
- Reworked `compose.workflow-smoke.yml`, `scripts/start-workflow-v1-live-smoke.ps1`, `scripts/test-workflow-v1.ps1`, and the Workflow README local acceptance section to call Workflow Service directly. No Gateway container is started by the smoke.
- Direct live acceptance passed with Identity registration/OTP/login, public Workspace creation, Workflow draft create/save/get/list, publish, manual execution admission, and persisted successful node states. The safe fixture skipped both outbound HTTP nodes and the join; reported outbound HTTP calls: zero.
- Isolated Compose project, network, containers, and RabbitMQ volume were removed after the pass. Test schemas and their records remain in the shared databases for explicit review; the helper never drops schemas.

## 3. Decisions and boundaries

- Local smoke uses service-specific test schemas, process-only credentials, loopback ports, local Valkey/RabbitMQ/Mailpit, and direct Neon endpoints for test processes because the configured pooled hosts did not accept the bootstrap search-path setting. Root `.env` was not edited or printed.
- The partner owns Gateway routes, tests, and contract. Gateway forwarding is not included in the Workflow completion claim. Earlier Gateway test results remain historical evidence only.
- PowerShell's omitted typed `Body` parameter was interpreted as an empty string. The smoke now checks whether the parameter was bound before attaching a request body, fixing the GET `ProtocolViolationBodyOnVerb` failure. A temporary connection-closing change was reverted after diagnosis.

## 4. Changed files

| File | Change |
| --- | --- |
| `compose.workflow-smoke.yml` | Removed Gateway service; exposed Workflow on a random loopback-only port. |
| `scripts/start-workflow-v1-live-smoke.ps1` | Validates/starts the Workflow-only stack and calls the direct service smoke. |
| `scripts/test-workflow-v1.ps1` | Uses `-WorkflowUrl` and service paths, fixes bodyless GET, retains redacted failure classification. |
| `services/workflow-service/README.md` | Documents direct Workflow acceptance and retained schema cleanup policy. |
| `docs/superpowers/plans/2026-09-21-workflow-service-v1.md` | Marks Gateway as partner-owned and direct service smoke as this branch's gate. |

## 5. Verification

| Check | Result |
| --- | --- |
| PowerShell parse of both scripts | PASS |
| `start-workflow-v1-live-smoke.ps1 -ValidateOnly` | PASS; no schema/container creation |
| `start-workflow-v1-live-smoke.ps1 -TestSchemaSuffix '20260923_a256bb0427d1'` | PASS; create 201, draft/get/list/publish 200, admission 202, detail 200, execution SUCCESS |
| Node states | `condition` and `inactive-branch`: SUCCESS, 1 attempt; `left-http`, `right-http`, `join-http`: SKIPPED, 0 attempts |
| Compose cleanup | PASS; project `weav-workflow-smoke-20260923-17e274c98b1e` and its volume removed |
| `git diff --check` | PASS; existing LF/CRLF notices only |
| Existing Workflow/Workspace/web suites | Prior results recorded in `2026-09-23-workflow-service-smoke-handoff.md`; not rerun for this test-tooling change |

The passing run retained these task-owned schemas: `weav_workflow_smoke_identity_20260923_a256bb0427d1`, `weav_workflow_smoke_workspace_20260923_a256bb0427d1`, and `weav_workflow_smoke_workflow_20260923_a256bb0427d1`. Earlier failed/bootstrap attempts and their possible schema names are recorded in `2026-09-23-workflow-service-live-smoke.md`; check exact ownership and existence before any manual cleanup. No schema was dropped in this session.

## 6. Handoff

- Workflow Service's direct runtime path is verified. The partner still needs to integrate and test Gateway forwarding against it.
- Real provider Sheets/OCR acceptance remains gated by approved credentials/contracts; disabled adapters are not claimed as operational.
- The branch remains uncommitted. GitNexus change detection remains unresolved because the local index storage version does not match the installed engine; do not commit until that gate passes.
