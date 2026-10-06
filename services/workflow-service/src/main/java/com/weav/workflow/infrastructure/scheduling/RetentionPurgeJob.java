package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.port.out.WorkflowFileStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;
import java.util.function.IntSupplier;
import java.util.regex.Pattern;

/** WF-12: hourly batched retention purges. One node purges at a time via a transaction-scoped advisory lock. */
@Component
public class RetentionPurgeJob {
    private static final Logger LOGGER = LoggerFactory.getLogger(RetentionPurgeJob.class);
    private static final Pattern SQL_IDENTIFIER = Pattern.compile("[A-Za-z_][A-Za-z0-9_]*");
    private static final long ADVISORY_LOCK_ID = 0x5745415652455450L; // "WEAVRETP"
    private static final int BATCH_SIZE = 1_000;
    private static final int FILE_BATCH_SIZE = 100;
    private static final int MAX_FILE_BATCHES = 20;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final int outboxDays;
    private final int notificationOutboxDays;
    private final int executionDays;
    private final String executions;
    private final String nodes;
    private final String attempts;
    private final String logs;
    private final String agentRuns;
    private final String agentSteps;
    private final String outbox;
    private final String notificationOutbox;
    private final String aiUsage;
    private final WorkflowFileStore fileStore;

    @Autowired
    public RetentionPurgeJob(JdbcTemplate jdbc, PlatformTransactionManager transactionManager,
                             @Value("${spring.jpa.properties.hibernate.default_schema:workflow}") String schema,
                             @Value("${weav.workflow.retention.outbox-days:7}") int outboxDays,
                             @Value("${weav.workflow.retention.notification-outbox-days:14}") int notificationOutboxDays,
                             @Value("${weav.workflow.retention.execution-days:0}") int executionDays,
                             WorkflowFileStore fileStore) {
        if (schema == null || !SQL_IDENTIFIER.matcher(schema).matches()) {
            throw new IllegalArgumentException("The configured workflow schema name is invalid");
        }
        if (outboxDays < 1 || notificationOutboxDays < 1 || executionDays < 0) {
            throw new IllegalArgumentException("Retention days must be positive (execution days may be zero to keep all)");
        }
        this.fileStore = fileStore;
        this.jdbc = jdbc;
        this.transaction = new TransactionTemplate(transactionManager);
        this.outboxDays = outboxDays;
        this.notificationOutboxDays = notificationOutboxDays;
        this.executionDays = executionDays;
        String q = "\"" + schema + "\".";
        executions = q + "workflow_executions";
        nodes = q + "node_executions";
        attempts = q + "node_execution_attempts";
        logs = q + "execution_logs";
        agentRuns = q + "agent_runs";
        agentSteps = q + "agent_steps";
        outbox = q + "outbox_events";
        notificationOutbox = q + "notification_outbox";
        aiUsage = q + "ai_usage";
    }

    /** Without a file store (tests): file purging is skipped. */
    public RetentionPurgeJob(JdbcTemplate jdbc, PlatformTransactionManager transactionManager, String schema,
                             int outboxDays, int notificationOutboxDays, int executionDays) {
        this(jdbc, transactionManager, schema, outboxDays, notificationOutboxDays, executionDays, null);
    }

    @Scheduled(fixedDelayString = "${weav.workflow.retention.purge-interval:PT1H}",
            initialDelayString = "${weav.workflow.retention.initial-delay:PT5M}")
    public void purgeOnSchedule() {
        purgeNow();
    }

