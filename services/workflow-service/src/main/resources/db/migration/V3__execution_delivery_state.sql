ALTER TABLE workflow_executions
    ADD COLUMN root_node_id VARCHAR(255),
    ADD COLUMN correlation_id VARCHAR(128),
    ADD COLUMN traceparent VARCHAR(255),
    ADD COLUMN scheduled_at TIMESTAMPTZ,
    ADD COLUMN edge_states JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN lease_owner VARCHAR(128),
    ADD COLUMN lease_token BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN lease_until TIMESTAMPTZ;

CREATE UNIQUE INDEX uq_workflow_executions_trigger_schedule
    ON workflow_executions (trigger_id, scheduled_at)
    WHERE scheduled_at IS NOT NULL;

ALTER TABLE node_executions
    ADD COLUMN next_attempt_at TIMESTAMPTZ;

ALTER TABLE outbox_events
    ADD COLUMN publisher_lease_token UUID,
    ADD COLUMN publisher_lease_until TIMESTAMPTZ,
    ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX idx_outbox_delivery_pending
    ON outbox_events (next_attempt_at, created_at, id)
    WHERE status = 'PENDING';
