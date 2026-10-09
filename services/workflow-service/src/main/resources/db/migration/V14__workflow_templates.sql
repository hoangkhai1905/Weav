-- W6-C shared templates: a sanitized snapshot of a workflow that others can copy into their workspace.
-- Additive only: nothing existing is renamed or dropped.

CREATE TABLE workflow_templates (
    id                 UUID PRIMARY KEY,
    owner_id           UUID NOT NULL,
    workspace_id       UUID NOT NULL,
    source_workflow_id UUID,
    name               VARCHAR(255) NOT NULL,
    description        VARCHAR(2000),
    author_name        VARCHAR(120),
    definition         JSONB NOT NULL,
    editor_state       JSONB,
    node_types         TEXT[] NOT NULL,
    visibility         VARCHAR(16) NOT NULL CHECK (visibility IN ('PRIVATE','UNLISTED','PUBLIC')),
    share_code         VARCHAR(8) NOT NULL UNIQUE,
    usage_count        INTEGER NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at         TIMESTAMPTZ
);

CREATE UNIQUE INDEX uk_workflow_templates_source ON workflow_templates (source_workflow_id)
    WHERE deleted_at IS NULL AND source_workflow_id IS NOT NULL;
CREATE INDEX ix_workflow_templates_public ON workflow_templates (usage_count DESC, created_at DESC)
    WHERE visibility = 'PUBLIC' AND deleted_at IS NULL;
CREATE INDEX ix_workflow_templates_workspace ON workflow_templates (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_workflow_templates_owner ON workflow_templates (owner_id) WHERE deleted_at IS NULL;
