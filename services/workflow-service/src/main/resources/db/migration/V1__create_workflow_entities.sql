CREATE TABLE workflows (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(32) NOT NULL,
    schema_version VARCHAR(32) NOT NULL,
    draft_definition JSONB NOT NULL,
    editor_state JSONB,
    current_version_id UUID,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    deleted_by UUID
);

CREATE TABLE workflow_versions (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL,
    version_number INTEGER NOT NULL,
    definition JSONB NOT NULL,
    schema_version VARCHAR(32) NOT NULL,
    published_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workflow_versions_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    CONSTRAINT uk_workflow_versions_number
        UNIQUE (workflow_id, version_number)
);

ALTER TABLE workflows
    ADD CONSTRAINT fk_workflows_current_version
    FOREIGN KEY (current_version_id) REFERENCES workflow_versions(id)
    ON DELETE SET NULL;

CREATE TABLE workflow_triggers (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL,
    workflow_version_id UUID NOT NULL,
    trigger_node_id VARCHAR(255) NOT NULL,
    type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    config JSONB,
    endpoint_key VARCHAR(255),
    secret_hash VARCHAR(255),
    next_run_at TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    last_error JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workflow_triggers_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    CONSTRAINT fk_workflow_triggers_version
        FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id),
    CONSTRAINT uk_workflow_trigger_node
        UNIQUE (workflow_version_id, trigger_node_id)
);

CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY,
    workflow_id UUID NOT NULL,
    workflow_version_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL,
    trigger_type VARCHAR(32) NOT NULL,
    trigger_id UUID,
    triggered_by UUID,
    input JSONB,
    output JSONB,
    error JSONB,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    parent_execution_id UUID,
    CONSTRAINT fk_workflow_executions_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows(id),
    CONSTRAINT fk_workflow_executions_version
        FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions(id),
    CONSTRAINT fk_workflow_executions_trigger
        FOREIGN KEY (trigger_id) REFERENCES workflow_triggers(id),
    CONSTRAINT fk_workflow_executions_parent
        FOREIGN KEY (parent_execution_id) REFERENCES workflow_executions(id)
);

CREATE TABLE node_executions (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL,
    node_id VARCHAR(255) NOT NULL,
    node_type VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    input JSONB,
    output JSONB,
    error JSONB,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_node_executions_execution
        FOREIGN KEY (execution_id) REFERENCES workflow_executions(id),
    CONSTRAINT uk_node_executions_node
        UNIQUE (execution_id, node_id)
);

CREATE TABLE node_execution_attempts (
    id UUID PRIMARY KEY,
    node_execution_id UUID NOT NULL,
    attempt_number INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL,
    input JSONB,
    output JSONB,
    error JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_node_attempts_node_execution
        FOREIGN KEY (node_execution_id) REFERENCES node_executions(id),
    CONSTRAINT uk_node_attempts_number
        UNIQUE (node_execution_id, attempt_number)
);

CREATE TABLE execution_logs (
    id UUID PRIMARY KEY,
    execution_id UUID NOT NULL,
    node_execution_id UUID,
    attempt_id UUID,
    level VARCHAR(16) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_execution_logs_execution
        FOREIGN KEY (execution_id) REFERENCES workflow_executions(id),
    CONSTRAINT fk_execution_logs_node
        FOREIGN KEY (node_execution_id) REFERENCES node_executions(id),
    CONSTRAINT fk_execution_logs_attempt
        FOREIGN KEY (attempt_id) REFERENCES node_execution_attempts(id)
);

CREATE TABLE files (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL,
    storage_key VARCHAR(1024) NOT NULL,
    file_name VARCHAR(255),
    mime_type VARCHAR(255),
    size_bytes BIGINT,
    created_by UUID,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ
);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(128) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE agent_runs (
    id UUID PRIMARY KEY,
    node_execution_attempt_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL,
    resolved_goal TEXT NOT NULL,
    allowed_tools JSONB NOT NULL,
    state JSONB NOT NULL DEFAULT '{}'::jsonb,
    step_count INTEGER NOT NULL DEFAULT 0,
    max_steps INTEGER NOT NULL,
    final_output JSONB,
    error JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_runs_attempt
        FOREIGN KEY (node_execution_attempt_id) REFERENCES node_execution_attempts(id),
    CONSTRAINT uk_agent_runs_attempt
        UNIQUE (node_execution_attempt_id)
);

CREATE TABLE agent_steps (
    id UUID PRIMARY KEY,
    agent_run_id UUID NOT NULL,
    step_number INTEGER NOT NULL,
    decision_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    tool_name VARCHAR(255),
    tool_arguments JSONB,
    tool_result JSONB,
    provider VARCHAR(128),
    model VARCHAR(128),
    usage JSONB,
    error JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_agent_steps_run
        FOREIGN KEY (agent_run_id) REFERENCES agent_runs(id),
    CONSTRAINT uk_agent_steps_number
        UNIQUE (agent_run_id, step_number)
);

CREATE INDEX idx_workflows_workspace ON workflows (workspace_id);
CREATE INDEX idx_workflows_workspace_active ON workflows (workspace_id, deleted_at);
CREATE INDEX idx_workflow_versions_workflow ON workflow_versions (workflow_id);
CREATE INDEX idx_workflow_triggers_status_type ON workflow_triggers (status, type);
CREATE INDEX idx_workflow_triggers_next_run ON workflow_triggers (next_run_at);
CREATE INDEX idx_workflow_triggers_endpoint ON workflow_triggers (endpoint_key);
CREATE INDEX idx_workflow_executions_workflow_created ON workflow_executions (workflow_id, created_at);
CREATE INDEX idx_workflow_executions_status ON workflow_executions (status);
CREATE INDEX idx_node_executions_execution ON node_executions (execution_id);
CREATE INDEX idx_node_attempts_node_execution ON node_execution_attempts (node_execution_id);
CREATE INDEX idx_execution_logs_execution_created ON execution_logs (execution_id, created_at);
CREATE INDEX idx_files_workspace ON files (workspace_id);
CREATE INDEX idx_files_expires ON files (expires_at);
CREATE INDEX idx_outbox_status_created ON outbox_events (status, created_at);
CREATE INDEX idx_agent_runs_status ON agent_runs (status);
CREATE INDEX idx_agent_steps_tool_name ON agent_steps (tool_name);