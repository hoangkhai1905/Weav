package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Bounded, durable schedule scan; each trigger is processed in its own transaction. */
@Service
public class ScheduleTriggerService {
    private static final Logger logger = LoggerFactory.getLogger(ScheduleTriggerService.class);

    private final WorkflowTriggerPort triggers;
    private final ScheduleTriggerProcessor processor;
    private final Clock clock;
    private final Duration failureBackoff;

    public ScheduleTriggerService(WorkflowTriggerPort triggers, ScheduleTriggerProcessor processor,
                                  Clock workflowExecutionClock,
                                  @Value("${weav.workflow.schedule.failure-backoff-ms:30000}") long failureBackoffMs) {
        this.triggers = Objects.requireNonNull(triggers);
        this.processor = Objects.requireNonNull(processor);
        this.clock = Objects.requireNonNull(workflowExecutionClock);
        if (failureBackoffMs < 1) {
            throw new IllegalArgumentException("Schedule failure backoff must be positive");
        }
        this.failureBackoff = Duration.ofMillis(failureBackoffMs);
    }

    public ScanResult scan(Instant scanTime, int batchSize) {
        Objects.requireNonNull(scanTime, "scanTime must not be null");
        List<WorkflowTriggerPort.ScheduleCandidate> due = triggers.findDueSchedules(scanTime, batchSize);
        int admitted = 0;
        int failed = 0;
        for (WorkflowTriggerPort.ScheduleCandidate candidate : due) {
            try {
                if (processor.process(candidate, scanTime)) {
                    admitted++;
                }
            } catch (RuntimeException exception) {
                failed++;
                try {
                    triggers.recordScheduleFailure(candidate.triggerId(), clock.instant().plus(failureBackoff));
                } catch (RuntimeException recordingFailure) {
                    logger.warn("Could not record the retry time for scheduled trigger {}", candidate.triggerId());
                }
                logger.warn("Scheduled trigger {} admission failed; its due slot remains pending",
                        candidate.triggerId());
            }
        }
        return new ScanResult(due.size(), admitted, failed);
    }

    public record ScanResult(int selected, int admitted, int failed) {
    }
}
