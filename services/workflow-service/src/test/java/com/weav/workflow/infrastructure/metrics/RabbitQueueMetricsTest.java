package com.weav.workflow.infrastructure.metrics;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.QueueInformation;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class RabbitQueueMetricsTest {
    private static final String DLQ = "workflow.executions.v1.dlq";

    @Test
    void reportsDlqDepthAndFallsBackToNaNWithoutThrowingWhenBrokerIsDown() {
        AmqpAdmin admin = mock(AmqpAdmin.class);
        when(admin.getQueueInfo(anyString())).thenReturn(new QueueInformation(DLQ, 7, 0));
        SimpleMeterRegistry registry = new SimpleMeterRegistry();
        RabbitQueueMetrics metrics = new RabbitQueueMetrics(admin, registry);
        try {
            metrics.refresh();
            assertEquals(7.0, registry.get("weav_rabbit_queue_messages").tag("queue", DLQ).gauge().value());

            when(admin.getQueueInfo(anyString())).thenThrow(new AmqpConnectException(new RuntimeException("down")));
            assertDoesNotThrow(metrics::refresh);
            assertTrue(Double.isNaN(registry.get("weav_rabbit_queue_messages").tag("queue", DLQ).gauge().value()));
        } finally {
            metrics.stop();
        }
    }
}
