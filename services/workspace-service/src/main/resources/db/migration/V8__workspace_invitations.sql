-- W7-A1: invite by e-mail. Acceptance is bound to the invitee's verified e-mail (no token).
CREATE TABLE workspace_invitations (
    id           UUID PRIMARY KEY,
    workspace_id UUID         NOT NULL REFERENCES workspaces (id),
    email        VARCHAR(320) NOT NULL,
    invited_by   UUID         NOT NULL,
    status       VARCHAR(16)  NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED')),
    expires_at   TIMESTAMPTZ  NOT NULL,
    last_sent_at TIMESTAMPTZ  NOT NULL,
    responded_at TIMESTAMPTZ,
    responded_by UUID,
    created_at   TIMESTAMPTZ  NOT NULL,
    updated_at   TIMESTAMPTZ  NOT NULL
);

CREATE UNIQUE INDEX workspace_invitations_one_pending
    ON workspace_invitations (workspace_id, email) WHERE status = 'PENDING';
CREATE INDEX workspace_invitations_email_pending
    ON workspace_invitations (email) WHERE status = 'PENDING';
