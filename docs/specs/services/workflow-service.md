# Workflow Service

> Status: V1 core (drafts, publish, versions, manual/webhook/schedule runs, monitoring, notification events, AI generation endpoint) Implemented; workflow delete and Agent Runtime Planned or fail-closed. The Telegram trigger and `telegram.send_message` node are Implemented (2026-10-04, see `docs/work_logs/K/workflow/telegram-nodes.md`). Owner: K. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

Workflow Service (Spring Boot, Java) is the core domain. It owns the canonical `WorkflowDefinition` (nodes, edges, ports, data mappings, triggers), drafts and immutable published versions, definition validation, trigger registrations (manual, webhook, schedule), durable execution admission, the background worker that runs the node graph (worker and Agent Runtime live inside this service, not as separate services), node executors, run monitoring, the AI generation use case (`WorkflowIntent` to deterministic compile to `WorkflowDefinition` to validator), and workflow notification events.

Not responsible for: users/sessions (Identity), workspaces, membership, permissions, connections and credential storage (Workspace; Workflow only asks it to authorize/resolve), LLM reasoning (AI Service, reasoning only), OCR processing (OCR Service), Telegram bot accounts (a workspace connection), rendering notifications (Notification Service), public ingress/rate limiting/edge auth (API Gateway, owned by the partner).

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC011 | Create workflow | Implemented | `POST .../workflows`; requires `WORKFLOW_CREATE`; emits `workflow.created`. |
| UC012 | Edit workflow | Implemented | `PUT .../draft` (`WORKFLOW_EDIT`) and `GET` detail/list. |
| UC013 | Save draft | Implemented | Draft stored as `DRAFT`; never runs automatically. |
| UC014 | Generate workflow from natural language | Partial | `POST .../workflows/generate` implemented, off by default (`WORKFLOW_AI_ENABLED`, `WORKFLOW_AI_GENERATION_ENABLED`); Gateway route is a pending partner handoff. Returns an unsaved proposal only. |
| UC015 | Publish workflow | Implemented | `POST .../publish` (`WORKFLOW_PUBLISH`); validates then writes an immutable version, provisions triggers. |
| UC016 | Pause/Resume workflow | Implemented | `pause`/`resume` (`WORKFLOW_MANAGE_STATE`); emits `workflow.paused`/`workflow.resumed`. |
| UC017 | Delete workflow | Planned | Schema has `workflows.deleted_at` and queries filter it, but no DELETE endpoint or service exists in the controllers. |
| UC018 | Run workflow manually | Implemented | `POST .../executions` (`WORKFLOW_RUN`), 202 with `QUEUED`. Execution needs the worker enabled. |
| UC019 | Monitor executions | Implemented | List/detail projections (`WORKFLOW_MONITOR`), sanitized, paged logs. |
| UC021 | Trigger via webhook | Implemented | `POST /webhooks/{endpointKey}` with `X-Webhook-Secret`; public ingress via Gateway (Gateway side owned by partner). |
| UC022 | Trigger via Telegram | Implemented | `trigger.telegram` needs a `TELEGRAM` connection and `WORKFLOW_PUBLIC_BASE_URL` (https; otherwise it publishes disabled with `DEPENDENCY_NOT_CONFIGURED`). Publish and resume call Bot API `setWebhook` with a random `secret_token` (only its hash is stored); pause and a superseding republish call `deleteWebhook`. Ingress is `POST /webhooks/telegram/{endpointKey}` (header `X-Telegram-Bot-Api-Secret-Token`, `telegram:<update_id>` idempotency). One bot serves one active workflow (`TELEGRAM_BOT_IN_USE`); registration failures return `TELEGRAM_WEBHOOK_REGISTRATION_FAILED` (502) and publish nothing. |
| UC024 | Interact via Telegram bot | Implemented (reduced) | A `trigger.telegram` message plus a `telegram.send_message` reply is the interaction; there is no chat command surface. |
| UC028 | Monitor all executions (admin) | Planned | No system-admin, cross-workspace endpoint found; only workspace-scoped monitoring. |
| UC020 | Receive result notifications | Partial | Producer side Implemented (outbox to RabbitMQ); consumer is Notification. |

## Business rules

