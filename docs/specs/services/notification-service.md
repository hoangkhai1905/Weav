# Notification Service

> Status: Implemented for V1 inbox (v2 events) and legacy Telegram/Expo delivery; producer-side gaps and client rollout remain (see Status and known gaps). Owner: TBD. Last verified: 2026-09-30 against `dev`.

## Purpose and scope

Consumes domain events from RabbitMQ, persists a per-user notification inbox, serves inbox reads to clients, and delivers legacy execution notifications to external channels (Telegram, Expo push) with retries.

Not responsible for: deciding who receives a notification (each producer resolves recipients), storing workflow execution details (Workflow), the Telegram bot conversation and linking (Bot), user identity (Identity, whose JWT it verifies), or public ingress (Gateway proxies to it; it has no public port and no send/test-dispatch endpoint).

## Use cases covered

| UC | Name | Status | Notes |
| --- | --- | --- | --- |
| UC020 | Receive result notifications | Implemented (service side) | Inbox for 19 v2 event types plus Telegram/Expo delivery for legacy `workflow.completed`/`workflow.failed` envelopes ([notifications.ts](../../../services/notification-service/src/application/notifications.ts), [rabbit.consumer.ts](../../../services/notification-service/src/infrastructure/rabbit.consumer.ts)). Telegram and Expo are disabled by default. |

## Business rules

| Rule | How it is enforced | Status |
| --- | --- | --- |
| BR01 | Inbox routes require a verified Identity access JWT; only `sub` scopes queries; missing or foreign-user IDs return 404 ([http.ts](../../../services/notification-service/src/presentation/http.ts)). | Implemented |
| BR09 | Delivery to Telegram relies on the producer supplying a linked chat as recipient destination; this service does not verify links. | Partial (producer-side) |
| Privacy | Only allowlisted event data is rendered; raw upstream summaries/errors are never persisted (README "Event contract"). | Implemented |
| Idempotency | Event ID plus recipient uniqueness; first persisted event wins for a given event ID. | Implemented |
| Delivery semantics | At least once, not exactly once (crash after provider accept, before commit, may duplicate). | Documented limitation |

## Domain model and data

Database `notification_db`, schema `notification` (`DB_SCHEMA` accepts only the literal `notification`). Prisma 7 ([schema.prisma](../../../services/notification-service/prisma/schema.prisma)); migrations in [prisma/migrations](../../../services/notification-service/prisma/migrations/) (`202609090001_notification_deliveries`, `202609260001_notification_inbox`).

| Table | Key columns | Notes |
| --- | --- | --- |
| `notification_deliveries` | `id`, `user_id`, `inbox_id?`, `execution_id?`, `source_event_id?`, `provider` (`TELEGRAM`/`EXPO_PUSH`), `destination` (<=512), `event_type`, `payload` JSONB, `status` (`PENDING`/`SENDING`/`SENT`/`FAILED`), `retry_count`, `last_error` JSONB, `read_at`, `scheduled_at`, `sent_at`, timestamps | Unique `(source_event_id, user_id, provider, destination)`; indexes on user/created, user/read, status/scheduled; FK `(inbox_id, user_id)` to inbox. Legacy read state and worker queue. |
| `notification_inbox` | `id`, `dedup_key` (unique), `source_event_id?`, `user_id`, `event_type`, `category`, `severity`, `workspace_id?`, `actor_user_id?`, `execution_id?`, `content` JSONB, `occurred_at`, `created_at`, `read_at` | Unique `(source_event_id, user_id)` and `(id, user_id)`; v2 read state. |

No foreign keys or reads across services. Timestamps are UTC `TIMESTAMPTZ(3)`. Expo ticket/receipt state lives in private JSONB keys (`_receiptId`, `_receiptSince`) hidden from HTTP.

## API

Public API (through the Gateway, which proxies both prefixes; see [notifications.module.ts](../../../services/api-gateway/src/notifications/notifications.module.ts)). Auth: Identity HS256 access JWT (issuer, audience, expiry, access-token type, active user and UUID claims verified). Full v2 contract: [notifications-v2.md](../../../packages/contracts/http/notifications-v2.md).

| Method | Path | Purpose | Main errors |
| --- | --- | --- | --- |
| GET | `/api/v2/notifications` | Inbox page `{items, nextCursor}`; `limit` 1-100 (default 20), `unreadOnly`, `category` (`WORKFLOW`/`WORKSPACE`/`CONNECTION`/`SECURITY`), `locale` (`vi` default, `en`), opaque `cursor`; strict query | 400 invalid query/cursor, 401 |
| GET | `/api/v2/notifications/unread-count` | `{count}` | 400 (any query), 401 |
| PATCH | `/api/v2/notifications/:id/read` | Mark one read, idempotent | 400 non-UUID, 404 |
| POST | `/api/v2/notifications/read-all` | `{updatedCount}` | 401 |
| GET / PATCH / POST | `/api/v1/notifications` (also `/api/notifications`), `/unread-count`, `/:id/read`, `/read-all` | Legacy delivery view; filters `eventType` (`workflow.completed`/`workflow.failed`), `status` | 400, 401, 404 |

