-- WF-13: terminal state for notification events that exhaust their publish attempts (additive).
ALTER TABLE notification_outbox DROP CONSTRAINT ck_notification_outbox_status;
ALTER TABLE notification_outbox ADD CONSTRAINT ck_notification_outbox_status
    CHECK (status IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'SKIPPED', 'FAILED'));
