-- Backend review 2026-10 (P4 + G8): indexes for retention purges, FK child lookups and pollers.
-- Additive only. Plain CREATE INDEX IF NOT EXISTS: these tables are small; on a large production table
-- build the index CONCURRENTLY by hand first and this migration becomes a no-op.

-- Purge "is a parent of another run" probe and the self-FK check when a run is deleted.
CREATE INDEX IF NOT EXISTS idx_workflow_executions_parent
    ON workflow_executions (parent_execution_id)
    WHERE parent_execution_id IS NOT NULL;

-- FK workflow_executions -> workflow_versions.
CREATE INDEX IF NOT EXISTS idx_workflow_executions_version
    ON workflow_executions (workflow_version_id);

-- FK checks when node executions and attempts are purged.
CREATE INDEX IF NOT EXISTS idx_execution_logs_node_execution
    ON execution_logs (node_execution_id)
    WHERE node_execution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_execution_logs_attempt
    ON execution_logs (attempt_id)
    WHERE attempt_id IS NOT NULL;

-- Purge "undelivered notification for this run" probe.
CREATE INDEX IF NOT EXISTS idx_notification_outbox_entity
    ON notification_outbox (entity_id);

-- Execution retention scan (finished runs ordered by age).
CREATE INDEX IF NOT EXISTS idx_workflow_executions_finished_terminal
    ON workflow_executions (finished_at)
    WHERE status IN ('SUCCESS', 'FAILED', 'CANCELLED');

-- FK alert_rules -> workflows.
CREATE INDEX IF NOT EXISTS idx_alert_rules_workflow
    ON alert_rules (workflow_id)
    WHERE workflow_id IS NOT NULL;

-- Schedule scanner: due active schedules only.
CREATE INDEX IF NOT EXISTS idx_workflow_triggers_due_schedule
    ON workflow_triggers (next_run_at)
    WHERE type = 'SCHEDULE' AND status = 'ACTIVE';

-- Alert firing retention scan.
CREATE INDEX IF NOT EXISTS idx_alert_rule_firings_fired_at
    ON alert_rule_firings (fired_at);