Error body: `{error:{code,message,details:[]},status,timestamp,path}`.

Internal API (service-to-service): none. Operational: `GET /health` (liveness) and `GET /ready` (delivery table, inbox table, and broker consumer ready; 503 otherwise), both unauthenticated.

## Events and messaging

| Direction | Exchange / queue | Routing keys | Payload |
| --- | --- | --- | --- |
| Consumed | Durable topic exchange `weav.events`; queue `notification-service.execution-events` (durable, dead-letters to DLQ) | One binding per v2 event type (19 types; see [notification-event.ts](../../../services/notification-service/src/domain/notification-event.ts) and the [event catalog](../../../packages/contracts/events/notification/README.md)); routing key must equal `eventType` | v2 envelope (`schemaVersion: 2`, `recipientUserIds` 1-100, strict `data`) per [event-v2.schema.json](../../../packages/contracts/events/notification/event-v2.schema.json); or legacy envelope (`eventId`, `aggregateType: workflow_execution`, `payload.recipients` with provider and destination) |
| Published | Queue `notification-service.execution-events.dlq` | direct via default exchange | Sanitized record `{code, occurredAt}` for invalid events (no raw payload), sent with publisher confirms before ACK |

- Producers found in code: Workflow ([WorkflowNotificationOutboxPublisher.java](../../../services/workflow-service/src/main/java/com/weav/workflow/infrastructure/messaging/WorkflowNotificationOutboxPublisher.java)), Workspace ([NotificationOutboxPublisher.java](../../../services/workspace-service/src/main/java/com/weav/workspace/infrastructure/messaging/notification/NotificationOutboxPublisher.java)), Identity ([IdentityNotificationOutboxPublisher.java](../../../services/identity-service/src/main/java/com/weav/identity/infrastructure/messaging/notification/IdentityNotificationOutboxPublisher.java)). Payload conformance on the producer side was not verified in this pass.
- Consumer behaviour: prefetch 1, manual ACK. Message over 64 KiB, JSON syntax error, schema (Zod) error, routing-key mismatch, or persisted-event conflict goes to the DLQ then ACK. Database/broker errors leave the message unacked; the connection is closed and reconnects with exponential backoff (1s doubling, capped 30s).
- Legacy events fan out to `notification_deliveries` (one row per recipient, max 100); v2 events create one inbox item per recipient, linked to delivery rows only when legacy delivery intent exists.

## Dependencies

| Direction | Target | Purpose |
| --- | --- | --- |
| Consumes from | RabbitMQ | Event ingestion |
| Verifies tokens of | Identity (shared `JWT_ACCESS_SECRET`, no network call) | Inbox auth |
| Calls | Telegram Bot API (`sendMessage`, [providers.ts](../../../services/notification-service/src/infrastructure/providers.ts)); Expo Push (`expo-server-sdk`) | Delivery, when enabled |
| Stores | Neon PostgreSQL `notification_db` | Inbox and deliveries |
| Called by | API Gateway (`NOTIFICATION_SERVICE_URL`), web/mobile clients | Inbox reads |
| Does not call | Workflow, Workspace, Bot | Recipients arrive in the event |

## Security

- User JWT only (no Service JWT or internal key). No route accepts a user ID from body or header.
- The `producer` field is an event-family assertion, not authentication; broker credentials and permissions establish the true publisher ([events README](../../../packages/contracts/events/notification/README.md)). Default broker credentials in config are `guest`/`guest` (development only).
- Secrets (`JWT_ACCESS_SECRET` at least 32 bytes, `TELEGRAM_BOT_TOKEN`, `EXPO_ACCESS_TOKEN`, DB password) come from the environment; `TELEGRAM_BOT_TOKEN` is required when Telegram is enabled ([settings.ts](../../../services/notification-service/src/config/settings.ts)). The token appears in the outbound Telegram URL, so provider errors and destinations are not exposed in HTTP responses or logs.
- Limits: Fastify body limit 64 KiB, message limit 64 KiB, max 100 recipients, strict query schemas, DB TLS with certificate verification by default.
- Telegram detail links require `NOTIFICATION_DETAIL_BASE_URL` to be HTTPS without credentials, query or fragment.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | 3000 | HTTP port |
| `DB_HOST/PORT/NAME/USERNAME/PASSWORD` (root `NOTIFICATION_DB_*`) | port 5432 | Neon connection; host, name, user, password required |
| `DB_SCHEMA` / `DB_SSL_MODE` | `notification` / `require` | Schema (fixed) and TLS |
| `NOTIFICATION_MIGRATION_URL` | unset | Direct non-pooled URL for `db:migrate` only |
| `JWT_ACCESS_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE` | required, `weav-identity`, `weav-api` | Access token verification |
| `RABBITMQ_HOST/PORT/USERNAME/PASSWORD/VHOST/TLS` | `localhost`, 5672, `guest`, `guest`, `/`, `false` | Broker |
| `NOTIFICATION_EXCHANGE` / `_QUEUE` / `_DLQ` | `weav.events` / `notification-service.execution-events` / `...events.dlq` | Topology |
| `NOTIFICATION_TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN` | `false`, unset | Telegram provider |
| `NOTIFICATION_EXPO_ENABLED`, `EXPO_ACCESS_TOKEN` | `false`, unset | Expo provider |
| `NOTIFICATION_MAX_ATTEMPTS` | 5 (1-20) | Total send attempts |
| `NOTIFICATION_RETRY_BASE_MS` / `_RETRY_MAX_MS` | 1000 / 300000 | Backoff bounds |
| `NOTIFICATION_TIMEOUT_MS` | 10000 (100-30000) | Provider request timeout |
| `NOTIFICATION_LEASE_MS` | 60000 | Send lease; must be at least 3x timeout |
| `NOTIFICATION_POLL_MS` | 1000 | Worker poll interval |
| `NOTIFICATION_DETAIL_BASE_URL` | unset | Optional HTTPS base for Telegram links |

