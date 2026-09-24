# Workflow Service

Workflow Service owns workflow drafts and immutable published versions, trigger registrations, durable execution admission, bounded graph execution, and run monitoring. Public callers reach it through the API Gateway under `/api/v1`; the service itself receives paths without that prefix.

## Supported V1 behavior

- Manual runs require `WORKFLOW_RUN`; list and detail projections require `WORKFLOW_MONITOR`.
- Webhook registrations are provisioned on publication. `POST /webhooks/{endpointKey}` accepts `X-Webhook-Secret` and an optional JSON object. Unknown, invalid, missing, inactive, paused, or superseded registrations share the same generic `404` response. Publication returns a webhook secret once with `Cache-Control: no-store`; only its SHA-256 verifier is persisted. Republish creates a new endpoint key and secret, so update the sender before relying on the new registration.
- `trigger.schedule` uses Spring's six-field cron syntax and a required IANA timezone. The persisted timezone controls the scheduled instant; the JVM default timezone is not used. A daylight-saving gap skips a nonexistent local time, and a repeated local time during fall-back runs once at its earlier offset.
- Schedule admission, execution, outbox intent, and schedule advancement commit together. The unique `(trigger_id, scheduled_at)` index is the duplicate guard. After downtime the scanner coalesces missed ticks into one run for the stored due instant. Pausing disables current registrations; resume starts at the next future occurrence without replaying paused slots.
- Manual, webhook, and schedule admissions store the execution and UUID-only outbox intent before returning. The publisher waits for RabbitMQ confirms. Outbox recovery retries durable intents; worker leases and the recovery scanner allow stale work to be retried after process failure.
- Graph branches, joins, node state, attempts, and sanitized run logs are persisted. External side effects are at-least-once: a worker can make a provider call and crash before recording completion, so integrations should use idempotency where available.

## Configuration

Copy the root [`.env.example`](../../.env.example) to a local secret file and provision credentials through the local secret store. Never commit `.env`. The development Compose overlay passes the settings below to Workflow Service. A blank key keeps service-to-service calls closed.

| Environment variable | Purpose | Development default |
| --- | --- | --- |
| `WORKSPACE_SERVICE_URL`, `WORKSPACE_CONNECT_TIMEOUT`, `WORKSPACE_READ_TIMEOUT` | Workspace authorization and connection lookup client | `http://workspace-service:8080`, `3s`, `5s` |
| `WEAV_INTERNAL_SERVICE_KEY` | Workflow's key for Workspace's internal API | empty; provision the matching Workspace-side key locally |
| `WORKFLOW_INTERNAL_SERVICE_KEY` | Key for internal Workflow endpoints, including the Workspace usage check | empty; provision the matching caller-side key locally |
| `WORKFLOW_EXECUTION_INPUT_MAX_BYTES`, `WORKFLOW_EXECUTION_INPUT_MAX_DEPTH` | Parsed admission input bound | `1048576`, `32` |
| `WORKFLOW_WEBHOOK_RATE_LIMIT_REQUESTS_PER_WINDOW`, `WORKFLOW_WEBHOOK_RATE_LIMIT_WINDOW` | Process-wide webhook ingress limiter | `6000`, `1m` |
| `WORKFLOW_EXECUTION_OUTBOX_*` | Outbox batch, polling, lease, confirm, and retry bounds | See `.env.example` |
| `WORKFLOW_SCHEDULE_SCANNER_*`, `WORKFLOW_SCHEDULE_FAILURE_BACKOFF_MS` | Schedule scan batch and timing controls | enabled, batch `100`, poll `1000ms`, initial delay `1000ms`, backoff `30000ms` |
| `WORKFLOW_EXECUTION_WORKER_*` | Worker lease, heartbeat, confirm, and redelivery controls | worker disabled; lease `60s`, heartbeat `15s`, max redeliveries `3` |
| `WORKFLOW_EXECUTION_MAX_CONCURRENT_NODES`, `WORKFLOW_EXECUTION_EXECUTOR_*`, `WORKFLOW_EXECUTION_TIMER_THREADS` | Per-run concurrency and bounded executor capacity | `4`, `8`, queue `128`, timer threads `2` |
| `WORKFLOW_EXECUTION_RECOVERY_*` | Bounded stale-delivery and expired-lease recovery | See `.env.example` |
| `WORKFLOW_HTTP_CONNECT_TIMEOUT`, `WORKFLOW_HTTP_CALL_TIMEOUT` | Outbound HTTP adapter timeouts | `5s`, `30s` |
| `WORKFLOW_HTTP_MAX_REQUEST_BYTES`, `WORKFLOW_HTTP_MAX_RESPONSE_BYTES`, `WORKFLOW_HTTP_MAX_HEADER_BYTES` | Outbound request/response/header bounds | `1048576`, `1048576`, `65536` |
| `WORKFLOW_OCR_*`, `OCR_SERVICE_PRIVATE_URL` | OCR gates, private service URL, signing key id/path, and call bounds | all verification gates disabled; URL `http://ocr-service:8000` |

