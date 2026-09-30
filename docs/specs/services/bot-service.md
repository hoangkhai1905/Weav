# Bot Service

> Status: Planned (scope decided 2026-09-30: linking, Telegram trigger, group notifications). `services/bot-service` is a NestJS scaffold (a "Hello World" controller and empty layer folders); no Telegram, linking, or Workflow code exists. Owner: TBD. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

V1 scope (decided 2026-09-30): Bot is **Telegram as a channel into and out of workflows**, not a second client. Monitoring and control from a phone belong to the mobile app, so Bot does not duplicate them.

Responsible for (target):

1. **Chat linking (UC023).** Bind a Telegram chat to Weav: a private chat to a user, or a group chat to a workspace. Linking uses a one-time code created in web or mobile, which the user sends to the bot as `/link <code>`.
2. **Telegram trigger ingress (UC022).** Receive messages and photos from linked chats, normalize them, and forward them to Workflow so that a matching `trigger.telegram` on an active workflow starts a run. Example: send a receipt photo, then OCR extracts it and a row is appended to Google Sheets.
3. **Group notifications (new, not in the thesis).** A workspace can link a Telegram group, and workflows post to it through the `telegram.send_message` node. Bot owns the bot token and performs the send for Workflow.
4. Optional if time allows: `/status` for recent runs (UC024).

Not responsible for: user identity or passwords (Identity), workspace/membership authorization (Workspace), workflow storage and execution (Workflow), in-app/push result notifications (Notification), the public edge (API Gateway), or listing, running, and pausing workflows from chat (mobile covers these). The [Workflow spec](../../superpowers/specs/workflow-service-spec.md) states that Workflow never receives the Telegram public webhook; Bot owns Telegram updates.

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC022 | Trigger via Telegram | Planned | Bot normalizes an update from a linked chat and calls a Workflow trigger ingress. The Workflow-side route, body and auth are not agreed (the Workflow spec calls its path a placeholder). |
| UC023 | Link Telegram account | Planned | Covers private chats (user) and group chats (workspace). Placeholders only: `src/application/link-account/`, `src/domain/bot-account/`. |
| UC024 | Interact with workflows via Telegram bot | Planned (reduced) | Only an optional `/status`; list/run/pause from chat is out of V1 because mobile covers it. |
| (new) | Group notifications (extends UC020) | Planned | Workflow `telegram.send_message` targets a group linked to the same workspace. Not in the thesis use-case table. |

## Business rules

| Rule | How Bot should enforce it | Status |
| --- | --- | --- |
| BR09 (link before use) | Ignore or reject every message from a chat that has no verified link. | Planned |
| BR09 (trigger matches active workflow) | Forward a Telegram trigger only from a linked chat; Workflow makes the final match against a configured `trigger.telegram` of an active workflow. | Planned |
| BR03 (workspace scope) | A group chat is linked to exactly one workspace, and only the workspace Owner can link or unlink it. Workflows may send only to chats linked to their own workspace, never to an arbitrary `chatId`. | Planned |
| BR01 | Bot acts on behalf of the linked user or workspace; Workflow and Workspace authorize every call. Bot never decides workspace access. | Planned |
| BR06 | Paused workflows accept no automatic triggers (enforced in Workflow). | Planned |

No component-specific rules exist in code.

## Domain model and data

- Schema name: `bot`. Compose sets `DB_SCHEMA: bot` and maps `BOT_DB_*` to `DB_*` ([compose.dev.yml](../../../compose.dev.yml)).
- Tables: None yet. There is no Prisma schema and no migration in the package, although `@prisma/client` and `prisma` are declared in [package.json](../../../services/bot-service/package.json).
- Proposed entities (design, not code):

| Entity | Key fields | Notes |
| --- | --- | --- |
| `chat_link` | `id`, `telegram_chat_id` (unique), `chat_type` (`private`/`group`), `user_id` (private) or `workspace_id` (group), `linked_by_user_id`, `linked_at`, `revoked_at` | `user_id`/`workspace_id` are external references (no cross-service joins). |
| link code | one-time code, target (user or workspace), creator, TTL of a few minutes | Stored in Valkey, never in the database. |
| processed update | `update_id` | Deduplicates Telegram redelivery (can be a short-lived Valkey key). |

## API

Public API (through the Gateway): None implemented. The Gateway only has the upstream setting `BOT_SERVICE_URL` (default `http://bot-service:3000`) in [gateway.config.ts](../../../services/api-gateway/src/config/gateway.config.ts); no Bot route was found. `packages/contracts/http/bot/` exists but is empty.

Internal API:

| Caller | Method | Path | Auth | Status |
| --- | --- | --- | --- | --- |
| any | GET | `/` | none | Implemented as scaffold only: returns `Hello World!` ([app.controller.ts](../../../services/bot-service/src/app.controller.ts)). To be removed or replaced. |
| Telegram | POST | webhook path TBD (or long polling) | Telegram secret token | Planned |
| Web/mobile via Gateway | POST | create a link code (user chat or workspace group) | user JWT | Planned |
| Web/mobile via Gateway | GET / DELETE | list and unlink the caller's or the workspace's chats | user JWT | Planned |
| Bot -> Workflow | POST | Telegram trigger ingress | internal key or Service JWT | Planned; contract not approved |
| Workflow -> Bot | POST | send a message to a linked chat (`telegram.send_message`) | internal key or Service JWT | Planned; contract not approved |

There is no `/health` or `/ready` endpoint (unlike Notification).

## Events and messaging

None. Compose gives the service RabbitMQ variables, but no code uses a messaging client and `amqplib` is not a dependency; `src/infrastructure/messaging/` is a `.gitkeep`.

## Dependencies

