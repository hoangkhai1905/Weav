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

    public int publishPending() {
        int published = 0;
        for (int processed = 0; processed < batchSize; processed++) {
            try {
                Boolean didPublish = transactionTemplate.execute(status -> dispatchOne());
                if (!Boolean.TRUE.equals(didPublish)) {
                    break;
                }
                published++;
            } catch (RuntimeException exception) {
                LOGGER.warn("Identity notification outbox dispatch transaction failed ({})",
                        exception.getClass().getSimpleName());
                break;
            }
        }
        return published;
    }

    private boolean dispatchOne() {
        return jdbcTemplate.query("select event_id, event_type, payload::text, attempts from " + table
                        + " where published_at is null and next_attempt_at <= current_timestamp "
                        + "order by next_attempt_at, created_at, event_id for update skip locked limit 1",
                resultSet -> {
                    if (!resultSet.next()) {
                        return false;
                    }
                    UUID eventId = resultSet.getObject(1, UUID.class);
                    String eventType = resultSet.getString(2);
                    String payload = resultSet.getString(3);
                    int attempts = resultSet.getInt(4);
                    return publishLocked(eventId, eventType, payload, attempts);
                });
    }

    private boolean publishLocked(UUID eventId, String eventType, String payload, int attempts) {
        try {
            CorrelationData correlation = new CorrelationData(eventId.toString());
            MessageProperties properties = new MessageProperties();
            properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
            properties.setContentType("application/json");
            properties.setMessageId(eventId.toString());
            Message message = new Message(payload.getBytes(StandardCharsets.UTF_8), properties);
            rabbitTemplate.send(exchange, eventType, message, correlation);
            CorrelationData.Confirm confirm = correlation.getFuture()
                    .get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
            if (confirm == null || !confirm.ack()) {
                scheduleRetry(eventId, attempts, "nack");
                return false;
            }
            if (correlation.getReturned() != null) {
                scheduleRetry(eventId, attempts, "unroutable");
                return false;
            }
            int updated = jdbcTemplate.update("update " + table
                            + " set published_at = current_timestamp, last_failure_code = null "
                            + "where event_id = ? and published_at is null", eventId);
            if (updated != 1) {
                throw new IllegalStateException("Identity outbox row was not marked published");
            }
            return true;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            scheduleRetry(eventId, attempts, "interrupted");
            return false;
        } catch (ExecutionException | TimeoutException exception) {
            scheduleRetry(eventId, attempts,
                    exception instanceof TimeoutException ? "confirm-timeout" : "confirm-failed");
            return false;
        } catch (RuntimeException exception) {
            scheduleRetry(eventId, attempts, "transport-failed");
            return false;
        }
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
