# Bot Service

> Status: Planned. `services/bot-service` is a NestJS scaffold (a "Hello World" controller and empty layer folders); no Telegram, linking, or Workflow code exists. Owner: TBD. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

Target (V1): the Telegram-facing service. It owns the Telegram bot (via `grammy`), Telegram account linking, the bot commands that list, inspect and run workflows, and normalization of Telegram updates into trigger input for Workflow (BR09, UC022-UC024).

Not responsible for: user identity or passwords (Identity), workspace/membership authorization (Workspace), workflow storage and execution (Workflow), outbound result notifications (Notification), and public edge concerns (API Gateway). The [Workflow spec](../../superpowers/specs/workflow-service-spec.md) states that Workflow never receives the Telegram public webhook; Bot owns Telegram updates.

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC022 | Trigger via Telegram | Planned | Bot normalizes an update and calls a Workflow trigger ingress. The Workflow-side route, body and auth are not agreed (the Workflow spec calls its path a placeholder). |
| UC023 | Link Telegram account | Planned | No code. Placeholders only: `src/application/link-account/`, `src/domain/bot-account/`. |
| UC024 | Interact with workflows via Telegram bot | Planned | Placeholders only: `src/application/{list-workflows,workflow-status,run-workflow,pause-workflow}/`, `src/handlers/{commands,callbacks}/`. |

## Business rules

| Rule | How Bot should enforce it | Status |
| --- | --- | --- |
| BR09 (link before use) | Reject every command from a Telegram chat that has no verified link to a Weav user. | Planned |
| BR09 (trigger matches active workflow) | Forward a Telegram trigger only for a configured `trigger.telegram` of an active workflow; Workflow makes the final match. | Planned |
| BR01 / BR03 | Bot acts as the linked user; Workflow and Workspace authorize the call. Bot never decides workspace access. | Planned |
| BR06 | Paused workflows accept no automatic triggers (enforced in Workflow). | Planned |

No component-specific rules exist in code.

## Domain model and data

- Schema name: `bot`. Compose sets `DB_SCHEMA: bot` and maps `BOT_DB_*` to `DB_*` ([compose.dev.yml](../../../compose.dev.yml)).
- Tables: None. There is no Prisma schema and no migration in the package, although `@prisma/client` and `prisma` are declared in [package.json](../../../services/bot-service/package.json).
- Intended entities (inferred from folder names only, not code): bot account (a Telegram chat linked to a Weav user) and command. Short-lived link codes would live in Valkey per the architecture baseline. Nothing is designed yet.

## API

Public API (through the Gateway): None implemented. The Gateway only has the upstream setting `BOT_SERVICE_URL` (default `http://bot-service:3000`) in [gateway.config.ts](../../../services/api-gateway/src/config/gateway.config.ts); no Bot route was found. `packages/contracts/http/bot/` exists but is empty.

Internal API:

| Caller | Method | Path | Auth | Status |
| --- | --- | --- | --- | --- |
| any | GET | `/` | none | Implemented as scaffold only: returns `Hello World!` ([app.controller.ts](../../../services/bot-service/src/app.controller.ts)). To be removed or replaced. |
| Telegram | POST | webhook path TBD | Telegram secret token | Planned |
| Bot -> Workflow | list / status / run / trigger | TBD | Service JWT | Planned; contract not approved |

There is no `/health` or `/ready` endpoint (unlike Notification).

## Events and messaging

None. Compose gives the service RabbitMQ variables, but no code uses a messaging client and `amqplib` is not a dependency; `src/infrastructure/messaging/` is a `.gitkeep`.

## Dependencies

| Direction | Target | Status |
| --- | --- | --- |
| Calls | Workflow Service (`WORKFLOW_SERVICE_URL=http://workflow-service:8080`) for list/status/run/trigger | Planned; `src/infrastructure/workflow-client/` is empty |
| Calls | Identity (verify the user during linking) | Planned; no contract, unclear |
| Calls | Telegram Bot API through `grammy` (declared, not imported) | Planned |
| Called by | Gateway (`BOT_SERVICE_URL`); possibly Workflow (Telegram send node) | Planned |
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
- The `pause-workflow` placeholder has no matching thesis use case (UC024 covers list, status, run).

## Testing

- Unit: `pnpm --dir services/bot-service test`. The only spec is the scaffold [app.controller.spec.ts](../../../services/bot-service/src/app.controller.spec.ts).
- E2E: `pnpm --dir services/bot-service test:e2e` ([app.e2e-spec.ts](../../../services/bot-service/test/app.e2e-spec.ts) asserts `GET /` returns `Hello World!`).
- Build: `pnpm --dir services/bot-service build`. Do not run `lint` (it runs `eslint --fix`); use `pnpm --dir services/bot-service exec eslint "{src,test}/**/*.ts"`.
- Not run for this spec. No known environment-only errors.

## Open questions

1. Telegram update delivery: webhook (needs public ingress, which conflicts with "Gateway is the only public ingress") or long polling? Suggested: long polling in V1/dev, webhook via Gateway later.
2. Link handshake: where are link codes (Valkey) and chat bindings (`bot` schema) stored, and how does Bot verify the Weav user? Suggested: web/mobile requests a one-time code from Bot with the user JWT, then the user sends `/link <code>` to the bot.
3. Bot <-> Workflow contract (list/status/run and Telegram trigger ingress: path, body, Service JWT). The Workflow spec defers it until Bot's contract is approved. Suggested: write `packages/contracts/http/bot` and a Workflow internal OpenAPI first.
4. Is Notification's `TELEGRAM_BOT_TOKEN` the same bot as Bot Service's? Suggested: one bot, one token in secrets, chat ID stored by Bot and resolved into recipients by Workflow.
5. The Notion diagram routes Gateway -> Bot directly; the baseline says the Gateway is the client ingress only. Which client-facing Bot endpoints (link code, unlink) go through the Gateway? Suggested: only those.
6. Is Discord in scope? The `adapters/discord` placeholder exists. Suggested: remove from V1.
7. Should the bot support pause/resume (placeholder `pause-workflow`)? Suggested: list, status, run only in V1.

## References

- Code: [services/bot-service](../../../services/bot-service/), [package.json](../../../services/bot-service/package.json), [README](../../../services/bot-service/README.md) (unmodified NestJS template)
- Compose and env: [compose.dev.yml](../../../compose.dev.yml) (`bot-service` block), [.env.example](../../../.env.example) (`BOT_DB_*`)
- Workflow Telegram path: [workflow-service-spec.md](../../superpowers/specs/workflow-service-spec.md)
- Gateway upstream: [gateway.config.ts](../../../services/api-gateway/src/config/gateway.config.ts)
- Related: [notification-service.md](notification-service.md), [../README.md](../README.md), [../../rulebook.md](../../rulebook.md)
