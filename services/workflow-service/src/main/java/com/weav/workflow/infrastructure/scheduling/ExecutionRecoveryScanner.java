package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.port.out.ExecutionRecoveryPort;
import java.time.Duration;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Bounded recovery polling. The scanner stays dormant until the execution worker is enabled. While no run is in
 * flight it backs off (up to {@code weav.workflow.maintenance.idle-max-delay}, default 10 minutes) so Neon can
 * suspend; an admission on this instance wakes it, and any active run keeps it at the base interval.
 */
@Component
@ConditionalOnProperty(name = "weav.workflow.execution.worker.enabled", havingValue = "true")
public class ExecutionRecoveryScanner {
    private final ExecutionRecoveryPort recovery;
    private final int batchSize;
    private final Duration queuedDeliveryAge;
    private final Duration outboxCooldown;
    private volatile IdleBackoff idleBackoff;
    private volatile ActivitySignal activity;
    private long seenActivity;

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
        IdleBackoff backoff = idleBackoff;
        if (backoff == null) {
            scanNow();
            return;
        }
        if (activityChanged()) {
            backoff.wake();
        }
        if (!backoff.shouldPoll()) {
            return;
        }
        boolean busy = false;
        try {
            busy = scanNow() > 0 || recovery.hasActiveExecutions();
        } finally {
            backoff.record(busy);
        }
    }

    /** Idle backoff (scale-to-zero friendly polling); without it every tick scans, as before. */
    @Autowired
    void configureIdleBackoff(
            @Value("${weav.workflow.execution.recovery.poll-interval:30000}") Duration pollInterval,
            @Value("${weav.workflow.maintenance.idle-max-delay:PT10M}") Duration idleMaxDelay,
            ActivitySignal executionActivity) {
        this.idleBackoff = new IdleBackoff(pollInterval,
                idleMaxDelay.compareTo(pollInterval) < 0 ? pollInterval : idleMaxDelay);
        this.activity = executionActivity;
        this.seenActivity = executionActivity.generation();
    }

    private synchronized boolean activityChanged() {
        ActivitySignal signal = activity;
        if (signal == null || signal.generation() == seenActivity) {
            return false;
        }
        seenActivity = signal.generation();
        return true;
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
