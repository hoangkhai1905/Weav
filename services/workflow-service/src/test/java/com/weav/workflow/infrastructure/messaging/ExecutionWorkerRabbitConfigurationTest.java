package com.weav.workflow.infrastructure.messaging;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.listener.SimpleMessageListenerContainer;

import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

class ExecutionWorkerRabbitConfigurationTest {

    private final ExecutionWorkerRabbitConfiguration configuration = new ExecutionWorkerRabbitConfiguration();

    @Test
    void listenerFactoryUsesBoundedConcurrency() {
        SimpleRabbitListenerContainerFactory factory = configuration
                .workflowExecutionListenerContainerFactory(mock(ConnectionFactory.class), 2, 4);

        SimpleMessageListenerContainer container = factory.createListenerContainer();
        assertEquals(2, ReflectionTestUtils.getField(container, "concurrentConsumers"));
        assertEquals(4, ReflectionTestUtils.getField(container, "maxConcurrentConsumers"));
    }

    @Test
    void invalidConcurrencyIsRejected() {
        ConnectionFactory connectionFactory = mock(ConnectionFactory.class);
        assertThrows(IllegalArgumentException.class, () -> configuration
                .workflowExecutionListenerContainerFactory(connectionFactory, 0, 4));
        assertThrows(IllegalArgumentException.class, () -> configuration
                .workflowExecutionListenerContainerFactory(connectionFactory, 3, 2));
    }
}
