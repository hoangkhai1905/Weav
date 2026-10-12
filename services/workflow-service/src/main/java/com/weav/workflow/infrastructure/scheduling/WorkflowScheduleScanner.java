package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.trigger.GmailTriggerService;
import com.weav.workflow.application.trigger.ScheduleTriggerService;
import java.time.Clock;
import java.time.Duration;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Spring entry point for the bounded durable schedule scanner. Both scans back off while idle (see
 * {@link IdleBackoff}) so Neon can scale to zero: after empty scans the next one waits up to the idle maximum
 * (default 30 s). Trade-off: a schedule that becomes due during an idle stretch can start up to that long late;
 * any due slot found resets the scan to the base interval.
 */
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
    private final IdleBackoff scheduleBackoff;
    private final IdleBackoff gmailBackoff;

    public WorkflowScheduleScanner(ScheduleTriggerService schedules, Clock workflowExecutionClock,
                                   @Value("${weav.workflow.schedule.scanner.batch-size:100}") int batchSize,
                                   GmailTriggerService gmail,
                                   @Value("${weav.workflow.gmail.poller.enabled:true}") boolean gmailEnabled,
                                   @Value("${weav.workflow.gmail.poller.batch-size:10}") int gmailBatchSize,
                                   @Value("${weav.workflow.schedule.scanner.poll-interval-ms:1000}") long pollIntervalMillis,
                                   @Value("${weav.workflow.schedule.scanner.idle-max-delay:PT30S}") Duration idleMaxDelay) {
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
        Duration base = Duration.ofMillis(pollIntervalMillis);
        Duration max = idleMaxDelay.compareTo(base) < 0 ? base : idleMaxDelay;
        this.scheduleBackoff = new IdleBackoff(base, max);
        this.gmailBackoff = new IdleBackoff(base, max);
    }

    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scan() {
        if (!scheduleBackoff.shouldPoll()) {
            return;
        }
        boolean found = false;
        try {
            found = schedules.scan(clock.instant(), batchSize).selected() > 0;
        } finally {
            scheduleBackoff.record(found);
        }
    }

    /**
     * Same scanner and tick period, but its own scheduled task so a slow Gmail call never delays schedule slots.
     * Only triggers whose next poll is due are selected, so most ticks do no work.
     */
    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scanGmail() {
        if (!gmailEnabled || !gmailBackoff.shouldPoll()) {
            return;
        }
        boolean found = false;
        try {
            found = gmail.scan(clock.instant(), gmailBatchSize).selected() > 0;
        } finally {
            gmailBackoff.record(found);
        }
    }
}
