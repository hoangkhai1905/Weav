-- WF-1: optional idempotency key for manual and webhook admission (additive, nullable).
ALTER TABLE workflow_executions
    ADD COLUMN idempotency_key VARCHAR(128),
    ADD COLUMN request_hash    CHAR(64);

CREATE UNIQUE INDEX uq_workflow_executions_idempotency
    ON workflow_executions (workflow_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
