# Workflow Service V1 Specification

**Status:** implementation specification for review
**Repository baseline:** `hoangkhai1905/Weav`, branch `dev`, commit `7e14de05ec9886db8d9beacf3dc6c69f12a6fd02`
**Scope:** Workflow Service foundation to first behavior-complete V1; no implementation is included in this file.

## 1. Purpose and source of truth

Implement a workspace-owned workflow authoring and execution service. The service owns workflow definitions, immutable published versions, triggers, executions, node states, and execution history. It evaluates a directed acyclic graph (DAG), runs eligible nodes, and integrates with Workspace for user authorization and connection credentials.

This spec uses the committed `dev` source as the code baseline. `workflow-service` is currently a foundation: it has domain and persistence scaffolding, Flyway schema, security and error foundations, and placeholder presentation types, but it has no implemented Create/Edit/Publish/Run/Execution API behavior. Treat the existing code and migrations as naming and architecture baseline, not as proof that these behaviors exist. `GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage` is an existing shared contract that Workspace already depends on; Workflow must implement it.

Older project material contains stale or unrelated examples. The checked-in source at the commit above and the decisions recorded in the referenced conversation take precedence.

## 2. Scope

### In scope

- Create and edit workflow drafts; validate and publish immutable versions; pause and resume a workflow.
- Manual, schedule, webhook, and Telegram trigger types.
- HTTP Request, Email, Google Sheets, Telegram, Logic/Condition, AI, and OCR node types.
- Safe data mapping, DAG validation, node execution, retry, branch, merge, and execution monitoring.
- RabbitMQ execution jobs with PostgreSQL as the source of truth.
- Workspace authorization, connection attachment checks, runtime credential resolution, and the required connection-usage contract.
- The formal OCR Service call contract described in section 10.
- A pragmatic Clean Architecture structure consistent with Identity and Workspace.

### Out of scope

- Agent node / Agent Runtime (`agent.task`). Existing agent tables and domain placeholders may remain unused; do not remove them in this milestone.
- Google Docs (`google.docs`), although it currently appears in the Web UI catalog.
- Direct Telegram webhook handling by Workflow Service.
- Inventing AI Service or Bot Service routes, payloads, credentials, or authentication contracts.
- Gmail send permission changes, workflow-execution cancellation/resume APIs, human approval nodes, loops, arbitrary code execution, or a distributed node-level queue.

## 3. Architecture baseline and required structure

Identity and Workspace both use the four main areas `domain`, `application`, `infrastructure`, and `presentation`, with slightly different placement of ports and HTTP types. Identity has an architecture test that keeps Spring/JPA/Hibernate out of the domain. Workspace has a domain purity test and its own presentation and infrastructure split. Workflow already has these four areas, but its architecture test and use case files are still scaffolding. Preserve the useful boundary without copying either service package-for-package.

Recommended responsibilities for `com.weav.workflow`:

| Area | Responsibility |
|---|---|
| `domain` | Workflow/version/trigger/execution/node rules, statuses, value objects, policies, and domain errors. No Spring, JPA, HTTP, or broker types. |
| `application` | Use cases and orchestration. Define ports at real persistence, broker, and service boundaries; do not add an interface for every class. |
| `infrastructure` | JPA/Flyway adapters, RabbitMQ/outbox, scheduler, Workspace/OCR clients, and external node adapters. |
| `presentation` | Public and internal HTTP controllers, request/response models, and mapping to application commands/results. |

Keep domain decisions independent from framework and storage details. Application code coordinates ports; infrastructure implements them. Add architecture rules like the existing Identity/Workspace domain rules. Do not place business behavior in controllers, JPA entities, or Rabbit listeners.

Repository references: [repository structure guidance](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/docs/architecture/repository-structure.md), [Identity architecture test](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/identity-service/src/test/java/com/weav/identity/architecture/IdentityCleanArchitectureTest.java), [Workspace domain architecture test](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/workspace-service/src/test/java/com/weav/workspace/architecture/WorkspaceDomainArchitectureTest.java), and [Workflow architecture test scaffold](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/workflow-service/src/test/java/com/weav/workflow/architecture/WorkflowCleanArchitectureTest.java).