| Rule | Enforcement in Workflow |
| --- | --- |
| BR01 | User JWT required on all public routes; every operation is checked against Workspace with the actor id ([SecurityConfig](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/SecurityConfig.java), [WorkspaceClient](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/workspace/WorkspaceClient.java)). |
| BR03 | Connection references in a definition are authorized via Workspace (`authorize-attachment`, `resolve`, `auth-failure`); credentials are resolved server-side per run and never returned. |
| BR04 | Edits go to a `DRAFT`; no route runs a draft. Access requires workspace permission (`WORKFLOW_CREATE`, `WORKFLOW_EDIT`). |
| BR05 | Publish requires `WORKFLOW_PUBLISH` and runs [DefinitionValidator](../../../services/workflow-service/src/main/java/com/weav/workflow/domain/definition/DefinitionValidator.java) (structure, node config, mappings, connections). Success creates an immutable `workflow_versions` row with a new webhook key/secret. Republishing a draft identical to the active published version (definition and schema version) is a no-op: it returns the existing version with empty `webhooks`, and creates no version, secret, or `workflow.published` event. A changed draft publishes as before. |
| BR06 | Runs reference a published `workflow_version_id`. Manual needs `WORKFLOW_RUN` and `PUBLISHED` status; paused workflows disable trigger registrations; resume continues at the next future schedule slot without replaying paused slots. |
| BR07 | Nodes run in dependency order with bounded concurrency; node state, attempts, and sanitized logs are persisted; failures are recorded per node and execution. Delivery is at-least-once for read-only nodes and at-most-once-or-`OUTCOME_UNKNOWN` for side-effecting nodes (see Non-functional requirements: Execution semantics). |
| BR08 | Generation returns a proposal (`ready` / needs connections / invalid) and persists nothing; publishing and running remain separate authorized calls. AI/OCR nodes run only inside published workflows. |
| BR09 | Webhook/Telegram triggers are admitted only for an active, non-paused, current registration; all mismatches return the same generic 404. A Telegram trigger also needs the matching connection to stay valid. |

Component rules: max 200 nodes, 1,000 edges, 1 MiB definition, JSON depth 32 (`DefinitionValidator`); condition operators `eq ne gt gte lt lte`; Sheets ops `read append update`; HTTP methods GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS; workflow states `DRAFT`, `PUBLISHED`, `PAUSED`; execution states `QUEUED`, `RUNNING`, `WAITING`, `SUCCESS`, `FAILED`, `CANCELLED`.

## Domain model and data

Database `workflow_db` on Neon, schema `workflow` (`DB_SCHEMA`, default `workflow`), Flyway `V1`-`V5` in [db/migration](../../../services/workflow-service/src/main/resources/db/migration). Hibernate `ddl-auto=validate`. Hikari max pool 3.

