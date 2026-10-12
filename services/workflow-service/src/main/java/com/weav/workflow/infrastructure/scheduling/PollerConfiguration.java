package com.weav.workflow.infrastructure.scheduling;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** In-process wake signals between the writers and the pollers that read what they wrote. */
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

    /** Raised when a run is admitted; wakes the recovery scanner and the long-running alert sweeper. */
    @Bean
    ActivitySignal executionActivity() {
        return new ActivitySignal();
    }
}
