package com.weav.identity.infrastructure.persistence;

import com.weav.identity.infrastructure.metrics.ScheduledTaskMetrics;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.regex.Pattern;

/**
 * G4: hourly batched purge of notification outbox rows published more than N days ago. Unpublished rows are never
 * touched. One node at a time via a transaction-scoped advisory lock (same pattern as the workspace purge).
 */
@Component
public class NotificationOutboxRetentionPurgeJob {
    private static final Logger log = LoggerFactory.getLogger(NotificationOutboxRetentionPurgeJob.class);
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final long ADVISORY_LOCK_ID = 0x5745415649444F42L; // "WEAVIDOB"
    private static final int BATCH_SIZE = 1_000;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final int retentionDays;
    private final String table;
    private volatile ScheduledTaskMetrics taskMetrics;

    public NotificationOutboxRetentionPurgeJob(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            @Value("${DB_SCHEMA:identity}") String schema,
            @Value("${weav.identity.notification-outbox.retention-days:14}") int retentionDays
    ) {
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        if (retentionDays < 1) {
            throw new IllegalArgumentException("weav.identity.notification-outbox.retention-days must be at least 1");
        }
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.retentionDays = retentionDays;
        this.table = '"' + schema + '"' + ".notification_outbox";
    }

    @Scheduled(fixedDelayString = "${weav.identity.notification-outbox.purge-interval:PT1H}",
            initialDelayString = "${weav.identity.notification-outbox.purge-initial-delay:PT5M}")
    public void purgeOnSchedule() {
        try {
            purgeNow();
            ScheduledTaskMetrics metrics = taskMetrics;
            if (metrics != null) {
                metrics.succeeded(ScheduledTaskMetrics.NOTIFICATION_OUTBOX_PURGE);
            }
        } catch (RuntimeException exception) {
            log.warn("identity_outbox_purge_failed cause={}", exception.getClass().getSimpleName());
        }
    }

    @Autowired(required = false)
    public void configureTaskMetrics(ScheduledTaskMetrics metrics) {
        this.taskMetrics = metrics;
    }

    /** Returns the number of rows deleted; stops early if another node holds the lock. */
    public int purgeNow() {
        int total = 0;
        int deleted;
        do {
            Integer result = transaction.execute(status -> Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT pg_try_advisory_xact_lock(?)", Boolean.class, ADVISORY_LOCK_ID))
                    ? Integer.valueOf(jdbc.update("DELETE FROM " + table + " WHERE event_id IN ("
                            + "SELECT event_id FROM " + table
                            + " WHERE published_at IS NOT NULL"
                            + " AND published_at < now() - (? * INTERVAL '1 day') LIMIT ?)",
                            retentionDays, BATCH_SIZE))
                    : null);
            if (result == null) {
                break;
            }
            deleted = result;
            total += deleted;
        } while (deleted >= BATCH_SIZE);
        if (total > 0) {
            log.info("identity_outbox_purge removed={}", total);
        }
        return total;
    }
}
