# WEAV Notification Service

NestJS 11 + Fastify, Prisma 7/PostgreSQL, RabbitMQ, Telegram and Expo Push. Node 24 and the root-declared pnpm version are required. Owns only `notification.notification_deliveries`; no cross-service foreign keys or database reads.

## API

All inbox routes require an Identity HS256 access JWT (issuer/audience, expiry, access-token type, active user and UUID claims verified). Only the verified `sub` scopes queries; body/header user IDs are never trusted.

| Method | Canonical route | Response |
| --- | --- | --- |
| GET | /api/v1/notifications | `{items, nextCursor}` |
| GET | /api/v1/notifications/unread-count | `{count}` |
| PATCH | /api/v1/notifications/:id/read | `{item}` |
| POST | /api/v1/notifications/read-all | `{updatedCount}` |
| GET | /health | Liveness |
| GET | /ready | Database table + broker readiness; 503 when unavailable |

The four inbox routes also accept `/api/notifications`. Gateway proxies both prefixes to the same handlers. Notification has no public container port and no send/test-dispatch HTTP endpoint.

List query: `limit` defaults to 20 (1–100), opaque `cursor`, `unreadOnly=true|false`, exact `eventType=workflow.completed|workflow.failed`, `status=PENDING|SENDING|SENT|FAILED`. Order is newest `createdAt,id` first. Other query parameters are rejected. A page is per recipient/delivery, not one item per execution. Read operations are idempotent; missing and foreign-user IDs both return 404. Errors follow `{error:{code,message,details:[]},status,timestamp,path}`.

Items contain id, userId, executionId, provider, eventType, title, message, public payload, status, read/readAt, scheduledAt, sentAt, createdAt and updatedAt. Destination, credentials, provider errors and private receipt metadata are not exposed. The mobile HTTP mapper accepts this envelope; web/local mock mode is unchanged. Existing mobile UI uses the first page.

## Event contract

Workflow owns publication and recipient resolution. Publish persistent JSON messages to durable topic exchange `weav.events`, routing key `workflow.completed` or `workflow.failed`. Default queue: `notification-service.execution-events`; durable DLQ: `notification-service.execution-events.dlq`.

```json
{
  "eventId": "00000000-0000-4000-8000-000000000001",
  "eventType": "workflow.completed",
  "occurredAt": "2026-09-09T10:00:00Z",
  "aggregateType": "workflow_execution",
  "aggregateId": "00000000-0000-4000-8000-000000000002",
  "payload": {
    "executionId": "00000000-0000-4000-8000-000000000002",
    "workflowId": "00000000-0000-4000-8000-000000000003",
    "userId": "00000000-0000-4000-8000-000000000004",
    "workspaceId": "00000000-0000-4000-8000-000000000005",
    "workflowName": "Daily Sales Report",
    "status": "SUCCESS",
    "finishedAt": "2026-09-09T10:00:00Z",
    "summary": "Workflow completed successfully.",
    "error": null,
    "recipients": [{"provider": "TELEGRAM", "destination": "12345"}]
  }
}
```

For failures use `workflow.failed`, status `FAILED`, and a sanitized `error:{code,message}`. Expo recipients use provider `EXPO_PUSH` and an Expo push token as destination. Execution/aggregate IDs must match, as must event type/status. At most 100 recipients and 64 KiB per message. Unknown fields are stripped. Empty/malformed recipient lists reject the whole event; syntactically invalid provider destinations become permanent failed delivery rows.

Privacy policy: raw upstream summaries/errors may contain secrets, so only a generated success/failure summary, workflow name/IDs and finish time are persisted/rendered. Full execution details remain in Workflow. Do not put secrets in workflow names or recipient destinations.

Ingestion uses a PostgreSQL advisory transaction lock per event and a recipient unique index. All recipient rows commit before ACK. Replay of an existing event ID cannot add destinations. Invalid messages produce a sanitized durable DLQ record (no raw payload), confirmed by RabbitMQ before ACK. Database/broker errors leave the original unacked; reconnect requeues with exponential 1–30s backoff. Infrastructure recovery continues while the dependency is unavailable; provider send attempts are bounded.

## Delivery and recovery

`PENDING → SENDING → SENT|FAILED`; Expo tickets return to PENDING until a receipt confirms acceptance by APNs/FCM. SENT does not prove the device displayed or the user read the notification.

Workers claim one due row transactionally with `FOR UPDATE SKIP LOCKED`. A millisecond `updated_at` lease fences stale completions. Read changes deliberately update only `read_at` so they cannot invalidate a send lease. Expired SENDING, due PENDING and retryable FAILED rows recover after restart.

Default five total send attempts; exponential delays start at 1s, cap at 5min; Telegram Retry-After can extend that delay. Timeouts, 429 and 5xx retry; invalid destinations/credentials and permanent provider rejections stop. Disabled providers produce terminal PROVIDER_DISABLED outcomes (no network calls). Enabling a provider later does not automatically resend terminal failures.

