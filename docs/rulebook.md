# WEAV Rulebook

> The binding product and architecture rules for Weav V1. Last verified: 2026-09-30 against `dev`.
> How agents and people work in the repo (branches, tests, logs, commits) lives in [CLAUDE.md](../CLAUDE.md) / [AGENTS.md](../AGENTS.md). Per-component detail lives in [docs/specs](specs/README.md).

When this rulebook and the code disagree, the code wins: fix this file or record the conflict in the component spec's "Open questions".

## 1. Product

Weav automates and monitors work processes, in the style of Zapier or n8n, for working professionals on web and mobile. Users build workflows from nodes (triggers, actions, AI, OCR) in a visual Builder or generate a draft from natural language, then publish, run, and monitor those workflows.

### Actors

| Actor | Can do |
| --- | --- |
| Unauthenticated user | Register, sign in, recover password |
| Authenticated user | Create and list workspaces, build and run workflows in workspaces they belong to, connect their own Telegram bot |
| Workspace Member | Everything an authenticated user can do inside the workspace; publish only if granted publish permission |
| Workspace Owner | All member rights, plus managing the workspace, members, publish permission, and connections; publishing, pausing, and resuming workflows |
| System Admin | List users, lock or unlock accounts, list all workspaces, monitor all executions |
| System / integrations | Schedule, webhook, and Telegram triggers; AI and OCR processing |

## 2. Business rules (BR01–BR09)

IDs follow the thesis (§3.2.1). Every spec states which rules its component enforces.

