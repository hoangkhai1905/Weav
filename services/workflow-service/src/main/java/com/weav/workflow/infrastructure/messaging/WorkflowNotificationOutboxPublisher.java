package com.weav.workflow.infrastructure.messaging;

import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxStore.ClaimedEvent;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/** Rechecks terminal-recipient access and publishes durable events without holding database locks. */
@Component
@ConditionalOnProperty(name = "weav.workflow.notification-outbox.publisher-enabled", havingValue = "true",
        matchIfMissing = true)
public final class WorkflowNotificationOutboxPublisher {
    private static final Logger LOGGER = LoggerFactory.getLogger(WorkflowNotificationOutboxPublisher.class);
    private static final long INITIAL_RETRY_DELAY_MILLIS = 250;

    private final WorkflowNotificationOutboxStore outbox;
    private final WorkspaceAccessPort workspaceAccess;
    private final RabbitTemplate rabbitTemplate;
    private final Clock clock;
    private final int batchSize;
    private final Duration leaseDuration;
    private final Duration confirmTimeout;
    private final Duration maxRetryDelay;
    private final String exchange;

    public WorkflowNotificationOutboxPublisher(
            WorkflowNotificationOutboxStore outbox,
            WorkspaceAccessPort workspaceAccess,
            @Qualifier("workflowNotificationRabbitTemplate") RabbitTemplate rabbitTemplate,
            @Qualifier("workflowExecutionClock") Clock clock,
            @Value("${weav.workflow.notification-outbox.batch-size:25}") int batchSize,
            @Value("${weav.workflow.notification-outbox.lease-duration:30s}") Duration leaseDuration,
            @Value("${weav.workflow.notification-outbox.confirm-timeout:5s}") Duration confirmTimeout,
            @Value("${weav.workflow.notification-outbox.max-retry-delay:60s}") Duration maxRetryDelay,
            @Value("${weav.workflow.notification-outbox.exchange:weav.events}") String exchange) {
        this.outbox = Objects.requireNonNull(outbox, "outbox must not be null");
        this.workspaceAccess = Objects.requireNonNull(workspaceAccess, "workspaceAccess must not be null");
        this.rabbitTemplate = Objects.requireNonNull(rabbitTemplate, "rabbitTemplate must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.batchSize = batchSize;
        this.leaseDuration = requirePositiveBounded(leaseDuration, "lease duration", Duration.ofMinutes(5));
        this.confirmTimeout = requirePositiveBounded(confirmTimeout, "confirm timeout", Duration.ofMinutes(1));
        this.maxRetryDelay = requirePositiveBounded(maxRetryDelay, "maximum retry delay", Duration.ofHours(1));
        if (batchSize < 1 || batchSize > 1_000 || exchange == null || exchange.isBlank()
                || exchange.length() > 255) {
            throw new IllegalArgumentException("Workflow notification publisher bounds are invalid");
        }
        this.exchange = exchange;
    }

    @Scheduled(fixedDelayString = "${weav.workflow.notification-outbox.poll-interval:1000}",
            initialDelayString = "${weav.workflow.notification-outbox.initial-delay:1000}")
    public void publishPendingOnSchedule() {
        try {
            publishPending();
        } catch (RuntimeException exception) {
            LOGGER.warn("Workflow notification outbox poll failed ({})", exception.getClass().getSimpleName());
        }
    }

    public int publishPending() {
        List<ClaimedEvent> events = outbox.claim(batchSize, leaseDuration);
        int published = 0;
        for (ClaimedEvent event : events) {
            if (publish(event)) {
                published++;
            }
        }
        return published;
    }

    private boolean publish(ClaimedEvent event) {
        if (event.requiresMonitorAccess()) {
            String accessResult = checkAccess(event);
            if (accessResult != null) {
                if ("ACCESS_DENIED".equals(accessResult) || "MISSING_WORKFLOW_MONITOR".equals(accessResult)) {
                    outbox.markSkipped(event.eventId(), event.claimToken(), accessResult, clock.instant());
                } else {
                    retry(event, accessResult);
                }
                return false;
            }
        }

        if (!outbox.renewClaim(event.eventId(), event.claimToken(), leaseDuration)) {
            return false;
        }
        CorrelationData correlation = new CorrelationData(event.eventId().toString());
        try {
            byte[] body = event.payload().getBytes(StandardCharsets.UTF_8);
            rabbitTemplate.convertAndSend(exchange, event.eventType(), body, message -> {
                var properties = message.getMessageProperties();
                properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                properties.setContentType("application/json");
                properties.setMessageId(event.eventId().toString());
                return message;
            }, correlation);
            CorrelationData.Confirm confirm = correlation.getFuture()
                    .get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
            if (correlation.getReturned() != null) {
                retry(event, "UNROUTABLE");
                return false;
            }
            if (!confirm.ack()) {
                retry(event, "BROKER_NACK");
                return false;
            }
            boolean marked = outbox.markPublished(event.eventId(), event.claimToken(), clock.instant());
            return marked;
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            retry(event, "PUBLISH_INTERRUPTED");
            return false;
        } catch (TimeoutException exception) {
            retry(event, "PUBLISH_CONFIRM_TIMEOUT");
            return false;
        } catch (ExecutionException | RuntimeException exception) {
            retry(event, "BROKER_UNAVAILABLE");
            LOGGER.warn("Workflow notification {} will retry after broker failure ({})",
                    event.eventId(), exception.getClass().getSimpleName());
            return false;
        }
    }

    /** Returns null only for an identity-matched current grant; denial is distinct from invalid/outage. */
    private String checkAccess(ClaimedEvent event) {
        if (event.candidateUserId() == null) {
            return "ACCESS_INVALID";
        }
        try {
            WorkspaceAccessPort.Access access = workspaceAccess.getAccess(event.workspaceId(), event.candidateUserId());
            if (access == null || !event.workspaceId().equals(access.workspaceId())
                    || !event.candidateUserId().equals(access.userId())) {
                return "ACCESS_INVALID";
            }
            return access.capabilities().contains("WORKFLOW_MONITOR") ? null : "MISSING_WORKFLOW_MONITOR";
        } catch (ForbiddenException exception) {
            return "ACCESS_DENIED";
        } catch (WorkspaceDependencyUnavailableException exception) {
            return "ACCESS_UNAVAILABLE";
        } catch (RuntimeException exception) {
            return "ACCESS_INVALID";
        }
    }

    private void retry(ClaimedEvent event, String reasonCode) {
        Instant now = clock.instant();
        Duration delay = retryDelay(event.retryCount());
        outbox.scheduleRetry(event.eventId(), event.claimToken(), reasonCode, now.plus(delay), now);
    }

    private Duration retryDelay(int retriesAlreadyScheduled) {
        int exponent = Math.max(0, Math.min(retriesAlreadyScheduled, 30));
        long nextMillis = INITIAL_RETRY_DELAY_MILLIS << exponent;
        return Duration.ofMillis(Math.min(nextMillis, maxRetryDelay.toMillis()));
    }

    private static Duration requirePositiveBounded(Duration value, String name, Duration maximum) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isNegative() || value.isZero() || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException("Workflow notification " + name + " is out of bounds");
        }
        return value;
    }
}