Expo tickets/receipt timestamps are private JSONB keys `_receiptId`/`_receiptSince`, hidden from HTTP. Check receipts after 15min, stop missing-receipt checks after 23h. Network errors keep the ticket; definitive retryable receipt failures clear it for a bounded resend. SDK chunking is used with one recipient per claimed row; no external SDK objects enter domain ports. Requests have finite deadlines and per-call agents are destroyed on timeout.

Delivery is **at least once**, not exactly once: a crash after provider acceptance but before the database commit can cause a duplicate. Neither provider offers the transactional idempotency needed to remove that window. Database claim fencing prevents concurrent normal sends; receipt persistence avoids unnecessary Expo resends after restart.

## Configuration and migration

Runtime variables (Compose maps root `NOTIFICATION_DB_*` to service `DB_*`):

- Required: DB_HOST, DB_NAME, DB_USERNAME, DB_PASSWORD, JWT_ACCESS_SECRET (at least 32 bytes; same signing key as Identity).
- DB_PORT=5432, DB_SCHEMA=notification, DB_SSL_MODE=require (certificate verification enabled; disable only for local tests).
- JWT_ISSUER=weav-identity, JWT_AUDIENCE=weav-api, PORT=3000.
- RABBITMQ_HOST=localhost, RABBITMQ_PORT=5672, RABBITMQ_USERNAME, RABBITMQ_PASSWORD, RABBITMQ_VHOST=/, RABBITMQ_TLS=false.
- NOTIFICATION_EXCHANGE, NOTIFICATION_QUEUE, NOTIFICATION_DLQ: defaults above.
- NOTIFICATION_TELEGRAM_ENABLED=false, TELEGRAM_BOT_TOKEN; NOTIFICATION_EXPO_ENABLED=false, EXPO_ACCESS_TOKEN (optional).
- NOTIFICATION_TIMEOUT_MS=10000, NOTIFICATION_MAX_ATTEMPTS=5, NOTIFICATION_RETRY_BASE_MS=1000, NOTIFICATION_RETRY_MAX_MS=300000, NOTIFICATION_POLL_MS=1000, NOTIFICATION_LEASE_MS=60000 (at least three request timeouts).
- Optional NOTIFICATION_DETAIL_BASE_URL: HTTPS without credentials/query/fragment. Unset to omit Telegram links.
- Gateway: NOTIFICATION_SERVICE_URL=http://notification-service:3000.
- Migration only: NOTIFICATION_MIGRATION_URL, a direct non-pooled connection supplied by your secret manager/shell.

Migration adds canonical delivery fields plus **read_at** (durable read state) and **source_event_id** (event deduplication), which are additive extensions to the Notion model. It uses the repository's existing `notification` convention, not `notification_schema`. UTC TIMESTAMPTZ(3), JSONB payload/errors, user/read/scheduling/dedup indexes; no external foreign keys. Prisma client is generated in a service-private node_modules path so other services' clients are not overwritten.

Apply migrations explicitly before starting the service; runtime never auto-migrates or synchronizes schema. Existing nonempty schemas require review/baselining; never reset a deployed database. Rollback the application while retaining this additive table; no automatic destructive down migration.

```powershell
pnpm --dir services/notification-service db:migrate
pnpm --dir services/notification-service build
pnpm --dir services/notification-service start:prod
```

## Verification

Unit/E2E require no real credentials or external network:

```powershell
pnpm --dir services/notification-service test -- --runInBand
pnpm --dir services/notification-service build
pnpm --dir services/notification-service test:e2e
pnpm --dir services/api-gateway test -- --runInBand
pnpm --dir services/api-gateway build
node --test apps/mobile/src/infrastructure/http/notification.mapper.test.cjs
git diff --check
```

Isolated PostgreSQL/RabbitMQ integration (loopback ports 15439/15689, test-only trust authentication; never use this Compose file for production):

```powershell
docker compose -p weav-notification-test -f services/notification-service/test/compose.yml up -d --wait
pnpm --dir services/notification-service build
pnpm --dir services/notification-service test:integration
docker compose -p weav-notification-test -f services/notification-service/test/compose.yml down --volumes
```

Integration exercises migration SQL, real concurrent dedup/claims, read authorization and lease fencing, persisted retries, actual broker delivery/DLQ and authenticated Fastify HTTP. Provider adapters use mocked HTTP/SDK operations, not production devices. A real Workflow event publisher remains a producer-side integration requirement; this task does not modify Workflow or Bot.

## Sources

[Notification schema](https://app.notion.com/p/67d4d7a29afb82fbbf1081ab3db6f03a), [service boundaries](https://app.notion.com/p/57f4d7a29afb833ca27b014ed52a82db), [class model](https://app.notion.com/p/1074d7a29afb83fda6aa8142d505852d).
Receipt timing follows [Expo delivery guidance](https://docs.expo.dev/push-notifications/sending-notifications/); durability uses [RabbitMQ acknowledgments and publisher confirms](https://www.rabbitmq.com/docs/confirms).
