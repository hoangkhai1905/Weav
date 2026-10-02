# Identity security notification outbox

Identity records four successful security milestones in its own `notification_outbox` table: password change, password reset, explicit Google account link, and Google account unlink. Each row stores one Notification v2 envelope with only the affected user as recipient, a `USER` entity, an empty `data` object, and a fresh event ID. Password reset uses a null actor; the other events use the authenticated user. Routine authentication activity and Google login are not security-notification events.

The V5 migration is additive and service-local. The outbox insert shares the database transaction and user lock with the corresponding password/session or OAuth account mutation. If the insert fails, that database mutation rolls back. A reset grant or OAuth handoff already consumed from Redis is intentionally not restored after a database rollback; retry requires a new grant or handoff.

Publishing is asynchronous. Identity sends the stored payload as a persistent RabbitMQ message to `NOTIFICATION_EXCHANGE` (default `weav.events`), using the event type as routing key and event ID as message/correlation ID. A row is marked published only after a positive correlated confirm and no mandatory-returned message. Nacks, unroutable messages, timeouts, transport failures, and restarts leave the row durable for retry with the same ID and payload. Retry logging uses safe failure codes, not payloads or credentials.

Recording remains enabled regardless of publisher configuration. `IDENTITY_NOTIFICATION_OUTBOX_PUBLISHER_ENABLED=false` pauses only publishing; the default is `true`. Bounds are batch size 1–250, polling interval 50–60,000 ms, initial delay 0–60,000 ms, confirm timeout 1 ms–30 s, and maximum retry delay 1 ms–60 s. Compose forwards these settings without requiring RabbitMQ health before Identity starts; broker availability does not gate a password or account mutation.

Rollback guidance: the migration only adds the table and index. Roll back the application without dropping the outbox table; retained rows can be published after a compatible application is restored. Do not delete or rewrite rows as part of an application rollback.