## Non-functional requirements

- Delivery state machine `PENDING -> SENDING -> SENT|FAILED`; workers claim one row with `FOR UPDATE SKIP LOCKED`; a millisecond `updated_at` lease fences stale completions ([delivery.worker.ts](../../../services/notification-service/src/application/delivery.worker.ts)).
- Retries: 5 attempts, exponential 1s to 5min, Telegram `Retry-After` may extend; timeouts, 429 and 5xx retry, invalid destination/credentials do not. Disabled providers yield terminal `PROVIDER_DISABLED` with no network call and are not resent when later enabled.
- Expo receipts are checked after 15 minutes and abandoned after 23 hours.
- Ingestion uses a per-event PostgreSQL advisory transaction lock; all recipient rows commit before ACK.
- DB pool max 3, connect timeout 5s, statement timeout 10s.
- Observability: Nest logger with structured event names (`notification_broker_unavailable`, `notification_event_rejected`); `/health` and `/ready`. No metrics endpoint found.

## Status and known gaps

- Implemented: consumer, DLQ, both ingestion paths, inbox v2 API, legacy v1 API, delivery worker, Telegram and Expo adapters, readiness.
- Partial: the README describes only `workflow.completed`/`workflow.failed` routing keys, but code binds all 19 v2 types. Telegram/Expo delivery is driven only by legacy envelopes with explicit `recipients`; v2 events are inbox-only, so BR09/UC020 Telegram notifications depend on Workflow still emitting legacy recipients (not verified).
- Rollout: legacy-to-inbox backfill and cutover are manual operator steps (`db:reconcile-inbox`); v1 and v2 read states are independent.
- Producer-side integration with a real Workflow publisher is called out as pending in the README; a Workflow test that needs the built notification `dist` is environment-only.
- No Bot integration: Notification sends Telegram messages itself with its own token.
- Delivery is at least once (duplicates possible).

## Testing

- Unit: `pnpm --dir services/notification-service test -- --runInBand` (spec files in `src/`, including settings, catalog, event schema, delivery worker, providers, Rabbit consumer).
- E2E: `pnpm --dir services/notification-service test:e2e` ([notification.e2e-spec.ts](../../../services/notification-service/test/notification.e2e-spec.ts)).
- Build: `pnpm --dir services/notification-service build`.
- Integration (Docker, test Compose on ports 15439/15689): `test:integration`, `test:inbox-integration` per [README](../../../services/notification-service/README.md). Not part of the last full results.
- Last results (2026-09-30, `dev`): 93/93 unit, 14/14 e2e.
- Do not run `lint` (it runs `eslint --fix`); use `pnpm --dir services/notification-service exec eslint "{src,test}/**/*.ts"`. No known environment-only errors here.

## Open questions

1. Should Telegram/Expo delivery move to v2 events (recipient destinations resolved by Notification from Bot/Identity data) instead of legacy `recipients` in the event? Suggested: keep legacy for V1, decide after the Bot design.
2. README lists two routing keys while code binds 19; the README needs an update. Suggested: treat the code and event catalog as authoritative.
3. Should the v1 API and legacy delivery view be retired after clients move to v2? Suggested: yes, after mobile/web cutover, with the reconciliation runbook completed first.
4. Notion assumes `notification_schema`; code uses `notification`. Suggested: keep `notification` (repository convention).
5. Should Notification stay the Telegram sender or delegate to Bot Service (one bot, one token)? Suggested: keep Notification as sender in V1; Bot handles inbound commands only.
6. Thesis UC020 mentions result notifications only; the service also covers workspace, connection and security events. Suggested: extend UC020 notes to state this.

## References

- Code: [services/notification-service](../../../services/notification-service/), [README](../../../services/notification-service/README.md), [package.json](../../../services/notification-service/package.json)
- Contracts: [notifications-v2.md](../../../packages/contracts/http/notifications-v2.md), [events/notification](../../../packages/contracts/events/notification/README.md)
- Compose and env: [compose.dev.yml](../../../compose.dev.yml) (`notification-service`), [.env.example](../../../.env.example) (`NOTIFICATION_*`)
- Producers: Workflow, Workspace, Identity outbox publishers (linked above)
- Related: [bot-service.md](bot-service.md), [../README.md](../README.md), [../../rulebook.md](../../rulebook.md)