| Table | Purpose |
| --- | --- |
| `workflows` | Draft aggregate: workspace id, name, description, status, draft definition, creator, `deleted_at`. |
| `workflow_versions` | Immutable published definitions. |
| `workflow_triggers` | Registrations per version: type (manual/webhook/schedule/telegram), status, endpoint key, secret SHA-256 verifier, cron/timezone, next/last run, `last_error`. Unique `(trigger_id, scheduled_at)` guards duplicate schedule admission; V4 makes webhook endpoints unique. |
| `workflow_executions` | Run: status, trigger type, `workflow_version_id`, initiator, lease owner/until, timestamps, input; V6 adds nullable `idempotency_key` and `request_hash` (SHA-256 hex of the key-sorted JSON input) with partial unique index `(workflow_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. |
| `node_executions`, `node_execution_attempts`, `execution_logs` | Per-node state, attempts (with error codes), sanitized logs. |
| `outbox_events` | Execution-job outbox (UUID-only intents) for RabbitMQ. |
| `notification_outbox` (V5) | Separate outbox for `workflow.*` events to Notification. |
| `workflow_connection_references` (V2) | Which workflows/versions reference which Workspace connection (answers the usage check). |
| `files`, `agent_runs`, `agent_steps` | Created by V1; no active use found in controllers. Agent Runtime deferred. |

Foreign ids (workspace, user, connection) are external references only; no cross-service queries.

## API

OpenAPI: [packages/contracts/http/workflow/openapi.yaml](../../../packages/contracts/http/workflow/openapi.yaml) and [README](../../../packages/contracts/http/workflow/README.md). The service receives paths without `/api/v1`. Definition JSON schema: [definition.schema.json](../../../packages/contracts/http/workflow/definition.schema.json). Controllers: [presentation/http](../../../services/workflow-service/src/main/java/com/weav/workflow/presentation/http).

Public (via Gateway, user JWT bearer; permissions are checked against Workspace):

| Method | Path | Purpose | Main errors |
| --- | --- | --- | --- |
| POST | `/workspaces/{ws}/workflows` | Create draft (201) | 400, 401, 403, 413 |
| GET | `/workspaces/{ws}/workflows?page&size` | List (size 1-100, default 20) | 400, 401, 403 |
| GET | `/workspaces/{ws}/workflows/{id}` | Detail | 403, 404 |
| PUT | `.../{id}/draft` | Save draft | 400, 403, 404, 409, 413 |
| POST | `.../{id}/publish` | Publish; webhook secret returned once, `Cache-Control: no-store`; unchanged draft returns the existing version without secrets | 400, 403, 409 |
| POST | `.../{id}/pause`, `.../resume` | State change | 403, 404, 409 |
| POST | `/workspaces/{ws}/workflows/generate` | Generate proposal from prompt (`prompt`, optional `timezone`, `connections`) | 400, 403, 413, 429, 502/503/504 |
| POST | `.../{id}/executions` | Manual run, body `{"input":{}}`, 202 `QUEUED`; optional `Idempotency-Key` header | 400, 403, 409, 413, 422 (`IDEMPOTENCY_KEY_REUSED`) |
| GET | `.../{id}/executions`, `.../executions/{eid}` | Monitor; logs `logPage`/`logSize` (max 100) | 403, 404 |

Unauthenticated ingress: `POST /webhooks/{endpointKey}` (header `X-Webhook-Secret`, optional JSON object body). Unknown, wrong-secret, inactive, paused, or superseded all return the same 404. Optional `Idempotency-Key` header (`[A-Za-z0-9._:-]{8,128}`, else 400): same key and same body replays the original 202 without a second run; same key with a different body returns 422 `IDEMPOTENCY_KEY_REUSED`; the key is scoped per workflow and serialised by the workflow row lock. Rate limiting (429) is spent only after the secret verified: a per-endpoint limiter (`WORKFLOW_WEBHOOK_ENDPOINT_RATE_LIMIT_REQUESTS_PER_WINDOW`, size-capped memory) and then the shared process-wide ceiling, so unknown keys and bad secrets cannot starve other tenants.

Internal: `GET /internal/workspaces/{ws}/connections/{cid}/usage` returns `{"inUse":bool}`; caller Workspace, header `X-Internal-Service-Key` (401 on bad key, 429 limiter). Outbound calls: Workspace `/internal/workspaces/{ws}/connections/{cid}/authorize-attachment|resolve|auth-failure` plus permission checks; AI Service generate/node operations ([ai openapi](../../../packages/contracts/http/ai/openapi.yaml)); OCR Service ([ocr contract](../../../packages/contracts/http/ocr)).

Node catalog ([NodeCatalog](../../../services/workflow-service/src/main/java/com/weav/workflow/domain/definition/NodeCatalog.java)):

| Node | Status | Notes |
| --- | --- | --- |
| `trigger.manual`, `trigger.webhook`, `trigger.schedule` | Implemented | Schedule: six-field Spring cron plus required IANA timezone; DST gap skipped, fall-back runs once; missed ticks coalesce. |
| `trigger.telegram` | Planned | Publish yields `DEPENDENCY_NOT_CONFIGURED`. |
| `logic.condition` | Implemented | Ports `true`/`false`. |
| `http.request` | Implemented | [HttpRequestNodeExecutor](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/http/HttpRequestNodeExecutor.java); URL policy, pinned transport, bounded bytes. |
| `google.sheets` | Implemented | read/append/update; needs Workspace connection. |
| `email.send` | Implemented | [GmailNodeExecutor](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/gmail/GmailNodeExecutor.java) and `GmailClient` are unconditional Spring components with a unit test; needs a Workspace Gmail connection. Max 10 recipients, 64 KiB body. Not yet run against real Gmail. |
| `ai.extract`, `ai.classify`, `ai.summarize` | Partial | `AiNodeExecutor` exists; gated by `WORKFLOW_AI_ENABLED` (default false). |
| `ocr.extract` | Partial | Adapter present, disabled unless six verification gates are true. |
| `telegram.send_message` | Planned | `UnavailableNodeExecutor` always fails with `DEPENDENCY_NOT_CONFIGURED`. |
| `agent.task` | Planned | Deferred (AI spec); `agent_runs`/`agent_steps` tables unused. |

## Events and messaging

| Direction | Exchange / queue | Key / type | Payload | Peer |
| --- | --- | --- | --- | --- |
| Publish | `weav.events` (topic, `NOTIFICATION_EXCHANGE`) | `workflow.created`, `workflow.published`, `workflow.paused`, `workflow.resumed`, `workflow.completed`, `workflow.failed` | Schema-v2 envelope ([event-v2.schema.json](../../../packages/contracts/events/notification/event-v2.schema.json), [README](../../../packages/contracts/events/notification/README.md)); workflow name only (+ workflow id on result events); target is the actor, initiator (manual), or workflow creator (automatic) | Notification (consumer) |
| Publish + consume (internal) | `workflow.executions` (direct) / queue `workflow.executions.v1`, retry `workflow.executions.v1.retry`, DLX `workflow.executions.dlx` / `workflow.executions.v1.dlq` | UUID-only execution intent | Execution id | Own worker ([ExecutionJobListener](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/messaging/ExecutionJobListener.java)) |

Delivery: transactional outbox, publisher confirms, at-least-once; Notification dedupes by event id. Completed/failed rows are written in the winning, unexpired lease commit. Publisher checks current `WORKFLOW_MONITOR` access before sending (denial marks `SKIPPED`; unavailable Workspace stays retryable). `packages/contracts/events/workflow` is empty (only `.gitkeep`). Consumed external events: None.

## Dependencies

| Direction | Peer | Use |
| --- | --- | --- |
| Calls | Workspace | Authorization, membership/permissions, connection authorize/resolve/auth-failure (internal key). |
| Calls | AI Service (private, Service JWT) | Generation and `ai.*` nodes. |
| Calls | OCR Service (private, Service JWT) | `ocr.extract`. |
| Calls | Google Sheets / Gmail / arbitrary HTTP targets | Node executors. |
| Called by | Workspace | Connection usage check. |
| Called by | API Gateway | Public routes and webhook ingress. |
| Called by | Bot Service | List/status/run (via user routes; no dedicated bot endpoint found). |
| Infra | Neon PostgreSQL, RabbitMQ | Data and outbox delivery. Valkey and Cloudflare R2: not used. |

## Security

- Public routes: user JWT validated locally (issuer `JWT_ISSUER`, audience `JWT_AUDIENCE`, skew `JWT_CLOCK_SKEW`; `user_status` must be exactly `ACTIVE`, `DISABLED` is rejected). The service does not read `JWT_REFRESH_SECRET` and compose no longer passes it; authorization via Workspace permissions (`WORKFLOW_CREATE/EDIT/PUBLISH/MANAGE_STATE/RUN/MONITOR`).
- Internal route: `X-Internal-Service-Key` filter ([InternalServiceKeyFilter](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/security/InternalServiceKeyFilter.java)); blank key keeps it closed. `WORKFLOW_INTERNAL_SERVICE_KEY` (inbound) and `WEAV_INTERNAL_SERVICE_KEY` (to Workspace) are separate; no overlapping rotation window.
- Outbound to AI/OCR: Service JWT signed with a private key file (`*_SIGNING_KEY_LOCATION`, key id); token lifetimes bounded (AI max 120 s).
- Webhook secret: random, shown once, only SHA-256 verifier stored; generic 404 avoids enumeration.
- Input limits: 1 MiB raw body filter on create/draft/execute/webhook; parsed input bound by bytes/depth; strict duplicate-key and unknown-property rejection on generate.
- Outbound HTTP: URL policy and socket validation (SSRF defence), pinned transport, bounded request/response/header sizes.
- Output sanitization: credentials, bearer values, signed-URL queries redacted from responses and logs. No secrets in logs.

## Configuration

Names and defaults from [application.properties](../../../services/workflow-service/src/main/resources/application.properties) and `.env.example`; secrets omitted.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_HOST/PORT/NAME/USERNAME/SSL_MODE/SCHEMA` (from `WORKFLOW_DB_*`) | port 5432, ssl `require`, schema `workflow` | Neon connection |
| `RABBITMQ_HOST/PORT/USERNAME` | `rabbitmq`, 5672, `guest` | Broker |
| `WORKSPACE_SERVICE_URL`, `WORKSPACE_CONNECT_TIMEOUT`, `WORKSPACE_READ_TIMEOUT` | `http://workspace-service:8080` (compose), 3s, 5s | Workspace client |
| `WORKFLOW_EXECUTION_WORKER_ENABLED` | `false` | Turns on worker listener and recovery scanner |
| `WORKFLOW_EXECUTION_WORKER_LEASE_DURATION` / `_HEARTBEAT_INTERVAL` / `_MAX_REDELIVERIES` | 60s / 15s / 3 | Lease and retry (heartbeat is decoupled from node runtime, see Lease loss) |
| `WORKFLOW_EXECUTION_MAX_CONCURRENT_NODES`, `_EXECUTOR_THREADS`, `_EXECUTOR_QUEUE_SIZE`, `_TIMER_THREADS` | 4, 8, 128, 2 | Runtime bounds |
| `WORKFLOW_EXECUTION_INPUT_MAX_BYTES` / `_MAX_DEPTH` | 1048576 / 32 | Input bounds |
| `WORKFLOW_EXECUTION_OUTBOX_*`, `WORKFLOW_EXECUTION_RECOVERY_*` | batch 50, poll 1000 ms, lease 30s, confirm 5s, retry cap 60s; recovery batch 50, poll 30s | Outbox and recovery |
| `WORKFLOW_NOTIFICATION_OUTBOX_*`, `NOTIFICATION_EXCHANGE` | enabled, batch 25, 1000 ms, lease 30s, `weav.events` | Notification publisher |
| `WORKFLOW_SCHEDULE_SCANNER_*`, `WORKFLOW_SCHEDULE_FAILURE_BACKOFF_MS` | enabled, batch 100, 1000 ms, backoff 30000 ms | Scheduler |
| `WORKFLOW_WEBHOOK_RATE_LIMIT_REQUESTS_PER_WINDOW` / `_WINDOW` | 6000 / 1m | Process-local ceiling, counted for authenticated requests only |
| `WORKFLOW_WEBHOOK_ENDPOINT_RATE_LIMIT_REQUESTS_PER_WINDOW` | 120 (same window) | Per-endpoint limiter after secret verification |
| `WORKFLOW_HTTP_CONNECT_TIMEOUT`, `_CALL_TIMEOUT`, `_MAX_REQUEST_BYTES`, `_MAX_RESPONSE_BYTES`, `_MAX_HEADER_BYTES` | 5s, 30s, 1 MiB, 1 MiB, 64 KiB | HTTP node |
| `WORKFLOW_AI_ENABLED`, `WORKFLOW_AI_GENERATION_ENABLED` | `false`, `false` | AI gates |
| `AI_SERVICE_PRIVATE_URL`, `WORKFLOW_AI_SIGNING_KEY_ID/LOCATION`, `_CONNECT_TIMEOUT`, `_READ_TIMEOUT`, `_TOKEN_LIFETIME`, `_MAX_RESPONSE_BYTES` | `http://ai-service:3000`, 5s, 65s, 90s, 512 KiB | AI client |
| `WORKFLOW_OCR_ENABLED` + five `*_VERIFIED`/`*_SOURCE_ENABLED` gates | all `false` | OCR gates |
| `OCR_SERVICE_PRIVATE_URL`, `WORKFLOW_OCR_CONNECT_TIMEOUT`/`_READ_TIMEOUT`/`_TOKEN_LIFETIME`/`_MAX_RESPONSE_BYTES` | `http://ocr-service:8000`, 5s, 30s, 60s, 1 MiB | OCR client |
| `WORKFLOW_INTERNAL_SERVICE_KEY`, `WEAV_INTERNAL_SERVICE_KEY`, `JWT_ISSUER`, `JWT_AUDIENCE`, `JWT_CLOCK_SKEW` | keys empty; `weav-identity`, `weav-api`, 30s | Auth |

