CREATE TABLE workspaces (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE memberships (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    role VARCHAR(32) NOT NULL,
    can_publish_workflow BOOLEAN NOT NULL DEFAULT FALSE,
    can_manage_workflow_state BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uk_membership_workspace_user UNIQUE (workspace_id, user_id)
);

CREATE INDEX idx_memberships_workspace_id ON memberships (workspace_id);
CREATE INDEX idx_memberships_user_id ON memberships (user_id);
CREATE UNIQUE INDEX uk_memberships_one_owner_per_workspace
    ON memberships (workspace_id)
    WHERE role = 'OWNER';

CREATE TABLE connections (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    created_by UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    auth_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    config JSONB,
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_connections_workspace_id ON connections (workspace_id);

CREATE TABLE credentials (
    id UUID PRIMARY KEY,
    connection_id UUID NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
    encrypted_payload BYTEA NOT NULL,
    encryption_key_version VARCHAR(64),
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uk_credential_connection UNIQUE (connection_id)
);

CREATE INDEX idx_credentials_connection_id ON credentials (connection_id);