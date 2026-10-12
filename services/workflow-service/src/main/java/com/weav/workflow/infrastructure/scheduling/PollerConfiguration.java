package com.weav.workflow.infrastructure.scheduling;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** In-process wake signals between the outbox writers and their publishers (one per outbox). */
@Configuration(proxyBeanMethods = false)
public class PollerConfiguration {

    @Bean
    OutboxWakeup executionOutboxWakeup() {
        return new OutboxWakeup();
    }

    @Bean
    OutboxWakeup notificationOutboxWakeup() {
        return new OutboxWakeup();
    }
}
