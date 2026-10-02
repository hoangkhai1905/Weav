package com.weav.workflow.infrastructure.messaging;

import com.rabbitmq.client.Channel;
import com.weav.workflow.application.port.in.ExecutionRunner;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageDeliveryMode;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import jakarta.annotation.PreDestroy;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** UUID-only broker ingress. The worker is enabled only with a concrete runner. */
@Component
@ConditionalOnProperty(name = "weav.workflow.execution.worker.enabled", havingValue = "true")
public class ExecutionJobListener {
    private static final Logger LOGGER = LoggerFactory.getLogger(ExecutionJobListener.class);

    private final ExecutionStatePort executions;
    private final ExecutionRunner runner;
    private final RabbitTemplate rabbitTemplate;
    private final ObjectMapper objectMapper;
    private final String owner;
    private final Duration leaseDuration;
    private final Duration confirmTimeout;
    private final int maxTransientRedeliveries;
    private final AtomicBoolean accepting = new AtomicBoolean(true);

    public ExecutionJobListener(ExecutionStatePort executions, ExecutionRunner runner,
                                RabbitTemplate rabbitTemplate, ObjectMapper objectMapper,
                                @Value("${weav.workflow.execution.worker.owner:${HOSTNAME:workflow-worker}}") String owner,
                                @Value("${weav.workflow.execution.worker.lease-duration:PT60S}") Duration leaseDuration,
                                @Value("${weav.workflow.execution.worker.confirm-timeout:PT5S}") Duration confirmTimeout,
                                @Value("${weav.workflow.execution.worker.max-transient-redeliveries:3}")
                                int maxTransientRedeliveries) {
        this.executions = Objects.requireNonNull(executions, "executions must not be null");
        this.runner = Objects.requireNonNull(runner, "runner must not be null");
        this.rabbitTemplate = Objects.requireNonNull(rabbitTemplate, "rabbitTemplate must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        if (!StringUtils.hasText(owner) || owner.length() > 128) {
            throw new IllegalArgumentException("Worker owner must be nonblank and at most 128 characters");
        }
        this.owner = owner;
        this.leaseDuration = requirePositiveBounded(leaseDuration, "lease duration", Duration.ofHours(24));
        this.confirmTimeout = requirePositiveBounded(confirmTimeout, "publisher confirm timeout", Duration.ofMinutes(1));
        if (maxTransientRedeliveries < 0 || maxTransientRedeliveries > 10) {
            throw new IllegalArgumentException("Transient redeliveries must be between zero and ten");
        }
        this.maxTransientRedeliveries = maxTransientRedeliveries;
    }

    @RabbitListener(queues = RabbitExecutionConfiguration.EXECUTION_QUEUE,
            containerFactory = ExecutionWorkerRabbitConfiguration.LISTENER_CONTAINER_FACTORY)
    public void onMessage(Message message, Channel channel) throws IOException {
        long deliveryTag = message.getMessageProperties().getDeliveryTag();
        if (!accepting.get()) {
            channel.basicNack(deliveryTag, false, true);
            return;
        }

        UUID executionId = executionId(message);
        if (executionId == null) {
            channel.basicReject(deliveryTag, false);
            return;
        }

        try {
            var lease = executions.claim(executionId, owner, leaseDuration);
            if (lease.isEmpty()) {
                // Terminal duplicates and already-owned duplicates are safe because DB recovery scans are mandatory.
                channel.basicAck(deliveryTag, false);
                return;
            }
            runner.run(lease.get());
            channel.basicAck(deliveryTag, false);
        } catch (TransientDataAccessException | DataAccessResourceFailureException exception) {
            deferTransientDelivery(message, executionId, deliveryTag, channel, exception);
        } catch (RuntimeException exception) {
            LOGGER.warn("Execution {} failed at the worker handoff boundary ({})",
                    executionId, exception.getClass().getSimpleName());
            channel.basicReject(deliveryTag, false);
        }
    }

    @PreDestroy
    public void stopAdmission() {
        accepting.set(false);
    }

