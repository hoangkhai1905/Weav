CREATE TABLE workflow_connection_references (
    workflow_id UUID NOT NULL,
    version_id UUID,
    connection_id UUID NOT NULL,
    CONSTRAINT fk_workflow_connection_references_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (id),
    CONSTRAINT fk_workflow_connection_references_version
        FOREIGN KEY (version_id) REFERENCES workflow_versions (id)
);

CREATE UNIQUE INDEX uq_workflow_connection_references_draft
    ON workflow_connection_references (workflow_id, connection_id)
    WHERE version_id IS NULL;

CREATE UNIQUE INDEX uq_workflow_connection_references_version
    ON workflow_connection_references (version_id, connection_id)
    WHERE version_id IS NOT NULL;

CREATE INDEX idx_workflow_connection_references_connection
    ON workflow_connection_references (connection_id, workflow_id);

-- Only the documented node config field is authoritative. Guard both JSON structure and
-- UUID syntax before casting so unfinished V1 drafts never prevent a safe upgrade.
INSERT INTO workflow_connection_references (workflow_id, version_id, connection_id)
SELECT DISTINCT w.id, NULL::UUID, extracted.connection_id
FROM workflows w
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(w.draft_definition -> 'nodes') = 'array'
            THEN w.draft_definition -> 'nodes'
        ELSE '[]'::JSONB
    END
) AS n(value)
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN jsonb_typeof(n.value) = 'object'
            AND jsonb_typeof(n.value -> 'config') = 'object'
            AND (n.value -> 'config' ->> 'connectionId') ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN (n.value -> 'config' ->> 'connectionId')::UUID
        ELSE NULL
    END AS connection_id
) AS extracted
WHERE w.deleted_at IS NULL
  AND extracted.connection_id IS NOT NULL;

-- Immutable versions remain usage references even when their parent workflow is soft-deleted.
INSERT INTO workflow_connection_references (workflow_id, version_id, connection_id)
SELECT DISTINCT v.workflow_id, v.id, extracted.connection_id
FROM workflow_versions v
JOIN workflows w ON w.id = v.workflow_id
CROSS JOIN LATERAL jsonb_array_elements(
    CASE
        WHEN jsonb_typeof(v.definition -> 'nodes') = 'array'
            THEN v.definition -> 'nodes'
        ELSE '[]'::JSONB
    END
) AS n(value)
CROSS JOIN LATERAL (
    SELECT CASE
        WHEN jsonb_typeof(n.value) = 'object'
            AND jsonb_typeof(n.value -> 'config') = 'object'
            AND (n.value -> 'config' ->> 'connectionId') ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN (n.value -> 'config' ->> 'connectionId')::UUID
        ELSE NULL
    END AS connection_id
) AS extracted
WHERE extracted.connection_id IS NOT NULL;