    /** Runs every purge; stops quietly if another node holds the lock. */
    public void purgeNow() {
        purgeFiles();
        boolean held = inBatches("outbox_events", () -> jdbc.update("""
                DELETE FROM %1$s WHERE id IN (
                    SELECT id FROM %1$s
                    WHERE status = 'PUBLISHED' AND published_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                    LIMIT ?)
                """.formatted(outbox), outboxDays, BATCH_SIZE));
        held = held && inBatches("notification_outbox", () -> jdbc.update("""
                DELETE FROM %1$s WHERE sequence_id IN (
                    SELECT sequence_id FROM %1$s
                    WHERE status = 'PUBLISHED' AND published_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                    LIMIT ?)
                """.formatted(notificationOutbox), notificationOutboxDays, BATCH_SIZE));
        held = held && inBatches("ai_usage", () -> jdbc.update(
                "DELETE FROM %s WHERE usage_date < (now() AT TIME ZONE 'UTC')::date - 30".formatted(aiUsage)));
        if (held && executionDays > 0) {
            inBatches("workflow_executions", this::purgeExecutionBatch);
        }
    }

    /**
     * Expired workflow files: the store deletes each object and then its row, and keeps the row when the object
     * delete fails so the next run retries. Bounded per run; a batch that removes fewer rows than it fetched ends the run.
     */
    // No advisory lock: object and row deletes are idempotent, so two nodes purging at once only repeat work.
    void purgeFiles() {
        if (fileStore == null || !fileStore.configured()) {
            return;
        }
        int total = 0;
        try {
            for (int batch = 0; batch < MAX_FILE_BATCHES; batch++) {
                int removed = fileStore.purgeExpired(FILE_BATCH_SIZE);
                total += removed;
                if (removed < FILE_BATCH_SIZE) {
                    break;
                }
            }
        } catch (RuntimeException exception) {
            LOGGER.warn("Workflow file purge failed: {}", exception.getClass().getSimpleName());
        }
        if (total > 0) {
            LOGGER.info("Retention purge removed {} expired workflow files", total);
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

    private int purgeExecutionBatch() {
        // Never touch a run that still has an undelivered event or is the parent of another run.
        List<UUID> ids = jdbc.queryForList("""
                SELECT e.id FROM %1$s e
                WHERE e.status IN ('SUCCESS', 'FAILED', 'CANCELLED')
                  AND e.finished_at < CURRENT_TIMESTAMP - (? * INTERVAL '1 day')
                  AND NOT EXISTS (SELECT 1 FROM %2$s o WHERE o.aggregate_id = e.id AND o.status <> 'PUBLISHED')
                  AND NOT EXISTS (SELECT 1 FROM %3$s n WHERE n.entity_id = e.id
                                  AND n.status NOT IN ('PUBLISHED', 'SKIPPED'))
                  AND NOT EXISTS (SELECT 1 FROM %1$s c WHERE c.parent_execution_id = e.id)
                ORDER BY e.finished_at
                LIMIT ?
                """.formatted(executions, outbox, notificationOutbox), UUID.class, executionDays, BATCH_SIZE);
        if (ids.isEmpty()) {
            return 0;
        }
        String in = String.join(",", java.util.Collections.nCopies(ids.size(), "?"));
        Object[] args = ids.toArray();
        String attemptIds = "SELECT a.id FROM %s a JOIN %s n ON n.id = a.node_execution_id WHERE n.execution_id IN (%s)"
                .formatted(attempts, nodes, in);
        jdbc.update("DELETE FROM %s WHERE agent_run_id IN (SELECT r.id FROM %s r WHERE r.node_execution_attempt_id IN (%s))"
                .formatted(agentSteps, agentRuns, attemptIds), args);
        jdbc.update("DELETE FROM %s WHERE node_execution_attempt_id IN (%s)".formatted(agentRuns, attemptIds), args);
        jdbc.update("DELETE FROM %s WHERE execution_id IN (%s)".formatted(logs, in), args);
        jdbc.update("DELETE FROM %s WHERE node_execution_id IN (SELECT id FROM %s WHERE execution_id IN (%s))"
                .formatted(attempts, nodes, in), args);
        jdbc.update("DELETE FROM %s WHERE execution_id IN (%s)".formatted(nodes, in), args);
        jdbc.update("DELETE FROM %s WHERE id IN (%s)".formatted(executions, in), args);
        return ids.size();
    }
}