The repository comparison is:

| Service | Existing organization and observed convention |
|---|---|
| Identity | `domain`; `application` (DTOs, outbound ports, security, use cases, validation); `infrastructure` (persistence, security, storage, web/config); `presentation/http`. Its architecture test enforces domain isolation. |
| Workspace | `domain` (models, policies, value objects, queries, and some ports); `application` (DTOs, services/use cases, ports, validation); `infrastructure` (persistence, cache, credentials, providers, security, Workflow client); `presentation/http`. It also enforces domain purity. |
| Workflow | The same four top-level areas and persistence/domain aggregates already exist. Several use cases and presentation types are placeholders; there are no implemented business controllers, and its Clean Architecture test is empty. Treat it as a scaffold to complete, not an API to extend. |

This is a pragmatic comparison: keep the shared dependency direction and pure domain, but follow the placement conventions that best fit each real boundary rather than forcing identical package trees.

## 4. Domain, persistence, and versioning

Use the existing Workflow schema and aggregate vocabulary as the starting point. The committed V1 migration already contains workflows, versions, triggers, executions, node executions and attempts, execution logs, files, outbox events, and agent tables. Preserve it and make schema changes with additive Flyway migrations; do not rewrite or delete existing migrations.

- PostgreSQL schema: `workflow`. UUID identifiers. Persist instants as UTC `TIMESTAMPTZ`.
- A workflow belongs to a `workspaceId`; do not create cross-service foreign keys or query Workspace's database.
- `draft_definition` is the editable definition. `editor_state` contains UI-only layout/state and is not part of the execution contract.
- A published `workflow_version` is an immutable snapshot of the definition. Each execution refers to exactly one version and continues using that snapshot even if the workflow is edited or republished later.
- Publish validates the draft, creates the next immutable version, updates `current_version_id`, and updates that version's trigger registrations atomically. Existing queued/running executions remain pinned to their original version.
- Editing a published workflow changes the draft only. The current published version and its active triggers continue to run until a later publish. A paused workflow remains paused when a new version is published; resume is explicit.
- Store connection IDs and provider configuration references only. Workflow Service must not own, encrypt, persist, log, or return provider secrets.

Use the existing status vocabulary where applicable:

