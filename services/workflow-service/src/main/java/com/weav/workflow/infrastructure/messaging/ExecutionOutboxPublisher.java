package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import tools.jackson.databind.ObjectMapper;

/** Publishes claimed outbox messages outside database transactions and fences their completion. */
@Component
public final class ExecutionOutboxPublisher {
    private static final Logger LOGGER = LoggerFactory.getLogger(ExecutionOutboxPublisher.class);
    private static final long INITIAL_RETRY_DELAY_MILLIS = 250;

    private final OutboxEventRepository outboxEvents;
    private final WorkflowExecutionRepository executions;
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final int batchSize;
    private final Duration leaseDuration;
    private final Duration confirmTimeout;
    private final Duration maxRetryDelay;

    public ExecutionOutboxPublisher(OutboxEventRepository outboxEvents,
                                    WorkflowExecutionRepository executions,
                                    RabbitTemplate rabbitTemplate,
                                    ObjectMapper objectMapper,
                                    @Qualifier("workflowExecutionClock") Clock clock,
                                    @Value("${weav.workflow.execution-outbox.batch-size:50}") int batchSize,
                                    @Value("${weav.workflow.execution-outbox.lease-duration:PT30S}") Duration leaseDuration,
                                    @Value("${weav.workflow.execution-outbox.confirm-timeout:PT5S}") Duration confirmTimeout,
                                    @Value("${weav.workflow.execution-outbox.max-retry-delay:PT60S}") Duration maxRetryDelay) {
        this.outboxEvents = Objects.requireNonNull(outboxEvents);
        this.executions = Objects.requireNonNull(executions);
        this.rabbitTemplate = Objects.requireNonNull(rabbitTemplate);
        this.objectMapper = Objects.requireNonNull(objectMapper);
        this.clock = Objects.requireNonNull(clock);
        this.batchSize = batchSize;
        this.leaseDuration = Objects.requireNonNull(leaseDuration);
        this.confirmTimeout = Objects.requireNonNull(confirmTimeout);
        this.maxRetryDelay = Objects.requireNonNull(maxRetryDelay);
        if (batchSize < 1 || batchSize > 1_000 || leaseDuration.isNegative() || leaseDuration.isZero()
                || confirmTimeout.isNegative() || confirmTimeout.isZero()
                || maxRetryDelay.isNegative() || maxRetryDelay.isZero()) {
            throw new IllegalArgumentException("Execution outbox publisher bounds are invalid");
        }
    }

    @Scheduled(fixedDelayString = "${weav.workflow.execution-outbox.poll-interval:1000}",
            initialDelayString = "${weav.workflow.execution-outbox.initial-delay:1000}")
    public void publishPendingOnSchedule() {
        publishPending();
    }

    public int publishPending() {
        Instant claimedAt = clock.instant();
        UUID leaseToken = UUID.randomUUID();
        List<OutboxEvent> claimed = outboxEvents.claimPending(
                leaseToken, claimedAt, claimedAt.plus(leaseDuration), batchSize);
        int published = 0;
        for (OutboxEvent event : claimed) {
            if (publish(event, leaseToken, claimedAt)) {
                published++;
            }
        }
        return published;
    }

    private boolean publish(OutboxEvent event, UUID leaseToken, Instant attemptedAt) {
        try {
            WorkflowExecution execution = executions.findById(event.getAggregateId())
                    .orElseThrow(() -> new IllegalStateException("Outbox execution no longer exists"));
            byte[] body = objectMapper.writeValueAsBytes(Map.of("executionId", execution.getId().toString()));
            CorrelationData correlationData = new CorrelationData(event.getId().toString());
            rabbitTemplate.convertAndSend(RabbitExecutionConfiguration.EXECUTION_EXCHANGE,
                    RabbitExecutionConfiguration.EXECUTION_ROUTING_KEY, body, message -> {
                        var properties = message.getMessageProperties();
                        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                        properties.setContentType("application/json");
                        properties.setMessageId(execution.getId().toString());
                        if (execution.getCorrelationId() != null) {
                            properties.setCorrelationId(execution.getCorrelationId());
                            properties.setHeader(RabbitExecutionConfiguration.CORRELATION_ID_HEADER,
                                    execution.getCorrelationId());
                        }
                        if (execution.getTraceparent() != null) {
                            properties.setHeader(RabbitExecutionConfiguration.TRACEPARENT_HEADER,
                                    execution.getTraceparent());
                        }
                        return message;
                    }, correlationData);

            CorrelationData.Confirm confirm = correlationData.getFuture()
                    .get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
            if (!confirm.ack() || correlationData.getReturned() != null) {
                scheduleRetry(event, leaseToken, attemptedAt);
                return false;
            }
            return outboxEvents.markPublished(event.getId(), leaseToken, clock.instant());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            scheduleRetry(event, leaseToken, attemptedAt);
            LOGGER.warn("Execution outbox event {} will retry after an interrupted confirm wait", event.getId());
            return false;
        } catch (ExecutionException | TimeoutException | RuntimeException exception) {
            scheduleRetry(event, leaseToken, attemptedAt);
            LOGGER.warn("Execution outbox event {} will retry after a delivery failure ({})",
                    event.getId(), exception.getClass().getSimpleName());
            return false;
        } catch (Exception exception) {
            scheduleRetry(event, leaseToken, attemptedAt);
            LOGGER.warn("Execution outbox event {} will retry after a serialization failure ({})",
                    event.getId(), exception.getClass().getSimpleName());
            return false;
        }
    }

    private void scheduleRetry(OutboxEvent event, UUID leaseToken, Instant attemptedAt) {
        Duration delay = retryDelay(event.getRetryCount() == null ? 0 : event.getRetryCount());
        outboxEvents.scheduleRetry(event.getId(), leaseToken, attemptedAt, attemptedAt.plus(delay));
    }

    private Duration retryDelay(int retriesAlreadyScheduled) {
        int exponent = Math.max(0, Math.min(retriesAlreadyScheduled, 30));
        long nextMillis = INITIAL_RETRY_DELAY_MILLIS << exponent;
        long maximumMillis = maxRetryDelay.toMillis();
        return Duration.ofMillis(Math.min(nextMillis, maximumMillis));
    }
}
