-- WS-13: terminal state for events that exhausted their delivery attempts.
ALTER TABLE notification_outbox ADD COLUMN failed_at TIMESTAMPTZ;

DROP INDEX idx_notification_outbox_due;
CREATE INDEX idx_notification_outbox_due
    ON notification_outbox (next_attempt_at, created_at, event_id)
    WHERE published_at IS NULL AND failed_at IS NULL;

CREATE INDEX idx_notification_outbox_published
    ON notification_outbox (published_at)
    WHERE published_at IS NOT NULL;
