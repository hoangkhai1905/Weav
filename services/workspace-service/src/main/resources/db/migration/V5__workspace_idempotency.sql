CREATE TABLE workspace_idempotency (
    user_id UUID NOT NULL,
    idem_key VARCHAR(128) NOT NULL,
    workspace_id UUID NOT NULL
        REFERENCES workspaces (id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    request_hash CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, idem_key)
);

CREATE INDEX idx_workspace_idempotency_created ON workspace_idempotency (created_at);
