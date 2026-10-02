package com.weav.workspace.infrastructure.scheduling;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.function.IntSupplier;
import java.util.regex.Pattern;

/**
 * WS-13: hourly batched purge of published notification outbox rows and expired idempotency keys.
 * FAILED outbox rows are never touched. One node purges at a time via a transaction-scoped advisory lock.
 */
@Component
public class WorkspaceRetentionPurgeJob {
    private static final Logger LOGGER = LoggerFactory.getLogger(WorkspaceRetentionPurgeJob.class);
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final long ADVISORY_LOCK_ID = 0x5745415657535052L; // "WEAVWSPR"
    private static final int BATCH_SIZE = 1_000;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final int outboxDays;
    private final int idempotencyDays;
    private final String outbox;
    private final String idempotency;

    public WorkspaceRetentionPurgeJob(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager,
            @Value("${DB_SCHEMA:workspace}") String schema,
            @Value("${weav.workspace.retention.outbox-days:14}") int outboxDays,
            @Value("${weav.workspace.retention.idempotency-days:7}") int idempotencyDays) {
        if (!SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        if (outboxDays < 1 || idempotencyDays < 1) {
            throw new IllegalArgumentException("Retention days must be positive");
        }
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.outboxDays = outboxDays;
        this.idempotencyDays = idempotencyDays;
        this.outbox = "\"" + schema + "\".notification_outbox";
        this.idempotency = "\"" + schema + "\".workspace_idempotency";
    }

    @Scheduled(fixedDelayString = "${weav.workspace.retention.purge-interval:PT1H}",
            initialDelayString = "${weav.workspace.retention.initial-delay:PT5M}")
    public void purgeOnSchedule() {
        purgeNow();
    }

    /** Runs every purge; stops quietly if another node holds the lock. */
    public void purgeNow() {
        boolean held = inBatches("notification_outbox", () -> jdbc.update("""
                DELETE FROM %1$s WHERE event_id IN (
                    SELECT event_id FROM %1$s
                    WHERE published_at IS NOT NULL
                      AND published_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                    LIMIT ?)
                """.formatted(outbox), outboxDays, BATCH_SIZE));
        if (held) {
            inBatches("workspace_idempotency", () -> jdbc.update("""
                    DELETE FROM %1$s WHERE (user_id, idem_key) IN (
                        SELECT user_id, idem_key FROM %1$s
                        WHERE created_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                        LIMIT ?)
                    """.formatted(idempotency), idempotencyDays, BATCH_SIZE));
        }
    }

    /** Returns false when the advisory lock was not acquired (another node is purging). */
    private boolean inBatches(String what, IntSupplier batch) {
        int total = 0;
        int deleted;
        do {
            Integer result = transaction.execute(status -> Boolean.TRUE.equals(jdbc.queryForObject(
                    "SELECT pg_try_advisory_xact_lock(?)", Boolean.class, ADVISORY_LOCK_ID))
                    ? Integer.valueOf(batch.getAsInt()) : null);
            if (result == null) {
                return false;
            }
            deleted = result;
            total += deleted;
        } while (deleted >= BATCH_SIZE);
        if (total > 0) {
            LOGGER.info("Retention purge removed {} rows from {}", total, what);
        }
        return true;
    }
}
