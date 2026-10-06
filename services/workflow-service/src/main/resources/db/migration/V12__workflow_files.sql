-- Workflow file store metadata (email attachments, Gmail trigger files). The bytes live in R2/S3 under object_key;
-- retention deletes the object and then this row once expires_at has passed.
CREATE TABLE workflow_files (
    id           UUID        PRIMARY KEY,
    workspace_id UUID        NOT NULL,
    execution_id UUID,
    object_key   TEXT        NOT NULL UNIQUE,
    filename     TEXT        NOT NULL,
    mime_type    TEXT        NOT NULL,
    size_bytes   BIGINT      NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_workflow_files_expires_at ON workflow_files (expires_at);
CREATE INDEX idx_workflow_files_workspace_id ON workflow_files (workspace_id);
