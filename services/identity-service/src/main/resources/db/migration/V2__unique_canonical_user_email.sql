CREATE UNIQUE INDEX uk_users_canonical_email ON users (lower(btrim(email)));
