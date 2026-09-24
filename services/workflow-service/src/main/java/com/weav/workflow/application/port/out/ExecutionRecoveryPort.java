package com.weav.workflow.application.port.out;

import java.time.Duration;

/** Durable recovery scan that converts abandoned execution state into outbox delivery intent. */
public interface ExecutionRecoveryPort {
    int enqueueRecoverable(int batchSize, Duration queuedDeliveryAge, Duration outboxCooldown);
}