## Non-functional requirements

- Admission durability: execution row, node rows, and outbox intent commit before the 202; schedule admission, outbox, and schedule advance commit atomically.
- Transaction boundaries: Workspace calls (access check, `authorizeAttachment`) run before, and outside, any database transaction (Hikari pool is 3); a short `TransactionOperations` block then locks, re-validates (`DraftChangedException` if the draft changed meanwhile), and writes. Applies to workflow create, draft save, publish, pause/resume; manual admission authorizes before its own short admission transaction.
- Idempotency: manual and webhook admission accept `Idempotency-Key` (see API); unique `(trigger_id, scheduled_at)`; outbox retry with confirms.
- Execution semantics (at-least-once vs outcome-unknown): a node is side-effecting when `NodeSideEffects` says so from its type and stored config: `http.request` with a method other than GET/HEAD/OPTIONS (or a mapped/missing method), `email.send`, `telegram.send_message`, `google.sheets` with `append`/`update`, and any unknown type. Read-only nodes (`http.request` GET/HEAD/OPTIONS, `google.sheets` `read`, `logic.condition`, `ai.*`, `ocr.extract`, triggers) keep at-least-once recovery: a node left `RUNNING` after a crash or lease loss goes back to `WAITING` and is re-run, within the 3-attempt budget. A side-effecting node left `RUNNING` is **not** re-run: it becomes `FAILED` with error code `OUTCOME_UNKNOWN` (non-retryable; the external call may or may not have happened) and the run fails with that error. The classification is derived at recovery time from the node type and the raw config persisted as the node input when the attempt started, so no extra column or migration is needed.
- HTTP idempotency key: `http.request` with a non-safe method sends `Idempotency-Key: <executionId>:<nodeId>`, identical on every attempt. A key the user sets in the node `headers` (any casing) is kept and never overridden. Whether the provider honours the key is the provider's contract.
- Retry classification: `RetryPolicy` retries only transient codes (`NETWORK_ERROR`, `TIMEOUT`, `WORKER_INTERRUPTED`, `AI_BUSY`, `AI_PROVIDER_UNAVAILABLE`, `AI_TIMEOUT`, `HTTP_TIMEOUT`, `HTTP_RATE_LIMITED`, `HTTP_DEPENDENCY_UNAVAILABLE`, `CONNECTION_UNAVAILABLE`, `OCR_UNAVAILABLE`); permanent codes never retry. The executor must also mark the failure retryable, and a repeat must be safe: the node is read-only, or it is `http.request` (carries the stable key), or the failure is flagged `requestNotSent` (connect/DNS failure, connect timeout, connection lookup failure, or a 429 refusal). Gmail send and Sheets `append`/`update` therefore retry only those provably-not-sent failures. Maximum 3 attempts; delay after attempt 1 and 2 is 1 s and 2 s with +/-50% random jitter.
- Lease loss: when the heartbeat cannot renew the lease (or a fenced commit is rejected) the runner stops within about one second, cancels (`future.cancel(true)`) every in-flight node call, and commits nothing further. The HTTP transport refuses to start a call on an interrupted thread; a socket call already on the wire cannot be aborted by interruption and ends at its own timeout (HTTP 30 s, AI 65 s), and its result is discarded because the fenced commit fails. The heartbeat runs on its own timer thread, independent of node duration, so the 60 s lease only needs to outlive missed heartbeats (15 s interval), not the longest node timeout; raising it would only delay crash recovery.
- Timeouts: HTTP node 5s connect / 30s call; AI 5s connect / 65s read (max 70s); OCR 30s read; Workspace 3s / 5s.
- Limits: 1 MiB bodies, 200 nodes, 1,000 edges, list page size max 100, log page size max 100.
- Recovery: lease heartbeat, expired-lease and stale-delivery recovery scanner (worker enabled only).
- Health: Actuator `health` and `info` only; readiness = readinessState + PostgreSQL + RabbitMQ; liveness local only. No Micrometer metrics yet.
- Logging: Spring logging with request/correlation id filter ([CorrelationIdFilter](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/web/CorrelationIdFilter.java)); provider bodies never logged.

