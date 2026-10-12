package com.weav.workflow.application.port.out;

import java.time.Duration;

/** Durable recovery scan that converts abandoned execution state into outbox delivery intent. */
public interface ExecutionRecoveryPort {
    int enqueueRecoverable(int batchSize, Duration queuedDeliveryAge, Duration outboxCooldown);

    /** True while any run is queued, running or waiting; idle maintenance pollers back off when false. */
    default boolean hasActiveExecutions() {
        return true;
    }
}
