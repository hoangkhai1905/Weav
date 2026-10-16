package com.weav.workspace.infrastructure.messaging.notification;

import com.weav.workspace.infrastructure.metrics.ScheduledTaskMetrics;
import com.weav.workspace.infrastructure.scheduling.IdleBackoff;
import com.weav.workspace.infrastructure.scheduling.OutboxWakeup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.regex.Pattern;

/**
 * Publishes stored payloads with confirms. P3: claim a batch in a short transaction (lease by bumping
 * next_attempt_at, SKIP LOCKED), publish while holding no connection or row lock, then settle every row in a
 * second short transaction, mirroring Identity's publisher. A crash or settle failure between publish and settle
 * only lets the lease expire and the row be re-sent (at-least-once; consumers dedupe on messageId = eventId).
 */
@Component
@ConditionalOnProperty(prefix = "weav.workspace.notification-outbox", name = "publisher-enabled",
        havingValue = "true", matchIfMissing = true)
public final class NotificationOutboxPublisher {
    private static final Logger LOGGER = LoggerFactory.getLogger(NotificationOutboxPublisher.class);
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final Duration MAX_CONFIRM_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration MAX_RETRY_DELAY = Duration.ofSeconds(60);

    private final JdbcTemplate jdbcTemplate;
    private final RabbitTemplate rabbitTemplate;
    private final TransactionTemplate transactionTemplate;
    private final String table;
    private final String exchange;
    private final int batchSize;
    private final Duration confirmTimeout;
    private final Duration maxRetryDelay;
    private final int maxAttempts;
    private final long leaseMillis;
    private volatile IdleBackoff idleBackoff;
    private volatile OutboxWakeup wakeup;
    private volatile ScheduledTaskMetrics taskMetrics;