## Status and known gaps

- Planned: workflow delete (UC017), Telegram trigger and `telegram.send_message`, admin cross-workspace execution monitoring (UC028), Agent Runtime / `agent.task`, execution cancellation endpoint (status `CANCELLED` exists, no route found).
- Partial: AI generation and AI nodes are off by default; OCR gated; `email.send` not yet run against real Gmail; Gateway generate route pending partner handoff.
- Worker is disabled by default in the dev overlay; enable on an intended worker deployment only.
- No Workflow-specific metrics or alert thresholds; webhook limiter is per instance.
- Empty scaffolds: `packages/workflow-schema/*` and `packages/contracts/events/workflow` contain only `.gitkeep`; the definition schema lives in `contracts/http/workflow/definition.schema.json`.
- Environment-only test errors listed under Testing.

## Testing

- Run from `services/workflow-service`: `JAVA_TOOL_OPTIONS=-Duser.timezone=UTC ./mvnw verify` (Testcontainers Postgres; Windows JVM timezone must be UTC).
- Last full result (2026-09-30, `dev`): 439 tests, 0 failures, plus 3 environment-only errors.
- Known environment-only errors: `HttpTransportIntegrationTest` x2 (TLS certificate missing); `WorkflowNotificationLifecyclePersistenceIntegrationTest.compiledNotificationConsumerPersistsAllSixV2EventsInJwtScopedInbox` (needs built `services/notification-service/dist`). Anything else is a regression.
- Suites of note: `SecurityConfigTest`, `WorkflowPersistenceTest`, `WorkflowJsonbRoundTripTest`, generation service/HTTP tests, and `src/test/java/com/weav/workflow/acceptance`. Live smoke: `scripts/start-workflow-v1-live-smoke.ps1` (creates and cleans throwaway `weav_workflow_smoke_*` schemas).

