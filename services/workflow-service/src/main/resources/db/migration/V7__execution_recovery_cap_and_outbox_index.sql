-- WF-9: count crash recoveries so a poison execution cannot be re-queued forever (additive).
ALTER TABLE workflow_executions
    ADD COLUMN recovery_count INT NOT NULL DEFAULT 0;

-- WF-12: serves the recovery probe in ExecutionStateAdapter.enqueueRecoverable.
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate
    ON outbox_events (aggregate_type, aggregate_id, event_type, created_at DESC);
