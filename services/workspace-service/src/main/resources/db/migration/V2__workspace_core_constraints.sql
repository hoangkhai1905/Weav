ALTER TABLE workspaces
    ADD COLUMN name_normalized VARCHAR(255);

UPDATE workspaces
SET name_normalized = lower(btrim(name));

ALTER TABLE workspaces
    ALTER COLUMN name_normalized SET NOT NULL;

CREATE UNIQUE INDEX ux_workspaces_owner_name_normalized
    ON workspaces (created_by, name_normalized);
