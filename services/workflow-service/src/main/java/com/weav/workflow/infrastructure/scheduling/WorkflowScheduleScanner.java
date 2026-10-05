package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.trigger.GmailTriggerService;
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
    private final GmailTriggerService gmail;
    private final boolean gmailEnabled;
    private final int gmailBatchSize;

    public WorkflowScheduleScanner(ScheduleTriggerService schedules, Clock workflowExecutionClock,
                                   @Value("${weav.workflow.schedule.scanner.batch-size:100}") int batchSize,
                                   GmailTriggerService gmail,
                                   @Value("${weav.workflow.gmail.poller.enabled:true}") boolean gmailEnabled,
                                   @Value("${weav.workflow.gmail.poller.batch-size:10}") int gmailBatchSize) {
        this.schedules = Objects.requireNonNull(schedules);
        this.clock = Objects.requireNonNull(workflowExecutionClock);
        if (batchSize < 1 || batchSize > 1_000) {
            throw new IllegalArgumentException("Schedule scanner batch size must be between 1 and 1000");
        }
        this.batchSize = batchSize;
        if (gmailBatchSize < 1 || gmailBatchSize > 100) {
            throw new IllegalArgumentException("Gmail poller batch size must be between 1 and 100");
        }
        this.gmail = Objects.requireNonNull(gmail);
        this.gmailEnabled = gmailEnabled;
        this.gmailBatchSize = gmailBatchSize;
    }

    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scan() {
        schedules.scan(clock.instant(), batchSize);
    }

    /**
     * Same scanner and tick period, but its own scheduled task so a slow Gmail call never delays schedule slots.
     * Only triggers whose next poll is due are selected, so most ticks do no work.
     */
    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scanGmail() {
        if (gmailEnabled) {
            gmail.scan(clock.instant(), gmailBatchSize);
        }
    }
}
