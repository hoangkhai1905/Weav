-- ID-9: trigram indexes matching the expressions used by SpringDataUserRepository.search (LIKE '%term%').
-- Neon supports pg_trgm; the extension lives in public so the operator class is resolvable whatever the service schema is.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;

CREATE INDEX IF NOT EXISTS idx_users_email_trgm
    ON users USING gin (lower(email) public.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm
    ON users USING gin (lower(coalesce(display_name, '')) public.gin_trgm_ops);

-- ID-10: active-session lookups (per user, not revoked, ordered/filtered by expiry).
CREATE INDEX IF NOT EXISTS idx_user_sessions_active
    ON user_sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;