    public NotificationOutboxPublisher(
            JdbcTemplate jdbcTemplate,
            RabbitTemplate rabbitTemplate,
            org.springframework.transaction.PlatformTransactionManager transactionManager,
            @Value("${DB_SCHEMA:workspace}") String schema,
            @Value("${NOTIFICATION_EXCHANGE:weav.events}") String exchange,
            @Value("${weav.workspace.notification-outbox.batch-size:25}") int batchSize,
            @Value("${weav.workspace.notification-outbox.confirm-timeout:PT5S}") Duration confirmTimeout,
            @Value("${weav.workspace.notification-outbox.max-retry-delay:PT60S}") Duration maxRetryDelay,
            @Value("${weav.workspace.notification-outbox.max-attempts:10}") int maxAttempts) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate);
        this.rabbitTemplate = Objects.requireNonNull(rabbitTemplate);
        this.transactionTemplate = new TransactionTemplate(Objects.requireNonNull(transactionManager));
        this.transactionTemplate.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        if (!SAFE_SCHEMA.matcher(schema).matches()) {
            throw new IllegalArgumentException("DB_SCHEMA must be a simple PostgreSQL schema identifier");
        }
        this.table = '"' + schema + '"' + ".notification_outbox";
        this.exchange = Objects.requireNonNull(exchange);
        this.batchSize = batchSize;
        this.confirmTimeout = Objects.requireNonNull(confirmTimeout);
        this.maxRetryDelay = Objects.requireNonNull(maxRetryDelay);
        this.maxAttempts = maxAttempts;
        // Claim lease: outlasts one confirm wait plus margin, so a live publisher never races its own rows.
        this.leaseMillis = confirmTimeout.toMillis() * 2 + 10_000;
        if (maxAttempts < 1 || maxAttempts > 1000) {
            throw new IllegalArgumentException("Workspace notification outbox bounds are invalid");
        }
        if (batchSize < 1 || batchSize > 250 || confirmTimeout.toMillis() < 1
                || confirmTimeout.compareTo(MAX_CONFIRM_TIMEOUT) > 0
                || maxRetryDelay.toMillis() < 1
                || maxRetryDelay.compareTo(MAX_RETRY_DELAY) > 0) {
            throw new IllegalArgumentException("Workspace notification outbox bounds are invalid");
        }
    }

    @Scheduled(fixedDelayString = "${weav.workspace.notification-outbox.poll-interval:1000}",
            initialDelayString = "${weav.workspace.notification-outbox.initial-delay:1000}")
    public void publishPendingOnSchedule() {
        IdleBackoff backoff = idleBackoff;
        if (backoff != null) {
            OutboxWakeup signal = wakeup;
            if (signal != null && signal.consume()) {
                backoff.wake();
            }
            if (!backoff.shouldPoll()) {
                return;
            }
        }
        int published = publishBatch();
        if (published >= 0) {
            recordSuccess();
        }
        if (backoff != null) {
            recordPoll(backoff, Math.max(published, 0));
        }
    }

    /** Work resets the backoff; an empty poll sleeps until the earliest pending row is due, or the aligned cap. */
    private void recordPoll(IdleBackoff backoff, int published) {
        if (published > 0) {
            backoff.record(true);
            return;
        }
        try {
            backoff.record(false, earliestPendingDue());
        } catch (RuntimeException exception) {
            // Unknown table state (e.g. database unreachable): fall back to the plain ramp.
            backoff.record(false);
        }
    }

    /**
     * Earliest due time (next_attempt_at, which doubles as the claim lease) of a row that is neither published nor
     * FAILED, or null when none is pending. One indexed MIN (idx_notification_outbox_due); the delta is taken
     * against the database clock so a skewed application clock cannot delay retries.
     */
    Instant earliestPendingDue() {
        return jdbcTemplate.query("select (extract(epoch from min(next_attempt_at) - current_timestamp) * 1000)::bigint"
                        + " from " + table + " where published_at is null and failed_at is null",
                resultSet -> {
                    if (!resultSet.next()) {
                        return null;
                    }
                    long untilDueMillis = resultSet.getLong(1);
                    return resultSet.wasNull() ? null : Instant.now().plusMillis(untilDueMillis);
                });
    }

    /** Idle backoff (scale-to-zero friendly polling); without it every tick polls, as before. */
    @Autowired
    void configureIdleBackoff(
            @Value("${weav.workspace.notification-outbox.poll-interval:1000}") long pollIntervalMillis,
            @Value("${weav.workspace.notification-outbox.idle-max-delay:PT10M}") Duration idleMaxDelay,
            OutboxWakeup outboxWakeup) {
        Duration base = Duration.ofMillis(pollIntervalMillis);
        this.idleBackoff = new IdleBackoff(base, idleMaxDelay.compareTo(base) < 0 ? base : idleMaxDelay);
        this.wakeup = outboxWakeup;
    }

    @Autowired(required = false)
    void configureTaskMetrics(ScheduledTaskMetrics metrics) {
        this.taskMetrics = metrics;
    }

    private void recordSuccess() {
        ScheduledTaskMetrics metrics = taskMetrics;
        if (metrics != null) {
            metrics.succeeded(ScheduledTaskMetrics.NOTIFICATION_OUTBOX_PUBLISHER);
        }
    }

    public int publishPending() {
        return Math.max(publishBatch(), 0);
    }

    /** One claim, publish and settle pass; returns the rows published, or -1 when the claim or settle step failed. */
    private int publishBatch() {
        List<Claimed> claimed;
        try {
            claimed = transactionTemplate.execute(status -> claimBatch());
        } catch (RuntimeException exception) {
            LOGGER.warn("Workspace notification outbox claim failed ({})", exception.getClass().getSimpleName());
            return -1;
        }
        if (claimed == null || claimed.isEmpty()) {
            return 0;
        }

        List<Settlement> settlements = publishWithConfirms(claimed);
        try {
            transactionTemplate.executeWithoutResult(status -> settlements.forEach(this::settle));
        } catch (RuntimeException exception) {
            LOGGER.warn("Workspace notification outbox settle failed; lease expiry will retry ({})",
                    exception.getClass().getSimpleName());
            return -1;
        }
        return (int) settlements.stream().filter(value -> value.failureCode() == null).count();
    }

    private List<Claimed> claimBatch() {
        List<Claimed> rows = jdbcTemplate.query("update " + table
                        + " set next_attempt_at = current_timestamp + (? * interval '1 millisecond') "
                        + "where event_id in (select event_id from " + table
                        + " where published_at is null and failed_at is null and next_attempt_at <= current_timestamp "
                        + "order by next_attempt_at, created_at, event_id for update skip locked limit ?) "
                        + "returning event_id, event_type, payload::text, attempts, created_at",
                (resultSet, rowNumber) -> new Claimed(
                        resultSet.getObject(1, UUID.class),
                        resultSet.getString(2),
                        resultSet.getString(3),
                        resultSet.getInt(4),
                        resultSet.getTimestamp(5).toInstant()),
                leaseMillis, batchSize);
        List<Claimed> ordered = new ArrayList<>(rows);
        ordered.sort(Comparator.comparing(Claimed::createdAt).thenComparing(Claimed::eventId));
        return ordered;
    }

    private List<Settlement> publishWithConfirms(List<Claimed> claimed) {
        List<Settlement> settlements = new ArrayList<>(claimed.size());
        Map<Claimed, CorrelationData> inFlight = new LinkedHashMap<>();
        for (Claimed row : claimed) {
            try {
                CorrelationData correlation = new CorrelationData(row.eventId().toString());
                MessageProperties properties = new MessageProperties();
                properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                properties.setContentType("application/json");
                properties.setMessageId(row.eventId().toString());
                Message message = new Message(row.payload().getBytes(StandardCharsets.UTF_8), properties);
                rabbitTemplate.send(exchange, row.eventType(), message, correlation);
                inFlight.put(row, correlation);
            } catch (RuntimeException exception) {
                settlements.add(new Settlement(row, "transport-failed"));
            }
        }
        long deadline = System.nanoTime() + confirmTimeout.toNanos();
        boolean interrupted = false;
        for (Map.Entry<Claimed, CorrelationData> entry : inFlight.entrySet()) {
            Claimed row = entry.getKey();
            CorrelationData correlation = entry.getValue();
            if (interrupted) {
                settlements.add(new Settlement(row, "interrupted"));
                continue;
            }
            try {
                long remaining = Math.max(0, deadline - System.nanoTime());
                CorrelationData.Confirm confirm = correlation.getFuture().get(remaining, TimeUnit.NANOSECONDS);
                if (confirm == null || !confirm.ack()) {
                    settlements.add(new Settlement(row, "nack"));
                } else if (correlation.getReturned() != null) {
                    settlements.add(new Settlement(row, "unroutable"));
                } else {
                    settlements.add(new Settlement(row, null));
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                interrupted = true;
                settlements.add(new Settlement(row, "interrupted"));
            } catch (ExecutionException | TimeoutException exception) {
                settlements.add(new Settlement(row,
                        exception instanceof TimeoutException ? "confirm-timeout" : "confirm-failed"));
            } catch (RuntimeException exception) {
                settlements.add(new Settlement(row, "transport-failed"));
            }
        }
        return settlements;
    }

    private void settle(Settlement settlement) {
        Claimed row = settlement.row();
        if (settlement.failureCode() != null) {
            scheduleRetry(row.eventId(), row.attempts(), settlement.failureCode());
            return;
        }
        jdbcTemplate.update("update " + table
                        + " set published_at = current_timestamp, last_failure_code = null "
                        + "where event_id = ? and published_at is null", row.eventId());
    }

    private record Claimed(UUID eventId, String eventType, String payload, int attempts, Instant createdAt) {
    }

    private record Settlement(Claimed row, String failureCode) {
    }

    private void scheduleRetry(UUID eventId, int attempts, String failureCode) {
        if (attempts + 1 >= maxAttempts) {
            // WS-13: terminal FAILED state; the row is kept for inspection and never retried.
            jdbcTemplate.update("update " + table
                            + " set attempts = attempts + 1, failed_at = current_timestamp, last_failure_code = ? "
                            + "where event_id = ? and published_at is null and failed_at is null",
                    failureCode, eventId);
            LOGGER.error("Workspace notification outbox event {} marked FAILED after {} attempts ({})",
                    eventId, attempts + 1, failureCode);
            return;
        }
        long exponent = Math.min(Math.max(attempts, 0), 20);
        long delayMillis = Math.min(1_000L << exponent, maxRetryDelay.toMillis());
        jdbcTemplate.update("update " + table
                        + " set attempts = attempts + 1, "
                        + "next_attempt_at = current_timestamp + (? * interval '1 millisecond'), "
                        + "last_failure_code = ? where event_id = ? and published_at is null",
                delayMillis, failureCode, eventId);
    }
}
