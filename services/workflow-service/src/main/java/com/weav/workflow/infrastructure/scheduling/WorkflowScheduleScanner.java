package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.trigger.ScheduleTriggerService;
import java.time.Clock;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Spring entry point for the bounded durable schedule scanner. */
@Component
@ConditionalOnProperty(prefix = "weav.workflow.schedule.scanner", name = "enabled",
        havingValue = "true", matchIfMissing = true)
public class WorkflowScheduleScanner {
    private final ScheduleTriggerService schedules;
    private final Clock clock;
    private final int batchSize;

    public WorkflowScheduleScanner(ScheduleTriggerService schedules, Clock workflowExecutionClock,
                                   @Value("${weav.workflow.schedule.scanner.batch-size:100}") int batchSize) {
        this.schedules = Objects.requireNonNull(schedules);
        this.clock = Objects.requireNonNull(workflowExecutionClock);
        if (batchSize < 1 || batchSize > 1_000) {
            throw new IllegalArgumentException("Schedule scanner batch size must be between 1 and 1000");
        }
        this.batchSize = batchSize;
    }

    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scan() {
        schedules.scan(clock.instant(), batchSize);
    }
}
