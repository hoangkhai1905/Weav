-- ID-7: durable queue of replaced/orphaned avatar objects awaiting deletion from object storage.
CREATE TABLE avatar_cleanup (
    object_key VARCHAR(512) PRIMARY KEY,
    user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_error VARCHAR(200)
);
