package com.weav.workflow.infrastructure.messaging;

import java.time.Clock;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.DirectExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class RabbitExecutionConfiguration {
    public static final String EXECUTION_EXCHANGE = "workflow.executions";
    public static final String EXECUTION_QUEUE = "workflow.executions.v1";
    public static final String EXECUTION_ROUTING_KEY = "execute";
    public static final String DEAD_LETTER_EXCHANGE = "workflow.executions.dlx";
    public static final String DEAD_LETTER_QUEUE = "workflow.executions.v1.dlq";
    public static final String DEAD_LETTER_ROUTING_KEY = "dead";
    public static final String CORRELATION_ID_HEADER = "X-Correlation-Id";
    public static final String TRACEPARENT_HEADER = "traceparent";

    @Bean
    DirectExchange executionExchange() {
        return new DirectExchange(EXECUTION_EXCHANGE, true, false);
    }

    @Bean
    Queue executionQueue() {
        return QueueBuilder.durable(EXECUTION_QUEUE)
                .deadLetterExchange(DEAD_LETTER_EXCHANGE)
                .deadLetterRoutingKey(DEAD_LETTER_ROUTING_KEY)
                .build();
    }

    @Bean
    Binding executionQueueBinding(@Qualifier("executionQueue") Queue executionQueue,
                                  @Qualifier("executionExchange") DirectExchange executionExchange) {
        return BindingBuilder.bind(executionQueue).to(executionExchange).with(EXECUTION_ROUTING_KEY);
    }

    @Bean
    DirectExchange executionDeadLetterExchange() {
        return new DirectExchange(DEAD_LETTER_EXCHANGE, true, false);
    }

    @Bean
    Queue executionDeadLetterQueue() {
        return QueueBuilder.durable(DEAD_LETTER_QUEUE).build();
    }

    @Bean
    Binding executionDeadLetterBinding(@Qualifier("executionDeadLetterQueue") Queue executionDeadLetterQueue,
                                       @Qualifier("executionDeadLetterExchange") DirectExchange executionDeadLetterExchange) {
        return BindingBuilder.bind(executionDeadLetterQueue)
                .to(executionDeadLetterExchange).with(DEAD_LETTER_ROUTING_KEY);
    }

    @Bean
    Clock workflowExecutionClock() {
        return Clock.systemUTC();
    }
}