    private void deferTransientDelivery(Message original, UUID executionId, long deliveryTag, Channel channel,
                                        RuntimeException failure) throws IOException {
        int redeliveries = redeliveryCount(original.getMessageProperties());
        if (redeliveries < 0 || redeliveries >= maxTransientRedeliveries) {
            channel.basicReject(deliveryTag, false);
            LOGGER.warn("Execution {} reached the bounded database redelivery limit ({})",
                    executionId, failure.getClass().getSimpleName());
            return;
        }

        Message delayed = delayedMessage(original, executionId, redeliveries + 1);
        CorrelationData correlation = new CorrelationData(UUID.randomUUID().toString());
        try {
            rabbitTemplate.send(RabbitExecutionConfiguration.EXECUTION_EXCHANGE,
                    ExecutionWorkerRabbitConfiguration.RETRY_ROUTING_KEY, delayed, correlation);
            CorrelationData.Confirm confirm = correlation.getFuture()
                    .get(confirmTimeout.toMillis(), TimeUnit.MILLISECONDS);
            if (confirm.ack() && correlation.getReturned() == null) {
                channel.basicAck(deliveryTag, false);
                LOGGER.warn("Execution {} was deferred after a transient database failure ({})",
                        executionId, failure.getClass().getSimpleName());
                return;
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        } catch (ExecutionException | TimeoutException | RuntimeException exception) {
            LOGGER.warn("Execution {} could not be routed to delayed database redelivery ({})",
                    executionId, exception.getClass().getSimpleName());
        }
        // Scanner recovery remains authoritative if the broker is unavailable or the retry route is missing.
        channel.basicReject(deliveryTag, false);
    }

    private Message delayedMessage(Message original, UUID executionId, int redeliveryCount) {
        MessageProperties properties = new MessageProperties();
        properties.setContentType("application/json");
        properties.setDeliveryMode(MessageDeliveryMode.PERSISTENT);
        properties.setMessageId(executionId.toString());
        if (original.getMessageProperties().getCorrelationId() != null) {
            properties.setCorrelationId(original.getMessageProperties().getCorrelationId());
        }
        copyHeader(original.getMessageProperties(), properties, RabbitExecutionConfiguration.CORRELATION_ID_HEADER);
        copyHeader(original.getMessageProperties(), properties, RabbitExecutionConfiguration.TRACEPARENT_HEADER);
        properties.setHeader(ExecutionWorkerRabbitConfiguration.REDELIVERY_COUNT_HEADER, redeliveryCount);
        try {
            return new Message(objectMapper.writeValueAsBytes(Map.of("executionId", executionId.toString())),
                    properties);
        } catch (Exception exception) {
            throw new IllegalStateException("Execution retry envelope could not be serialized safely");
        }
    }

    private UUID executionId(Message message) {
        try {
            JsonNode envelope = objectMapper.readTree(message.getBody());
            if (envelope == null || !envelope.isObject() || envelope.size() != 1) {
                return null;
            }
            JsonNode id = envelope.get("executionId");
            if (id == null || !id.isString()) {
                return null;
            }
            String raw = id.stringValue();
            UUID parsed = UUID.fromString(raw);
            return parsed.toString().equalsIgnoreCase(raw) ? parsed : null;
        } catch (Exception exception) {
            return null;
        }
    }

    private static int redeliveryCount(MessageProperties properties) {
        Object value = properties.getHeaders().get(ExecutionWorkerRabbitConfiguration.REDELIVERY_COUNT_HEADER);
        if (value == null) {
            return 0;
        }
        if (value instanceof Number number) {
            long count = number.longValue();
            return count < 0 || count > Integer.MAX_VALUE ? -1 : (int) count;
        }
        return -1;
    }

    private static void copyHeader(MessageProperties source, MessageProperties destination, String name) {
        Object value = source.getHeaders().get(name);
        if (value instanceof String text && text.length() <= 255) {
            destination.setHeader(name, text);
        }
    }

    private static Duration requirePositiveBounded(Duration value, String name, Duration maximum) {
        if (value == null || value.isZero() || value.isNegative() || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException("Worker " + name + " must be positive and bounded");
        }
        return value;
    }
}
