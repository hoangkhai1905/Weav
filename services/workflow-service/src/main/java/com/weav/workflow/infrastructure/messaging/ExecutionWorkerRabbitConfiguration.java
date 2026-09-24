package com.weav.workflow.infrastructure.messaging;

import java.time.Duration;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.config.SimpleRabbitListenerContainerFactory;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.core.AcknowledgeMode;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Delayed, bounded worker redelivery without immediate requeue loops. */
@Configuration(proxyBeanMethods = false)
public class ExecutionWorkerRabbitConfiguration {
    public static final String RETRY_QUEUE = "workflow.executions.v1.retry";
    public static final String RETRY_ROUTING_KEY = "retry";
    public static final String REDELIVERY_COUNT_HEADER = "x-workflow-redelivery-count";
    public static final String LISTENER_CONTAINER_FACTORY = "workflowExecutionListenerContainerFactory";

    @Bean
    Queue executionRetryQueue(
            @Value("${weav.workflow.execution.worker.transient-redelivery-delay:5000}") long delayMillis) {
        if (delayMillis < 1_000 || delayMillis > 60_000) {
            throw new IllegalArgumentException("Worker transient redelivery delay must be between 1 and 60 seconds");
        }
        return QueueBuilder.durable(RETRY_QUEUE)
                .ttl(Math.toIntExact(delayMillis))
                .deadLetterExchange(RabbitExecutionConfiguration.EXECUTION_EXCHANGE)
                .deadLetterRoutingKey(RabbitExecutionConfiguration.EXECUTION_ROUTING_KEY)
                .build();
    }

    @Bean
    Binding executionRetryQueueBinding(
            @Qualifier("executionRetryQueue") Queue executionRetryQueue,
            @Qualifier("executionExchange") DirectExchange executionExchange) {
        return BindingBuilder.bind(executionRetryQueue).to(executionExchange).with(RETRY_ROUTING_KEY);
    }

    @Bean(name = LISTENER_CONTAINER_FACTORY)
    SimpleRabbitListenerContainerFactory workflowExecutionListenerContainerFactory(
            ConnectionFactory connectionFactory) {
        SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
        factory.setConnectionFactory(connectionFactory);
        factory.setAcknowledgeMode(AcknowledgeMode.MANUAL);
        factory.setPrefetchCount(1);
        factory.setDefaultRequeueRejected(false);
        return factory;
    }
}