Workflow create/draft, manual execution, and webhook HTTP bodies have a fixed 1 MiB raw limit enforced before JSON parsing. Parsed execution input is also bounded by `WORKFLOW_EXECUTION_INPUT_MAX_BYTES` and `WORKFLOW_EXECUTION_INPUT_MAX_DEPTH`. The webhook fixed-window limiter is process-local, so multi-instance deployments apply the configured quota independently per instance. The outbound HTTP adapter has separate request, response, header, and timeout limits. Tighten these values for deployments with lower resource budgets; invalid configured ranges fail startup.

`WORKFLOW_INTERNAL_SERVICE_KEY` and `WEAV_INTERNAL_SERVICE_KEY` protect opposite service boundaries and are separate credentials. Rotate each with its paired caller and receiver in a coordinated deployment; this configuration does not provide an overlapping old/new key window. OCR signing material is a private-key file owned by deployment secret management. The path and key id are placeholders only: Compose does not mount a signing key, and OCR execution remains closed unless all service-claims, URL allowlist, artifact resolver, source, and top-level gates are explicitly verified.

The worker is off by default in the development overlay. Enable it only on an intended worker deployment. When enabled, verify RabbitMQ and adapter readiness before accepting production work. A broker outage leaves durable outbox rows pending for retry. A worker restart may replay a queued delivery or reclaim an expired lease; do not infer exactly-once provider execution from RabbitMQ delivery or database leasing.

## Health and observability

Only Actuator `health` and `info` are exposed. Health details and components are hidden. Readiness includes process readiness, PostgreSQL, and RabbitMQ; liveness includes only local process state so a dependency outage does not cause a restart loop.

The service does not currently expose Workflow-specific Micrometer counters or an Actuator metrics endpoint. Use the following persisted evidence while service metrics remain a follow-up:

| Operational signal | Persisted evidence | Existing log coverage |
| --- | --- | --- |
| Admitted, claimed, completed, or failed execution | `workflow_executions.status`, `started_at`, `finished_at`, `lease_owner`, `lease_until`, `trigger_type`, `workflow_version_id` | Worker boundary failures and lease-heartbeat failures are warnings; successful state transitions are persisted but not counted in logs |
| Pending outbox count and age | `outbox_events.status`, `created_at`, `next_attempt_at`, `retry_count`, publisher lease columns | Confirm, serialization, and broker delivery failures log event UUID and failure type |
| Expired worker leases | Active execution rows with `lease_until <= now()` | Recovery decisions are persisted; no dedicated expired-lease counter is exposed |
| Attempts and provider timeout/rejection | `node_execution_attempts.status`, `error.code`; `execution_logs.event_type` | Provider response bodies are not logged; query failure codes by node type and time window |
| Trigger scan and schedule-admission failure | `workflow_triggers.last_error` and retry time | Warnings identify schedule trigger ID; no per-scan success counter exists |
| Workspace dependency failure | N/A beyond affected operation state | Structured warning includes request ID, operation, downstream name, and error type |

These database fields and warning events are diagnostic sources, not production metrics or a substitute for dashboards. Add low-cardinality Micrometer counters/gauges and alert thresholds before relying on this service for production observability.

## Integration readiness