## Open questions

1. `email.send`: the service README (gaps table) still says it fails closed with `DEPENDENCY_NOT_CONFIGURED`, but `GmailNodeExecutor`/`GmailClient` are unconditional Spring components and `UnavailableNodeExecutor` lists only `telegram.send_message`. Code wins: marked Implemented. Suggest: update the README row and run one live Gmail send.
2. UC017 Delete workflow: schema supports soft delete, thesis requires it, no endpoint exists. Suggest: add `DELETE .../workflows/{id}` (soft delete, permission `WORKFLOW_DELETE`-style) for V1, or drop UC017 from V1 scope.
3. UC028 Monitor all executions (System Admin): no admin route in Workflow. Suggest: decide whether admin monitoring goes through a Workflow internal route called by a Gateway admin path, or is out of V1.
4. Bot to Workflow: brief says Bot lists/status/runs workflows; Workflow has no bot-specific or service-JWT route, only user-JWT routes. Suggest: document how Bot obtains a user-scoped token, or add a service route.
5. Telegram trigger: thesis and catalog include it; ingress is unconfigured. Suggest: keep Planned for V1 unless Bot ingress contract is agreed with Bot Service.
6. Execution cancellation: `CANCELLED` status exists without an API. Suggest: add a cancel route or remove the status from the public contract.
7. Thesis lists triggers Manual/Webhook/Telegram in section 1.2.2 but section 3.2.3 adds Schedule; code has `trigger.schedule`. Suggest: treat Schedule as in scope.
8. Notion assumes one physical DB with `*_schema` names and Redis; code uses `workflow_db`/schema `workflow` and Valkey (unused here). Follow code.
9. Gateway generate route (`POST /api/v1/workspaces/:id/workflows/generate`) is pending partner handoff; confirm owner and date.

## References

- Service: [services/workflow-service](../../../services/workflow-service), [README](../../../services/workflow-service/README.md), [application.properties](../../../services/workflow-service/src/main/resources/application.properties)
- Contracts: [workflow OpenAPI](../../../packages/contracts/http/workflow/openapi.yaml), [definition schema](../../../packages/contracts/http/workflow/definition.schema.json), [AI OpenAPI](../../../packages/contracts/http/ai/openapi.yaml), [notification event v2](../../../packages/contracts/events/notification/event-v2.schema.json)
- Specs: [workflow-service-spec](../../superpowers/specs/workflow-service-spec.md), [AI service v1 design](../../superpowers/specs/2026-09-25-ai-service-v1-design.md)
- Config: [.env.example](../../../.env.example), [compose.dev.yml](../../../compose.dev.yml)
- Project docs: [rulebook](../../rulebook.md), [specs index](../README.md)
