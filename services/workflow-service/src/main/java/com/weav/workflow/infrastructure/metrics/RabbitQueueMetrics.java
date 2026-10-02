package com.weav.workflow.infrastructure.metrics;

import com.weav.workflow.infrastructure.messaging.RabbitExecutionConfiguration;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import jakarta.annotation.PreDestroy;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.QueueInformation;
import org.springframework.stereotype.Component;

/**
 * X-14: execution queue and dead-letter queue depth. Polled every 30 s on a private daemon thread, so an
 * unreachable broker can never block a scrape or startup; the gauge reads NaN until a poll succeeds.
 */
@Component
public class RabbitQueueMetrics {
    private static final Logger LOGGER = LoggerFactory.getLogger(RabbitQueueMetrics.class);
    private static final long POLL_SECONDS = 30;

    private final AmqpAdmin amqpAdmin;
    private final Map<String, Double> depths = new ConcurrentHashMap<>();
    private final ScheduledExecutorService poller = Executors.newSingleThreadScheduledExecutor(task -> {
        Thread thread = new Thread(task, "rabbit-queue-metrics");
        thread.setDaemon(true);
        return thread;
    });

    public RabbitQueueMetrics(AmqpAdmin amqpAdmin, MeterRegistry registry) {
        this.amqpAdmin = amqpAdmin;
        for (String queue : new String[] {
                RabbitExecutionConfiguration.EXECUTION_QUEUE, RabbitExecutionConfiguration.DEAD_LETTER_QUEUE}) {
            Gauge.builder("weav_rabbit_queue_messages", depths, d -> d.getOrDefault(queue, Double.NaN))
                    .tag("queue", queue).description("Messages ready in the queue (NaN when the broker is unreachable)")
                    .register(registry);
        }
        poller.scheduleWithFixedDelay(this::refresh, 5, POLL_SECONDS, TimeUnit.SECONDS);
    }

    /** Polls the broker now; never throws. */
    public void refresh() {
        for (String queue : new String[] {
                RabbitExecutionConfiguration.EXECUTION_QUEUE, RabbitExecutionConfiguration.DEAD_LETTER_QUEUE}) {
            try {
                QueueInformation info = amqpAdmin.getQueueInfo(queue);
                if (info == null) {
                    depths.remove(queue);
                } else {
                    depths.put(queue, (double) info.getMessageCount());
                }
            } catch (RuntimeException ex) {
                depths.remove(queue);
                LOGGER.warn("Queue depth poll failed for {}: {}", queue, ex.toString());
            }
        }
    }

    @PreDestroy
    void stop() {
        poller.shutdownNow();
    }
}
