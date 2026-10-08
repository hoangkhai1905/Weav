package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.service.AlertEvaluator;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.Objects;

/**
 * Raises LONG_RUNNING alerts while a run is still going (the completion-time check only sees finished runs).
 * One bounded sweep per tick; correctness across instances comes from the alert firing guards, not from this class.
 */
@Component
@ConditionalOnProperty(name = "weav.workflow.alerts.sweep.enabled", havingValue = "true", matchIfMissing = true)
public class LongRunningAlertSweeper {
    private final AlertEvaluator evaluator;
    private final int batchSize;

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
        sweepNow();
    }

    public int sweepNow() {
        return evaluator.sweepOverdue(batchSize);
    }
}
