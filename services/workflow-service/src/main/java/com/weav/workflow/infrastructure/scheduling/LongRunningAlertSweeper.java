package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.port.out.ExecutionRecoveryPort;
import com.weav.workflow.application.service.AlertEvaluator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Objects;

/**
 * Raises LONG_RUNNING alerts while a run is still going (the completion-time check only sees finished runs).
 * One bounded sweep per tick; correctness across instances comes from the alert firing guards, not from this class.
 * With no run in flight nothing can be overdue, so the sweep backs off (up to
 * {@code weav.workflow.maintenance.idle-max-delay}) and an admission on this instance wakes it.
 */
@Component
@ConditionalOnProperty(name = "weav.workflow.alerts.sweep.enabled", havingValue = "true", matchIfMissing = true)
public class LongRunningAlertSweeper {
    private final AlertEvaluator evaluator;
    private final int batchSize;
    private volatile IdleBackoff idleBackoff;
    private volatile ActivitySignal activity;
    private volatile ExecutionRecoveryPort executions;
    private long seenActivity;

    public LongRunningAlertSweeper(AlertEvaluator evaluator,
                                   @Value("${weav.workflow.alerts.sweep.batch-size:200}") int batchSize) {
        this.evaluator = Objects.requireNonNull(evaluator, "evaluator must not be null");
        if (batchSize < 1 || batchSize > 1_000) {
            throw new IllegalArgumentException("Alert sweep batch size must be between one and one thousand");
        }
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${weav.workflow.alerts.sweep.poll-interval:60000}",
            initialDelayString = "${weav.workflow.alerts.sweep.initial-delay:60000}")
    public void sweepOnSchedule() {
        IdleBackoff backoff = idleBackoff;
        if (backoff == null) {
            sweepNow();
            return;
        }
        if (activityChanged()) {
            backoff.wake();
        }
        if (!backoff.shouldPoll()) {
            return;
        }
        boolean busy = true;
        try {
            sweepNow();
            busy = executions.hasActiveExecutions();
        } finally {
            backoff.record(busy);
        }
    }

    /** Idle backoff (scale-to-zero friendly polling); without it every tick sweeps, as before. */
    @Autowired
    void configureIdleBackoff(
            @Value("${weav.workflow.alerts.sweep.poll-interval:60000}") Duration pollInterval,
            @Value("${weav.workflow.maintenance.idle-max-delay:PT10M}") Duration idleMaxDelay,
            ActivitySignal executionActivity,
            ExecutionRecoveryPort executionRecovery) {
        this.idleBackoff = new IdleBackoff(pollInterval,
                idleMaxDelay.compareTo(pollInterval) < 0 ? pollInterval : idleMaxDelay);
        this.activity = executionActivity;
        this.executions = executionRecovery;
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

    public int sweepNow() {
        return evaluator.sweepOverdue(batchSize);
    }
}