| Direction | Target | Status |
| --- | --- | --- |
| Calls | Workflow Service (`WORKFLOW_SERVICE_URL=http://workflow-service:8080`) for trigger ingress and optional `/status` | Planned; `src/infrastructure/workflow-client/` is empty |
| Calls | Workspace, to check that the user linking a group is the workspace Owner | Planned |
| Calls | Identity (verify the user during linking) | Planned; no contract, unclear |
| Calls | Telegram Bot API through `grammy` (declared, not imported) | Planned |
| Called by | Gateway (`BOT_SERVICE_URL`) for link codes and unlink; Workflow for `telegram.send_message` | Planned |
| Stores | Neon PostgreSQL (`bot` schema); Valkey for link codes | Planned |

## Security

- Nothing is implemented: no authentication, input validation, or rate limiting. `zod` and `@nestjs/config` are declared but unused.
- Planned: verify a Telegram webhook secret token (if webhooks are used); Service JWT toward Workflow (same pattern as AI/OCR); one-time link code to bind a chat to a user; never log the bot token or user messages.
- Secrets: the only Telegram token variable is `TELEGRAM_BOT_TOKEN`, used by Notification. Bot has none in compose or [.env.example](../../../.env.example). Whether both services share one bot is undecided.

## Configuration

| Variable | Default | Meaning | Read by code |
| --- | --- | --- | --- |
| `PORT` | 3000 | HTTP port ([main.ts](../../../services/bot-service/src/main.ts), Fastify, host 0.0.0.0) | Yes |
| `APP_ENV` | `development` | Environment label (compose) | No |
| `BOT_DB_HOST/PORT/NAME/USERNAME/PASSWORD/SSL_MODE` mapped to `DB_*` | port 5432, ssl `require` | Neon connection; `DB_SCHEMA=bot` | No |
| `RABBITMQ_HOST/PORT/USERNAME/PASSWORD` | `rabbitmq`, 5672, `guest` | Broker access | No |
| `WORKFLOW_SERVICE_URL` | `http://workflow-service:8080` | Workflow base URL | No |

Missing and needed later: Telegram bot token, webhook secret/URL, Service JWT key material.

## Non-functional requirements

- Current: none beyond default Nest/Fastify behavior. No timeouts, retries, body limit, health endpoint, or structured logging.
- Target (proposal, not code): idempotent handling per Telegram `update_id`; finite timeouts on Workflow calls; per-chat rate limit; a readiness endpoint reporting DB and Workflow reachability.

## Status and known gaps

- All functional capabilities are Planned. The `src/adapters/{telegram,discord}`, `application/*`, `domain/*`, `handlers/*`, `infrastructure/*` folders contain only `.gitkeep`.
- `adapters/discord` exists although Discord is not in V1 scope.
- No Prisma schema or migrations, no `packages/contracts/http/bot` contract, no Gateway route.
- Workflow's `trigger.telegram` cannot start a real execution until Bot and Workflow agree the ingress contract. Until then the Workflow `telegram.send_message` node must fail with `DEPENDENCY_NOT_CONFIGURED` (Workflow spec).
- The `list-workflows`, `run-workflow` and `pause-workflow` placeholders are out of V1 scope (mobile covers them).
- Workflow's `telegram.send_message` currently takes a raw `chatId`; it must be restricted to chats linked to the workflow's workspace before it is enabled.

## Testing

- Unit: `pnpm --dir services/bot-service test`. The only spec is the scaffold [app.controller.spec.ts](../../../services/bot-service/src/app.controller.spec.ts).
- E2E: `pnpm --dir services/bot-service test:e2e` ([app.e2e-spec.ts](../../../services/bot-service/test/app.e2e-spec.ts) asserts `GET /` returns `Hello World!`).
- Build: `pnpm --dir services/bot-service build`. Do not run `lint` (it runs `eslint --fix`); use `pnpm --dir services/bot-service exec eslint "{src,test}/**/*.ts"`.
- Not run for this spec. No known environment-only errors.

## Open questions

1. Telegram update delivery: webhook (needs public ingress through the Gateway) or long polling? Suggested: long polling in V1 and dev (no public URL needed), webhook through the Gateway later.
2. Bot <-> Workflow contracts (trigger ingress and send message: path, body, auth). The Workflow spec defers the trigger until Bot's contract is approved. Suggested: write `packages/contracts/http/bot` first; use `X-Internal-Service-Key` like the other internal routes.
3. One bot or two? Notification already has `TELEGRAM_BOT_TOKEN` for legacy Telegram delivery. Suggested: one bot and one token, owned by Bot; Notification's Telegram delivery either calls Bot or is dropped in favour of in-app and push.
4. Group notification target: only workflow `telegram.send_message` to a linked group, or also route workspace result notifications (`workflow.completed`/`failed`) to the group automatically? Suggested: the node only in V1; automatic routing later.
5. Who may use a linked group as a trigger source? Suggested: any member of the group can trigger, but only workflows of the linked workspace are matched.
6. Discord: the `adapters/discord` placeholder exists. Suggested: remove from V1.
7. Owner is not decided.

## References

- Code: [services/bot-service](../../../services/bot-service/), [package.json](../../../services/bot-service/package.json), [README](../../../services/bot-service/README.md) (unmodified NestJS template)
- Compose and env: [compose.dev.yml](../../../compose.dev.yml) (`bot-service` block), [.env.example](../../../.env.example) (`BOT_DB_*`)
- Workflow Telegram path: [workflow-service-spec.md](../../superpowers/specs/workflow-service-spec.md)
- Gateway upstream: [gateway.config.ts](../../../services/api-gateway/src/config/gateway.config.ts)
- Related: [notification-service.md](notification-service.md), [../README.md](../README.md), [../../rulebook.md](../../rulebook.md)
