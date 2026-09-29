package com.weav.workflow.infrastructure.messaging;

import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Declares the durable topic exchange also consumed by Notification. */
@Configuration(proxyBeanMethods = false)
public class WorkflowNotificationRabbitConfiguration {

    @Bean("workflowNotificationRabbitTemplate")
    RabbitTemplate workflowNotificationRabbitTemplate(ConnectionFactory connectionFactory) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMandatory(true);
        template.setReturnsCallback(returned -> { });
        return template;
    }

    @Bean
    TopicExchange notificationEventsExchange(
            @Value("${weav.workflow.notification-outbox.exchange:weav.events}") String exchange) {
        return new TopicExchange(exchange, true, false);
    }
}