| Capability | V1 runtime state |
| --- | --- |
| Manual, webhook, scheduled triggers | Implemented; schedule and webhook registrations are persisted and version-scoped |
| `http.request` | Implemented with URL policy, socket validation, bounded request/response bytes, and timeouts; real external effects require controlled allowlisted targets |
| `google.sheets` | Implemented; requires an authorized Workspace connection and provider credential |
| OCR | Adapter is present but disabled by default. Keep all OCR flags false until the private verifier, URL-source controls, and artifact resolver are proven together |
| `email.send`, `telegram.send_message`, Telegram triggers, and AI nodes without configured adapters | Fail closed or publish disabled with `DEPENDENCY_NOT_CONFIGURED`; do not treat editor visibility as service readiness |

Readiness reports PostgreSQL and RabbitMQ only; it does not claim that external provider credentials or the Workspace service are reachable. Check those integrations using controlled service-level acceptance and the corresponding dependency status before enabling them.

## Local acceptance

[`scripts/start-workflow-v1-live-smoke.ps1`](../../scripts/start-workflow-v1-live-smoke.ps1) provisions and runs the live acceptance path using the root `.env` database connections. It validates the isolated Compose model first, generates three unique test schema names, and creates those schemas with separate one-off PostgreSQL clients. Before any application starts, each client confirms that its connection search path resolves only to its new schema. The Identity, Workspace, and Workflow containers receive their matching `DB_SCHEMA` and JDBC `currentSchema` values; the application worker and schedule scanner therefore operate only on the new Workflow schema.

```powershell
Set-Location T:\Weav
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-workflow-v1-live-smoke.ps1
```

To validate the resolved standalone Compose configuration without creating database schemas or starting containers, append `-ValidateOnly`.

The helper uses a unique Compose project, an isolated network, a project-scoped RabbitMQ volume, and randomly selected host ports bound to `127.0.0.1`. It starts only Identity, Workspace, Workflow, local Valkey, local RabbitMQ, and Mailpit. SMTP points only to Mailpit, and test JWT/internal-service keys, the registration password, OTP, access token, and other generated credentials stay in process memory. The helper registers and verifies an account through Identity APIs, creates a workspace through the public Workspace API, and passes that returned workspace UUID and Identity-issued token to the direct Workflow Service smoke script. It does not edit `.env`.

The helper prints the Compose project, loopback ports, and all three schema names. It removes its Compose containers, network, and project volume after the smoke, and attempts that cleanup after any Compose resource attempt. It deliberately leaves any created test schemas and their account, workspace, workflow, and execution data in the shared database for explicit coordinator cleanup review; it never drops schemas. If schema creation, database permissions, or schema verification fails, it stops before starting application containers and does not fall back to the ordinary Identity, Workspace, or Workflow schemas. The default fixture takes the false condition branch, so its HTTP nodes remain skipped and the smoke reports zero outbound HTTP calls.

[`scripts/test-workflow-v1.ps1`](../../scripts/test-workflow-v1.ps1) remains available when a controlled Workflow Service URL, Workspace UUID, and short-lived Identity token already exist. Pass `-WorkflowUrl` with the service base URL. It requires `WORKFLOW_TEST_ACCESS_TOKEN` in the process environment and `-ConfirmDisposableWorkspace`; it never prints the token or one-time webhook credentials. V1 has no workflow-delete endpoint, so the created workflow remains in its test schema.

The automated `WorkflowV1AcceptanceTest` uses real PostgreSQL and RabbitMQ Testcontainers, random workspaces, and signed test JWTs. Outbound HTTP is replaced at its adapter boundary so the persisted graph, admissions, broker delivery, worker, and projections execute without network side effects. Separate integration tests cover publication/scanner concurrency, schedule coalescing, outbox rollback, stale leases, and worker recovery.

```powershell
Set-Location services/workflow-service
$env:JAVA_TOOL_OPTIONS = '-Duser.timezone=UTC'
.\mvnw.cmd -B '-Dstyle.color=never' '-Dtest=WorkflowV1AcceptanceTest' test
```

The exact Maven launcher may instead be invoked from the repository's configured wrapper/runtime. The live helper requires the Docker Desktop CLI at `C:\Users\nhoan\AppData\Local\Programs\DockerDesktop\resources\bin\docker.exe`, the root `.env`, and permission to create new schemas in each configured service database. It does not use root Compose's fixed containers, ports, or volumes.