| ID | Rule | Enforced by |
| --- | --- | --- |
| BR01 | Users must register and sign in before using private features. Every operation on workspaces, workflows, connections, and execution data is checked against the user's identity and workspace scope. | Identity (tokens), Gateway (edge auth), each service (scope checks) |
| BR02 | Any user can create a workspace and becomes its Owner. The Owner manages workspace info, adds or removes members, and grants or revokes a member's publish permission. | Workspace |
| BR03 | Connections and credentials are scoped to a workspace. Only users with the right permission may configure or use them, and credentials are never used outside their workspace. | Workspace (owns and resolves), Workflow (uses only via Workspace) |
| BR04 | Workflows are built in the Builder (nodes, edges, node config, data mappings). Edits are saved as Draft and never run automatically. Only users with access to the workspace can view or edit its workflows. | Workflow |
| BR05 | Only the Owner or a Member with publish permission can publish. Publishing validates structure, node dependencies, node config, data mappings, and required connections. A successful publish creates a new immutable Workflow Version. | Workflow (+ Workspace for the permission check) |
| BR06 | A published workflow runs manually or from configured triggers (schedule, webhook, Telegram). A paused workflow accepts no new automatic triggers until it is resumed. Every run references a published version and records its status. | Workflow |
| BR07 | Nodes execute in dependency order. Inputs come from the trigger payload or from upstream outputs through data mappings. If an input cannot be resolved, a required connection is unusable, or a node errors, the failure is recorded. | Workflow |
| BR08 | AI generation only proposes a workflow for the user to review and edit. AI never publishes or runs workflows. AI nodes and OCR run only inside validly configured, published workflows. | Workflow, AI |
| BR09 | A Telegram trigger or send node needs a workspace `TELEGRAM` connection (the user's own bot token); one bot serves one active workflow at a time. Webhook and Telegram triggers are processed only when they match a configured trigger of an active workflow. | Workspace, Workflow |

## 3. Use cases and owners

The thesis says 32 use cases but lists 28; the 28 listed are authoritative. Status per use case is tracked in each owner's spec.

| UC | Name | Owner | Spec |
| --- | --- | --- | --- |
| UC001–UC004 | Sign in, forgot password, register, change password | Identity | [identity-service](specs/services/identity-service.md) |
| UC005–UC010 | Create, list, and manage workspaces, members, permissions, connections | Workspace | [workspace-service](specs/services/workspace-service.md) |
| UC011–UC013 | Create, edit, save draft | Workflow | [workflow-service](specs/services/workflow-service.md) |
| UC014 | Generate workflow from natural language | Workflow + AI | [workflow-service](specs/services/workflow-service.md), [ai-service](specs/services/ai-service.md) |
| UC015–UC019 | Publish, pause/resume, delete, run manually, monitor executions | Workflow | [workflow-service](specs/services/workflow-service.md) |
| UC020 | Receive result notifications | Notification | [notification-service](specs/services/notification-service.md) |
| UC021 | Trigger via webhook | Workflow (ingress via Gateway) | [workflow-service](specs/services/workflow-service.md), [api-gateway](specs/services/api-gateway.md) |
| UC022–UC024 | Trigger via Telegram, connect a Telegram bot, use the bot | Workspace + Workflow | The workspace's own bot is a `TELEGRAM` connection ([workspace-service](specs/services/workspace-service.md)); `trigger.telegram` starts a run from a message to that bot and `telegram.send_message` replies ([workflow-service](specs/services/workflow-service.md), [api-gateway](specs/services/api-gateway.md)) |
| UC025–UC026 | List users, lock/unlock accounts | Identity | [identity-service](specs/services/identity-service.md) |
| UC027 | List all workspaces | Workspace | [workspace-service](specs/services/workspace-service.md) |
| UC028 | Monitor all executions | Workflow | [workflow-service](specs/services/workflow-service.md) |

Web and mobile implement the client side; see [web](specs/apps/web.md) and [mobile](specs/apps/mobile.md). Mobile covers everything web does except designing workflows, with monitoring as its focus. Web and mobile (including web admin) are owned by T for now and shared later.

One capability is outside the thesis table: **group notifications**, where a workflow posts to a Telegram group through a `telegram.send_message` node using the workspace's bot connection (extends UC020). There is no separate bot service; it was replaced by these nodes (decided 2026-10-04).

## 4. Architecture rules

### Components

Owners: K = Nguyễn Hoàng Khải, T = partner (same letters as the `docs/work_logs/` folders).

| Component | Stack | Owner | Role |
| --- | --- | --- | --- |
| API Gateway | NestJS | T | Public ingress only: routing, edge auth, rate limiting, CORS, error normalization. Owns no business data and makes no business-authorization decisions. |
| Identity | Spring Boot | K | Accounts, sign-in, tokens, password recovery, admin account actions |
| Workspace | Spring Boot | K | Workspaces, members, permissions, connections and credentials, authorization checks for other services |
| Workflow | Spring Boot | K | Core domain: definitions, versions, validation, triggers, executions. The Background Worker and the (deferred) Agent Runtime live inside it, not as separate services. |
| AI | NestJS | K | Reasoning only: workflow generation and `ai.extract` / `ai.classify` / `ai.summarize`. Private, never on the public edge. |
| OCR | FastAPI | T | Document text and table extraction |
| Notification | NestJS | T | Consumes workflow events, stores the inbox, delivers notifications |

### Communication

- R-A1. Clients (web, mobile, webhook callers, Telegram) reach services only through the Gateway.
- R-A2. Services call each other directly over REST/JSON, never through the Gateway.
- R-A3. Asynchronous messages go through RabbitMQ with JSON payloads. Valkey is never used as a queue.
- R-A4. Every cross-service call has a documented contract in [packages/contracts](../packages/contracts): OpenAPI under `http/<service>/`, event schemas under `events/<domain>/`. Change the contract and its consumers' tests together.
- R-A5. Contract and persisted-data changes are additive by default. Renaming or dropping fields, routes, events, or columns needs a migration or rollback plan and the user's explicit confirmation.
- R-A6. Gateway changes are requested from its owner (T) as a documented handoff, not implemented by others.

### Data ownership

- R-D1. Each service owns its database and schema on Neon PostgreSQL: `identity-db`/`identity`, `workspace_db`/`workspace`, `workflow_db`/`workflow`, `notification_db`/`notification`; Bot uses schema `bot`.
- R-D2. No service reads or writes another service's tables. There are no cross-service joins; foreign IDs (user, workspace, connection) are opaque external references.
- R-D3. Schema changes go through the owning service's migrations only (Flyway for Spring Boot services).
- R-D4. Valkey holds only short-lived data: OTPs, codes, caches.
- R-D5. Files go to Cloudflare R2 (S3-compatible). No local databases or object storage; local containers only when a task needs them (see CLAUDE.md).

### Workflow model and AI

- R-W1. There is one canonical workflow model, `WorkflowDefinition` (nodes, edges, ports, data mappings, triggers), owned by Workflow and described in [packages/workflow-schema](../packages/workflow-schema) and [definition.schema.json](../packages/contracts/http/workflow/definition.schema.json). Builder-made and AI-generated workflows share it.
- R-W2. AI generation follows `WorkflowIntent → deterministic compiler (Workflow) → WorkflowDefinition → validator`. The LLM never emits a `WorkflowDefinition` directly.
- R-W3. The AI service never persists workflows, runs side-effecting tools, resolves credentials, or makes authorization decisions. Credentials stay in Workspace and are resolved by Workflow at run time.
- R-W4. Published versions are immutable. Runs always reference a published version.
- R-W5. `agent.task` and the Agent Runtime are deferred past V1 (see the [AI Service V1 design](superpowers/specs/2026-09-25-ai-service-v1-design.md)).

## 5. Security rules

- R-S1. Users authenticate with JWTs issued by Identity (issuer `weav-identity`, audience `weav-api`). The Gateway checks them at the edge, and every service re-checks identity and workspace scope for its own data (BR01).
- R-S2. Service-to-service calls authenticate in one of two ways. Identity, Workspace, and Workflow internal routes take a static `X-Internal-Service-Key` header, one key per callee. Calls to AI and OCR carry a short-lived Service JWT signed by the caller. Internal endpoints are never exposed through the Gateway. (OCR currently checks only that a Bearer token is present; see the [OCR spec](specs/services/ocr-service.md).)
- R-S3. Authorization for workspace-scoped actions is decided by Workspace; other services ask it and do not re-implement membership or permission rules.
- R-S4. Validate input at every service boundary. Apply size limits, rate limits, and timeouts to expensive work (AI, OCR, workflow execution, generation).
- R-S5. Secrets live only in `.env` or the local secret store and never in code, logs, docs, or commits. Each new variable gets a placeholder in `.env.example`.
- R-S6. Log with each framework's logger and request/correlation context. Never log passwords, tokens, keys, cookies, connection strings, or unnecessary personal data.

## 6. API and event conventions

- Public paths are versioned: `/api/v1/...`. Workspace-scoped resources nest under `/api/v1/workspaces/{workspaceId}/...`.
- The Gateway normalizes error responses for clients. Services return stable, machine-readable error codes that are documented in their OpenAPI.
- Events carry an event type and version, a unique ID for idempotent consumption, and only the IDs and fields that consumers need. Consumers must tolerate redelivery. The current notification envelope is [event-v2.schema.json](../packages/contracts/events/notification/event-v2.schema.json).
- Mutating endpoints that can be retried by clients or triggers (webhook, Telegram, run) should be idempotent or deduplicated; each spec states how.

## 7. Definition of done

A change is done when:

1. It meets the requirement and keeps the rules above.
2. The affected packages' tests and builds pass (see each spec's Testing section; the known environment-only errors are listed in CLAUDE.md).
3. Contract, event, schema, auth, or response-shape changes have an updated contract file and an integration or contract test.
4. User-facing web changes were checked in the running app with Playwright, including console and network errors.
5. The component spec's status tables and the feature's work log are updated.

## 8. Known conflicts with the thesis and Notion notes

The code is followed in each case. Keep these in mind when writing the thesis report.

| Topic | Thesis / Notion | Code |
| --- | --- | --- |
| Databases | One physical DB with `*_schema` names | One Neon database per service, schemas without the suffix |
| Cache | Redis | Valkey (Redis-compatible) |
| AI/OCR/Bot exposure | Gateway routes directly to AI, OCR, Bot | AI stays private; generation goes Gateway → Workflow → AI (the Gateway route is a pending partner handoff) |
| Workflow engine | Early intro: NestJS | Spring Boot |
| Use-case count | "32 use cases" | 28 listed and used |
| Triggers | §1.2.2: Manual, Webhook, Telegram | §3.2.3 and code also have Schedule (`trigger.schedule`) |
| Repository layout | [repository-structure.md](architecture/repository-structure.md) lists `auth-service`, `docker-compose*.yml` | `identity-service`, `workspace-service`, `notification-service`; `compose*.yml` |
