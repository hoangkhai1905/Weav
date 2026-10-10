-- W6-D2: soft delete. A DELETED workspace is hidden from every lookup; its owner-name may be reused.
ALTER TABLE workspaces
    ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD COLUMN deleted_by UUID,
    ADD CONSTRAINT ck_workspaces_status CHECK (status IN ('ACTIVE', 'DELETED'));

DROP INDEX ux_workspaces_owner_name_normalized;
CREATE UNIQUE INDEX ux_workspaces_owner_name_normalized
    ON workspaces (created_by, name_normalized)
    WHERE status = 'ACTIVE';
