-- W6-A monitoring: alert rules, their firings (cooldown state + per-run idempotency) and the two new
-- notification event types. Additive only: nothing existing is renamed or dropped.

CREATE TABLE alert_rules (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    workflow_id UUID,
    name VARCHAR(120) NOT NULL,
    rule_type VARCHAR(32) NOT NULL,
    threshold INTEGER NOT NULL,
    window_minutes INTEGER,
    cooldown_minutes INTEGER NOT NULL DEFAULT 60,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alert_rules_workflow FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    CONSTRAINT ck_alert_rules_type CHECK (rule_type IN ('CONSECUTIVE_FAILURES', 'LONG_RUNNING')),
    CONSTRAINT ck_alert_rules_threshold CHECK (
        (rule_type = 'CONSECUTIVE_FAILURES' AND threshold BETWEEN 1 AND 20
            AND window_minutes BETWEEN 1 AND 10080)
        OR (rule_type = 'LONG_RUNNING' AND threshold BETWEEN 1 AND 86400 AND window_minutes IS NULL)),
    CONSTRAINT ck_alert_rules_cooldown CHECK (cooldown_minutes BETWEEN 0 AND 10080)
);

CREATE INDEX idx_alert_rules_workspace ON alert_rules (workspace_id, enabled);

-- One row per (rule, run) that fired: UNIQUE makes a run fire a rule at most once, and the
-- (rule, workflow, fired_at) index answers the cooldown lookup.
CREATE TABLE alert_rule_firings (
    id UUID PRIMARY KEY,
    rule_id UUID NOT NULL,
    workflow_id UUID NOT NULL,
    execution_id UUID NOT NULL,
    fired_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_alert_rule_firings_rule FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE,
    CONSTRAINT uq_alert_rule_firings_run UNIQUE (rule_id, execution_id)
);

CREATE INDEX idx_alert_rule_firings_cooldown ON alert_rule_firings (rule_id, workflow_id, fired_at DESC);

-- "Last N finished runs of a workflow" for the consecutive-failure evaluator.
CREATE INDEX idx_workflow_executions_finished
    ON workflow_executions (workflow_id, finished_at DESC)
    WHERE status IN ('SUCCESS', 'FAILED');

-- LONG_RUNNING watchdog: live runs by start time. Plain (non-concurrent) CREATE INDEX: fine at this table size; for a
-- large production table build it CONCURRENTLY by hand first.
CREATE INDEX idx_workflow_executions_active
    ON workflow_executions (started_at)
    WHERE status IN ('RUNNING', 'WAITING');

-- notification_outbox: allow the alert event types (same EXECUTION entity and monitor-access rule as workflow.failed).
ALTER TABLE notification_outbox DROP CONSTRAINT ck_notification_outbox_type;
ALTER TABLE notification_outbox ADD CONSTRAINT ck_notification_outbox_type CHECK (event_type IN (
    'workflow.created', 'workflow.published', 'workflow.paused', 'workflow.resumed',
    'workflow.completed', 'workflow.failed',
    'monitoring.alert.consecutive_failures', 'monitoring.alert.long_running'));

ALTER TABLE notification_outbox DROP CONSTRAINT ck_notification_outbox_entity;
ALTER TABLE notification_outbox ADD CONSTRAINT ck_notification_outbox_entity CHECK (
    (entity_kind = 'WORKFLOW' AND event_type IN (
        'workflow.created', 'workflow.published', 'workflow.paused', 'workflow.resumed')
        AND NOT requires_monitor_access)
    OR
    (entity_kind = 'EXECUTION' AND event_type IN (
        'workflow.completed', 'workflow.failed',
        'monitoring.alert.consecutive_failures', 'monitoring.alert.long_running')
        AND requires_monitor_access));
