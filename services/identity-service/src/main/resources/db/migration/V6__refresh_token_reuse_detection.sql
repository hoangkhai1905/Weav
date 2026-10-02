-- ID-1: keep the previous refresh token hash so a retried (lost-response) refresh is
-- accepted inside a short grace window and a later replay is detected as reuse.
ALTER TABLE user_sessions
    ADD COLUMN previous_refresh_token_hash VARCHAR(255),
    ADD COLUMN rotated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX ux_user_sessions_previous_refresh_token_hash
    ON user_sessions (previous_refresh_token_hash)
    WHERE previous_refresh_token_hash IS NOT NULL;
