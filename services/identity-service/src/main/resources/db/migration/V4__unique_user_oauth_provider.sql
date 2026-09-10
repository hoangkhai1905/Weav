DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM oauth_accounts
        GROUP BY user_id, provider
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot add uk_oauth_account_user_provider: duplicate user/provider rows exist';
    END IF;

    ALTER TABLE oauth_accounts
        ADD CONSTRAINT uk_oauth_account_user_provider UNIQUE (user_id, provider);
END $$;
