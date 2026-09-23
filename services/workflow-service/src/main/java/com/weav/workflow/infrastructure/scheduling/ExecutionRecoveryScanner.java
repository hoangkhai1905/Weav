package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.port.out.ExecutionRecoveryPort;
import java.time.Duration;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Bounded recovery polling. The scanner stays dormant until the execution worker is enabled. */
@Component
@ConditionalOnProperty(name = "weav.workflow.execution.worker.enabled", havingValue = "true")
public class ExecutionRecoveryScanner {
    private final ExecutionRecoveryPort recovery;
    private final int batchSize;
    private final Duration queuedDeliveryAge;
    private final Duration outboxCooldown;

    public ExecutionRecoveryScanner(ExecutionRecoveryPort recovery,
                                   @Value("${weav.workflow.execution.recovery.batch-size:50}") int batchSize,
                                   @Value("${weav.workflow.execution.recovery.queued-delivery-age:PT1M}")
                                   Duration queuedDeliveryAge,
                                   @Value("${weav.workflow.execution.recovery.outbox-cooldown:PT1M}")
                                   Duration outboxCooldown) {
        this.recovery = Objects.requireNonNull(recovery, "recovery must not be null");
        if (batchSize < 1 || batchSize > 1_000) {
            throw new IllegalArgumentException("Recovery batch size must be between one and one thousand");
        }
        this.batchSize = batchSize;
        this.queuedDeliveryAge = requireNonNegative(queuedDeliveryAge, "queued delivery age");
        this.outboxCooldown = requireNonNegative(outboxCooldown, "outbox cooldown");
    }

    @Scheduled(fixedDelayString = "${weav.workflow.execution.recovery.poll-interval:30000}",
            initialDelayString = "${weav.workflow.execution.recovery.initial-delay:30000}")
    public void recoverOnSchedule() {
        scanNow();
    }

    public int scanNow() {
        return recovery.enqueueRecoverable(batchSize, queuedDeliveryAge, outboxCooldown);
    }

    private static Duration requireNonNegative(Duration duration, String name) {
        if (duration == null || duration.isNegative() || duration.toMillis() > Integer.MAX_VALUE) {
            throw new IllegalArgumentException("Recovery " + name + " must be nonnegative and bounded");
        }
        return duration;
    }
}
