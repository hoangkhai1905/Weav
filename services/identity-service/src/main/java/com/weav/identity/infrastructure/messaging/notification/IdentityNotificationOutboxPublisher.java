package com.weav.identity.infrastructure.messaging.notification;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
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

/** Publishes immutable Identity outbox rows after Rabbit confirms routing. */
@Component
@ConditionalOnProperty(prefix = "weav.identity.notification-outbox", name = "publisher-enabled",
        havingValue = "true", matchIfMissing = true)
public final class IdentityNotificationOutboxPublisher {
    private static final Logger LOGGER = LoggerFactory.getLogger(IdentityNotificationOutboxPublisher.class);
    private static final Pattern SAFE_SCHEMA = Pattern.compile("[A-Za-z_][A-Za-z0-9_]{0,62}");
    private static final Duration MAX_CONFIRM_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration MAX_RETRY_DELAY = Duration.ofSeconds(60);
    private static final long MIN_POLL_INTERVAL_MILLIS = 50;
    private static final long MAX_POLL_INTERVAL_MILLIS = 60_000;
    private static final long MAX_INITIAL_DELAY_MILLIS = 60_000;

    private final JdbcTemplate jdbcTemplate;
    private final RabbitTemplate rabbitTemplate;
    private final TransactionTemplate transactionTemplate;
    private final String table;
    private final String exchange;
    private final int batchSize;
    private final Duration confirmTimeout;
    private final Duration maxRetryDelay;
    private final long leaseMillis;

    public IdentityNotificationOutboxPublisher(
            JdbcTemplate jdbcTemplate,
            RabbitTemplate rabbitTemplate,
            PlatformTransactionManager transactionManager,
            @Value("${DB_SCHEMA:identity}") String schema,
            @Value("${NOTIFICATION_EXCHANGE:weav.events}") String exchange,
            @Value("${weav.identity.notification-outbox.batch-size:25}") int batchSize,
            @Value("${weav.identity.notification-outbox.confirm-timeout:PT5S}") Duration confirmTimeout,
            @Value("${weav.identity.notification-outbox.max-retry-delay:PT60S}") Duration maxRetryDelay,
            @Value("${weav.identity.notification-outbox.poll-interval:1000}") long pollIntervalMillis,
            @Value("${weav.identity.notification-outbox.initial-delay:1000}") long initialDelayMillis) {
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
        // Claim lease: outlasts one confirm wait plus margin, so a live publisher never races its own rows.
        this.leaseMillis = confirmTimeout.toMillis() * 2 + 10_000;
        if (batchSize < 1 || batchSize > 250
                || confirmTimeout.toMillis() < 1
                || confirmTimeout.compareTo(MAX_CONFIRM_TIMEOUT) > 0
                || maxRetryDelay.toMillis() < 1
                || maxRetryDelay.compareTo(MAX_RETRY_DELAY) > 0
                || pollIntervalMillis < MIN_POLL_INTERVAL_MILLIS
                || pollIntervalMillis > MAX_POLL_INTERVAL_MILLIS
                || initialDelayMillis < 0
                || initialDelayMillis > MAX_INITIAL_DELAY_MILLIS) {
            throw new IllegalArgumentException("Identity notification outbox bounds are invalid");
        }
    }

    @Scheduled(fixedDelayString = "${weav.identity.notification-outbox.poll-interval:1000}",
            initialDelayString = "${weav.identity.notification-outbox.initial-delay:1000}")
    public void publishPendingOnSchedule() {
        publishPending();
    }

    /**
     * ID-4: claim a batch in a short transaction (lease by bumping next_attempt_at, SKIP LOCKED for
     * multi-instance safety), publish with confirms while holding no connection or row lock, then settle
     * every row in a second short transaction. A crash between publish and settle only lets the lease
     * expire and the row be re-sent (at-least-once; consumers dedupe on messageId = eventId).
     */
    public int publishPending() {
        List<Claimed> claimed;
        try {
            claimed = transactionTemplate.execute(status -> claimBatch());
        } catch (RuntimeException exception) {
            LOGGER.warn("Identity notification outbox claim failed ({})", exception.getClass().getSimpleName());
            return 0;
        }
        if (claimed == null || claimed.isEmpty()) {
            return 0;
        }

        List<Settlement> settlements = publishWithConfirms(claimed);
        try {
            transactionTemplate.executeWithoutResult(status -> settlements.forEach(this::settle));
        } catch (RuntimeException exception) {
            LOGGER.warn("Identity notification outbox settle failed; lease expiry will retry ({})",
                    exception.getClass().getSimpleName());
            return 0;
        }
        return (int) settlements.stream().filter(value -> value.failureCode() == null).count();
    }

    private List<Claimed> claimBatch() {
        List<Claimed> rows = jdbcTemplate.query("update " + table
                        + " set next_attempt_at = current_timestamp + (? * interval '1 millisecond') "
                        + "where event_id in (select event_id from " + table
                        + " where published_at is null and next_attempt_at <= current_timestamp "
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
        long exponent = Math.min(Math.max(attempts, 0), 20);
        long delayMillis = Math.min(1_000L << exponent, maxRetryDelay.toMillis());
        jdbcTemplate.update("update " + table
                        + " set attempts = attempts + 1, "
                        + "next_attempt_at = current_timestamp + (? * interval '1 millisecond'), "
                        + "last_failure_code = ? where event_id = ? and published_at is null",
                delayMillis, failureCode, eventId);
    }
}
