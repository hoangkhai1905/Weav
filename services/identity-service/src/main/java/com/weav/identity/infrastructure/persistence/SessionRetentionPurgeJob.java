package com.weav.identity.infrastructure.persistence;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.regex.Pattern;

/**
 * ID-10: hourly batched purge of sessions revoked/expired more than N days ago. Rows revoked inside the window
 * stay, so the refresh grace/reuse detection is unaffected. One node at a time via a transaction-scoped advisory lock.
 */
@Component
public class SessionRetentionPurgeJob {
    private static final Logger log = LoggerFactory.getLogger(SessionRetentionPurgeJob.class);
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final long ADVISORY_LOCK_ID = 0x5745415653455353L; // "WEAVSESS"
    private static final int BATCH_SIZE = 1_000;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final int retentionDays;
    private final String table;

    public SessionRetentionPurgeJob(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            @Value("${DB_SCHEMA:identity}") String schema,
            @Value("${weav.identity.session-retention-days:30}") int retentionDays
    ) {
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        if (retentionDays < 1) {
            throw new IllegalArgumentException("weav.identity.session-retention-days must be at least 1");
        }
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.retentionDays = retentionDays;
        this.table = '"' + schema + '"' + ".user_sessions";
    }

    @Scheduled(fixedDelayString = "${weav.identity.session-purge-interval:PT1H}",
            initialDelayString = "${weav.identity.session-purge-initial-delay:PT5M}")
    public void purgeOnSchedule() {
        purgeNow();
    }

    /** Returns the number of rows deleted; 0 if another node holds the lock. */
    public int purgeNow() {
        int total = 0;
        int deleted;
        do {
            Integer result = transaction.execute(status -> Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT pg_try_advisory_xact_lock(?)", Boolean.class, ADVISORY_LOCK_ID))
                    ? Integer.valueOf(jdbc.update("DELETE FROM " + table + " WHERE id IN ("
                            + "SELECT id FROM " + table
                            + " WHERE COALESCE(revoked_at, expires_at) < now() - (? * INTERVAL '1 day') LIMIT ?)",
                            retentionDays, BATCH_SIZE))
                    : null);
            if (result == null) {
                break;
            }
            deleted = result;
            total += deleted;
        } while (deleted >= BATCH_SIZE);
        if (total > 0) {
            log.info("identity_session_purge removed={}", total);
        }
        return total;
    }
}