- Workflow: `DRAFT`, `PUBLISHED`, `PAUSED`.
- Execution: `QUEUED`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`.
- Node execution: `PENDING`, `READY`, `RUNNING`, `WAITING`, `SUCCESS`, `FAILED`, `SKIPPED`, `CANCELLED`.
- Trigger types: `MANUAL`, `SCHEDULE`, `WEBHOOK`, `TELEGRAM`; trigger registration state: `ACTIVE` or `DISABLED`.

`WAITING` remains available for future asynchronous integrations but is not required by the synchronous V1 node set. Do not implement an execution cancellation endpoint in this scope. `CANCELLED` is used for nodes that will not run after an execution fails or is cancelled by an internal control path.

## 5. Canonical definition and node catalog

The server must validate a versioned JSON definition. Keep editor coordinates in `editor_state`, not in the executable definition.

```json
{
  "schemaVersion": "1.0",
  "nodes": [
    { "id": "manual", "type": "trigger.manual", "config": {} },
    { "id": "request", "type": "http.request", "config": { "method": "GET", "url": "https://example.com" } }
  ],
  "edges": [
    { "id": "manual-to-request", "source": "manual", "target": "request" }
  ],
  "variables": {}
}
```

Node and edge IDs are unique within a definition. Trigger nodes are entry points and cannot have incoming edges. A V1 definition has exactly one `trigger.manual` node; create seeds it by default so every published workflow remains manually runnable. Automatic trigger nodes may be added. For each execution, only the firing trigger root is active. Every executable node must be reachable from at least one trigger. Reject unknown node types, duplicate IDs, dangling edges, invalid branch ports, cycles, invalid configuration, and references to non-upstream nodes. A definition is a DAG. Static `variables` are JSON values in the definition; they are not a secret store.

The V1 server catalog is:

| Type | Configuration and output contract |
|---|---|
| `trigger.manual` | Accepts manual run input. The execution input is available as `trigger.input`; current UI `buttonLabel` is presentation configuration only. |
| `trigger.schedule` | `{ "cron": "0 0 9 * * *", "timezone": "Asia/Ho_Chi_Minh" }`. Output includes the scheduled instant. Six-field Spring cron; timezone is required and validated at publish. The UI default timezone is `Asia/Ho_Chi_Minh`; do not use the JVM default timezone. |
| `trigger.webhook` | Service-generated endpoint key and secret verifier; the accepted JSON request body becomes `trigger.input`. Do not accept a caller-chosen public path as the endpoint identity. |
| `trigger.telegram` | Persist and validate its node/trigger identity. Event normalization is owned by Bot Service. Its normalized payload schema is not defined until the Bot contract is approved. |
| `http.request` | Method, URL, optional headers/query/body, and optional Workspace connection reference. Output contains response data and HTTP status. Apply the outbound request controls in section 11. |
| `email.send` | Typed recipient, subject, and body configuration; output is message identifier/status only when a real sender is available. Execution is blocked by the missing Gmail send capability described in section 10. |
| `google.sheets` | Workspace connection reference, operation, spreadsheet ID, and range/data configuration. V1 operations are read, append, and update. Output is a JSON result. Dynamic values use the mapping syntax in section 6. |
| `telegram.send_message` | Config has `chatId` and `text`; output is a sent message ID only after a real send. The actual sender boundary is pending Bot/provider contract; do not return a fake success. |
| `logic.condition` | A declarative predicate with `left`, `operator`, and `right`; outgoing edge ports are `true` and `false`. No code strings. |
| `ai.extract` | Input `text`; output `extractedJson`. Configuration may include `schemaDescription`. AI provider/request/response contract remains unimplemented until agreed. |
| `ai.classify` | Input `content`; output `category` and `confidence`. Configuration may include `categories`. AI provider/request/response contract remains unimplemented until agreed. |
| `ai.summarize` | Input `inputText`; output `summary`. Configuration may include `maxLength`. AI provider/request/response contract remains unimplemented until agreed. |
| `ocr.extract` | Accept exactly one OCR source (`artifactId` or `fileUrl`), plus `language` and `detectTables`; output maps the OCR result including raw text, pages/blocks/tables, and confidence where present. See section 10. |

The current UI catalog is useful as a type/default inventory, not as a backend contract. In particular, its five-field schedule sample must be changed to six-field Spring cron; `$json` mapping examples must be replaced by the V1 mapping grammar; `google.docs` and `agent.task` must not be accepted by the V1 backend. The catalog currently has no `logic.condition` item, so add it with the declarative predicate and branch ports defined above. Reference: [current UI node catalog](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/apps/web/src/lib/constants/nodeCatalog.ts).

### Logic predicate operators

Support `eq`, `ne`, `gt`, `gte`, `lt`, and `lte`. `eq`/`ne` compare JSON values; ordering operators require numeric operands. Missing values are validation/runtime errors, not `null`. A condition emits exactly one selected port. Do not support JavaScript, scripting, or user-defined functions.

## 6. Data mapping

Use the mapping grammar agreed in the conversation:

```text
{{ trigger.input.email }}
{{ nodes.http1.output.body }}
{{ variables.region }}
```

Rules:

1. Only `{{ expression }}` with dot-notation object paths is supported in V1. No JSONPath, property access by computed expressions, function calls, operators, or arbitrary JavaScript.
2. A string containing only one expression resolves to the value's original JSON type, including object, array, number, boolean, or string.
3. A string with embedded expressions resolves to text; only scalar values may be embedded in a string. Object/array interpolation in a larger string is a mapping error.
4. Resolve expressions recursively in arrays and objects.
5. A reference to an unknown node, a non-upstream node, an absent property, or an unavailable output fails with a clear non-retryable mapping error. Never silently replace it with an empty value.
6. `trigger.input` is the normalized input for the event that created the execution. `nodes.<nodeId>.output` is the persisted output of a successful upstream node. `variables` comes from the immutable definition snapshot.

## 7. Lifecycle and public APIs

The API Gateway exposes `/api/v1`; Workflow controllers receive the path after Gateway prefix handling. Public resource routes are workspace-scoped and use the existing access-token authentication path. Derive `userId` from the authenticated principal; never trust a caller-supplied identity field. Send/propagate `X-Correlation-Id` according to existing service conventions.

| Method and path (Gateway path) | Behavior |
|---|---|
| `POST /api/v1/workspaces/{workspaceId}/workflows` | Create a draft seeded with one manual trigger. Return `201` with workflow ID/status. |
| `GET /api/v1/workspaces/{workspaceId}/workflows` | List workflows the caller may view. |
| `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}` | Return workflow metadata, draft/editor state allowed to the caller, and current version reference. |
| `PUT /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/draft` | Validate basic shape and save the draft definition/editor state. Full publish validation still runs at publish. |
| `POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/publish` | Validate and publish an immutable version. Return its ID/number and published status. |
| `POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/pause` | Disable automatic triggers and reject manual runs. |
| `POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/resume` | Reactivate triggers for the current published version. |
| `POST /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/executions` | Start a manual execution of a `PUBLISHED` workflow. Body: `{ "input": { ... } }`. Persist and enqueue before returning `202` with execution ID/status. Reject `DRAFT` and `PAUSED`. |
| `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/executions` | List execution summaries. |
| `GET /api/v1/workspaces/{workspaceId}/workflows/{workflowId}/executions/{executionId}` | Return execution state, pinned version, node states, attempts, and sanitized logs. |

Request/response minimums:

- Create: `{ "name": "...", "description": "..." }`; create an empty editable draft. Return `{ "workflowId": "...", "status": "DRAFT" }` with `201`.
- Save draft: `{ "name": "...", "description": "...", "definition": { ... }, "editorState": { ... } }`. Draft save accepts structurally valid JSON and unique IDs; publish performs full semantic validation.
- Publish: return `{ "workflowId": "...", "versionId": "...", "version": 1, "status": "PUBLISHED" }`. If this publish creates a webhook trigger, include its `{ "triggerId": "...", "endpointKey": "...", "secret": "..." }` once in the response; it is not returned by later reads.
- Manual execution: `{ "input": { ... } }`; return `{ "executionId": "...", "workflowId": "...", "workflowVersionId": "...", "status": "QUEUED" }` with `202` after the execution and outbox event are committed.
- Execution detail includes per-node status, attempt number/timing, sanitized output and error fields. Do not include secrets or unsanitized external response headers.

Execution rules are exact: `DRAFT` cannot run; `PUBLISHED` accepts manual and automatic triggers; `PAUSED` accepts neither. Pause suppresses new automatic triggers and manual runs; it does not rewrite or cancel already queued/running executions. Resume reactivates automatic triggers for the current published version.

Return the repository's standard structured error body (`error.code`, `error.message`, `error.details`, `timestamp`, `status`, `path`) for API errors. Validation errors must identify the node/field and reason without exposing secrets or downstream response bodies.

## 8. Authorization and Workspace integration

Workflow consumes Workspace's internal APIs and uses `X-Internal-Service-Key` on every Workflow-to-Workspace request. It must not read Workspace's database.

| Workspace operation | Workflow use |
|---|---|
| `GET /internal/workspaces/{workspaceId}/users/{userId}/access` | Get authoritative workspace access/capabilities. Owner access grants all; member access follows Workspace's returned capabilities. |
| `POST /internal/workspaces/{workspaceId}/connections/{connectionId}/authorize-attachment` with `{ "userId": "..." }` | Validate connection use when a referenced connection is saved/published. Treat denial or service failure as fail-closed. |
| `POST /internal/workspaces/{workspaceId}/connections/{connectionId}/resolve` | Resolve provider/auth details immediately before a node calls the provider. Keep the returned secret in memory only; never cache, persist, or log it. |
| `POST /internal/workspaces/{workspaceId}/connections/{connectionId}/auth-failure` with `{ "failureCode": "AUTHENTICATION_REJECTED" }` | Call only after the provider confirms credential rejection. Do not call for network, timeout, rate limit, or unrelated business failures. |

Map capabilities to operations: `WORKSPACE_VIEW` for reads, `WORKFLOW_CREATE` for create, `WORKFLOW_EDIT` for draft edits, `WORKFLOW_PUBLISH` for publish, `WORKFLOW_RUN` for manual run, `WORKFLOW_MONITOR` for execution history/detail, and `WORKFLOW_MANAGE_STATE` for pause/resume. Workflow must enforce Workspace's returned capabilities rather than duplicate role policy locally.

### Required connection-usage API

Implement the existing contract:

```http
GET /internal/workspaces/{workspaceId}/connections/{connectionId}/usage
X-Internal-Service-Key: ...
```

Response is exactly `{ "inUse": boolean }`. Preserve the contract's `401`, `404`, `429`, and `500` error behavior. Return `inUse: true` if any non-deleted workflow draft or stored immutable version in that workspace references the connection; drafts count so an attached connection cannot be removed while a workflow still refers to it. Do not call Workspace to answer this query. The contract is defined in [workflow OpenAPI](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/packages/contracts/http/workflow/openapi.yaml) and is already consumed by Workspace.

## 9. Triggers

### Manual

The manual execution API creates an execution with `triggerType=MANUAL`, the current published version, and the supplied JSON input. The input is visible as `trigger.input`. A published version may contain its single manual trigger and automatic trigger nodes; a manual run activates the manual entry, while an automatic event activates only the entry node identified by that trigger record. Other trigger roots are inactive for that execution. At a join, only active incoming paths count.

### Schedule

- Use Spring's six-field cron expression and a required IANA timezone.
- The Web UI default is `Asia/Ho_Chi_Minh`; persist the timezone and never depend on the server/JVM default.
- Validate cron and timezone during publish. Invalid values produce a node-scoped validation error.
- The scheduler creates durable `SCHEDULE` executions with `trigger.input` containing the scheduled instant and uses the normal outbox/worker path. Pause disables the trigger; resume registers it against the current published version.

### Webhook

Expose `POST /api/v1/webhooks/{endpointKey}`. Do not put workspace or workflow IDs in this public URL. This ingress authenticates with the trigger secret rather than a user access token. Each published webhook trigger has a random unique endpoint key and a high-entropy secret; store only `secretHash`. Return the plaintext secret only once when the webhook trigger is first provisioned by publish; later reads never return it. Require `X-Webhook-Secret` and compare it in constant time. Never log either value. Return the same generic `404 WEBHOOK_NOT_FOUND` response for an unknown endpoint key and for an invalid/missing secret so callers cannot discover valid keys.

Validate that the trigger is active and published, persist the execution and enqueue record durably, then return `202 Accepted`. The JSON request body becomes `trigger.input`.

### Telegram

Telegram's event path is:

```text
Telegram -> Bot Service -> Workflow Service trigger ingress -> execution
```

Workflow Service must not receive Telegram's public webhook. Bot Service owns Telegram updates and normalization. Keep an application-level ingress port so a future Bot adapter can start an execution from a trigger ID and normalized input. The earlier path suggestion `POST /internal/workflows/triggers/telegram/{triggerId}` is only a placeholder, not an approved endpoint contract. Do not implement or publish its route, body, authentication, or response until Bot and Workflow agree those details. Until then, a Telegram trigger cannot start a real execution and must fail/configure visibly rather than pretend it ran.

## 10. Node integration contracts and readiness

### Google Sheets

Use `connectionId` and Workspace credential resolution. Workspace already allows a Google Sheets spreadsheet scope. V1 supports read, append, and update operations. Store only the connection reference and ordinary node configuration; provider tokens stay in Workspace. Reject a connection that is not authorized for the current workspace/user.

### Email

The current Workspace Gmail OAuth policy grants `gmail.metadata`, not Gmail send. The `email.send` node stays in the catalog with typed configuration, but it must not claim successful delivery or silently request broader OAuth scopes. A real executor requires an approved send-capable connection/provider contract. Until then, execution returns `DEPENDENCY_NOT_CONFIGURED` with `retryable=false`.

### Telegram action and AI nodes

Keep the Telegram action node and the AI node types/configuration boundary. Do not select AI providers/models, invent prompt transport, API paths, payloads, or service auth. Do not invent Bot send/trigger contracts. If no approved adapter is configured, fail clearly with `DEPENDENCY_NOT_CONFIGURED`, `retryable=false`; never return mock success. The node types remain validatable and can be saved in drafts.

### OCR Service

Use the formal OCR Service contract, not `X-Internal-Service-Key`:

- Call private `POST /v1/extractions` with `Authorization: Bearer <service-jwt>`.
- Sign a short-lived asymmetric service JWT with Workflow's service identity: `iss=weav-workflow`, `aud=weav-ocr`, `scope=ocr:extract`, `workspace_id`, and `mode=execution`; include `execution_id` and `node_execution_id` for execution mode. TTL must not exceed 120 seconds. Do not reuse an Identity user/access token or an HMAC user secret.
- Send required UUID `X-Request-ID`; propagate `traceparent` when available.
- Send exactly one source: `{ "source": { "type": "artifact", "artifactId": "..." } }` or `{ "source": { "type": "url", "fileUrl": "..." } }`. `language` defaults to `vi+en`; `detectTables` defaults to `true`.
- Map the OCR response (`schemaVersion`, `text.rawText`, confidence, blocks/tables/metadata) to the node output. Workflow owns execution state and retries.

There are two explicit integration prerequisites. First, the current OCR route implementation only checks for the presence of a Bearer token, while the formal contract requires validation of the service JWT signature and claims; OCR enforcement must match the formal contract before production integration. Second, although the OCR request contract accepts an `artifactId`, the repository does not yet formalize the Workflow-artifact descriptor/download contract that resolves that ID. Do not invent a descriptor endpoint or payload. The artifact source is not production-ready until both services agree on resolution; the URL source may be used only if it satisfies OCR's existing URL allowlist/security rules.

## 11. Execution engine, retries, and merge behavior

RabbitMQ carries whole execution jobs, not one job per node. An execution message contains the execution ID; the worker reloads the authoritative execution/version/state from PostgreSQL. Use the existing outbox table so execution creation and enqueue intent are committed together. Multiple workers may run, but one worker owns a given execution at a time. Persist node/attempt state so duplicate delivery or worker restart can resume from saved state without replaying completed nodes.

Within one worker, independent `READY` nodes may run concurrently. The engine decides readiness and joins in-process; do not split node orchestration across RabbitMQ in V1. PostgreSQL remains the source of truth; Redis is not the execution queue. Do not promise exactly-once external side effects: if a worker loses its connection after a provider completed an action but before recording success, a retry may repeat it. Use provider idempotency where supported and report this limit accurately.

### Readiness and branches

- A normal node is `READY` only after all incoming paths are known to be active/inactive and every active upstream node has succeeded.
- A condition activates exactly one outgoing port (`true` or `false`). Nodes reachable only through the unselected port become `SKIPPED`.
- A node receiving multiple active incoming paths is a join: wait for all active predecessors; do not wait for inactive/unselected paths.
- Example: if a condition chooses B and skips C, then downstream D waits for B only and runs after B succeeds.
- A node is not skipped if another active path reaches it. Use active-edge state, not merely a count of every declared incoming edge.

### Failure and retry

- Default `maxAttempts=3` total: initial attempt plus two retries. Persist each attempt.
- Retry only transient failures: timeout/network failure, HTTP 5xx, and rate limiting. Do not retry invalid configuration, mapping errors, confirmed authentication rejection, or ordinary 4xx business errors.
- Use simple exponential delays of 1 second then 2 seconds between the three attempts. There is no delay after the final attempt; no more complex retry system is required in V1.
- When a node exhausts attempts, mark it `FAILED` and the execution `FAILED`. Stop scheduling new nodes, let already-running independent work settle, and mark not-started dependent work `CANCELLED`. Do not mark a branch-excluded node `CANCELLED`; it is `SKIPPED`.
- An execution is `SUCCESS` only when all active paths finish successfully and all inactive paths are skipped. Record a stable error code/message and attempt timing; never store credentials or raw sensitive provider responses in logs.

## 12. Security, validation, and operational rules

- HTTP Request nodes are an SSRF boundary. Apply the same target protections used by Workspace: reject loopback, private, link-local, and metadata destinations; validate DNS results and pin the approved destination; disable redirects by default. Do not assume Workspace validates arbitrary URLs submitted to Workflow.
- Resolve Workspace connection credentials immediately before provider use. Do not place them in execution input, outputs, attempt records, logs, API responses, or workflow variables.
- Webhook secrets are stored only as hashes. Never log the secret or endpoint credentials.
- Redact authorization headers, tokens, signed URLs, and secret-bearing provider fields from logs and error details. Keep provider error responses sanitized.
- Treat validation as a publish gate: graph shape, node/config schemas, cron/timezone, edge ports, connection attachment, and mapping references must all pass. Return node/field-level diagnostics.
- Do not let callers choose `workspaceId`, `userId`, or connection ownership through untrusted node data. Authorization is enforced through the authenticated principal and Workspace.

## 13. Minimum acceptance criteria

1. Workflow endpoints and contracts are added; the current placeholder-only Workflow Service is not mistaken for implemented behavior.
2. The four-layer architecture is enforced, and domain rules do not depend on Spring/JPA/HTTP/Rabbit types.
3. Draft edits do not mutate published versions; executions stay pinned to their starting version.
4. Draft, publish, pause, resume, and manual-run state rules match section 7.
5. The server validates the complete V1 node catalog, rejects `agent.task` and `google.docs`, and never executes arbitrary JavaScript.
6. Mapping preserves the type for a whole-string expression, interpolates scalar values into text, recurses through arrays/objects, and reports missing/invalid paths.
7. A branch-excluded node is `SKIPPED`; downstream joins wait for all active incoming paths only; exhausted node retries fail the execution and cancel pending dependants.
8. Independent ready nodes may execute concurrently within one worker; RabbitMQ carries execution jobs; PostgreSQL/outbox remain authoritative.
9. Schedule uses six-field cron plus explicit timezone. Webhook key/secret checks happen before durable enqueue, and accepted requests return `202` only after persistence/outbox commit.
10. Workspace calls use `X-Internal-Service-Key`, enforce returned capabilities, and never expose/store resolved secrets. The required connection-usage response is `{ "inUse": boolean }` and counts draft/version references.
11. OCR uses the documented Workflow Service JWT claims and request shape; deployment is blocked until OCR validates those claims. Artifact source remains blocked until its resolution contract is agreed.
12. AI, Bot/Telegram, and Gmail send integrations fail clearly when unconfigured; none returns a fake success or uses an invented service contract.

## 14. Repository references

- [Workflow V1 migration](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/workflow-service/src/main/resources/db/migration/V1__create_workflow_entities.sql)
- [Workflow package and service source](https://github.com/hoangkhai1905/Weav/tree/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/workflow-service/src/main/java/com/weav/workflow)
- [Workflow connection-usage contract](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/packages/contracts/http/workflow/openapi.yaml)
- [Workspace internal API documentation](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/workspace-service/README.md)
- [OCR OpenAPI contract](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/packages/contracts/http/ocr/openapi.yaml)
- [OCR contract and service JWT requirements](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/packages/contracts/http/ocr/README.md)
- [OCR implementation route](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/ocr-service/src/api/routes.py)
- [Workflow artifact resolver port](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/services/ocr-service/src/infrastructure/files/workflow_artifact_resolver.py)
- [Workflow node catalog in the Web UI](https://github.com/hoangkhai1905/Weav/blob/7e14de05ec9886db8d9beacf3dc6c69f12a6fd02/apps/web/src/lib/constants/nodeCatalog.ts)
