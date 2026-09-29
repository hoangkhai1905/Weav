CREATE TABLE notification_outbox (
    event_id UUID PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_failure_code VARCHAR(32)
);

CREATE INDEX idx_notification_outbox_due
    ON notification_outbox (next_attempt_at, created_at, event_id)
    WHERE published_at IS NULL;
