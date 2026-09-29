CREATE TABLE notification_outbox (
    sequence_id BIGSERIAL PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    event_type VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    producer VARCHAR(64) NOT NULL DEFAULT 'workflow-service',
    workspace_id UUID NOT NULL,
    actor_user_id UUID,
    recipient_user_id UUID,
    entity_kind VARCHAR(16) NOT NULL,
    entity_id UUID NOT NULL,
    requires_monitor_access BOOLEAN NOT NULL,
    payload JSONB,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    claim_token UUID,
    lease_until TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_reason_code VARCHAR(64),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_notification_outbox_type CHECK (event_type IN (
        'workflow.created', 'workflow.published', 'workflow.paused', 'workflow.resumed',
        'workflow.completed', 'workflow.failed')),
    CONSTRAINT ck_notification_outbox_producer CHECK (producer = 'workflow-service'),
    CONSTRAINT ck_notification_outbox_entity CHECK (
        (entity_kind = 'WORKFLOW' AND event_type IN (
            'workflow.created', 'workflow.published', 'workflow.paused', 'workflow.resumed')
            AND NOT requires_monitor_access)
        OR
        (entity_kind = 'EXECUTION' AND event_type IN ('workflow.completed', 'workflow.failed')
            AND requires_monitor_access)),
    CONSTRAINT ck_notification_outbox_recipient CHECK (
        recipient_user_id IS NOT NULL OR (requires_monitor_access AND status = 'SKIPPED')),
    CONSTRAINT ck_notification_outbox_payload CHECK (
        payload IS NOT NULL OR (requires_monitor_access AND status = 'SKIPPED'
            AND recipient_user_id IS NULL)),
    CONSTRAINT ck_notification_outbox_status CHECK (status IN ('PENDING', 'CLAIMED', 'PUBLISHED', 'SKIPPED')),
    CONSTRAINT ck_notification_outbox_retry_count CHECK (retry_count >= 0),
    CONSTRAINT ck_notification_outbox_lease CHECK (
        (status = 'CLAIMED' AND claim_token IS NOT NULL AND lease_until IS NOT NULL)
        OR (status <> 'CLAIMED' AND claim_token IS NULL AND lease_until IS NULL))
);

CREATE INDEX ix_notification_outbox_pending
    ON notification_outbox (next_attempt_at, sequence_id)
    WHERE status = 'PENDING';

CREATE INDEX ix_notification_outbox_expired_claims
    ON notification_outbox (lease_until, sequence_id)
    WHERE status = 'CLAIMED';
