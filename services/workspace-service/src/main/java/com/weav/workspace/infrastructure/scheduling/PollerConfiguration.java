package com.weav.workspace.infrastructure.scheduling;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Shared in-process wake signal between the outbox writer and its publisher. */
@Configuration(proxyBeanMethods = false)
public class PollerConfiguration {

    @Bean
    OutboxWakeup notificationOutboxWakeup() {
        return new OutboxWakeup();
    }
}
