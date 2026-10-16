package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.trigger.GmailTriggerService;
import com.weav.workflow.application.trigger.ScheduleTriggerService;
import com.weav.workflow.infrastructure.metrics.ScheduledTaskMetrics;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Spring entry point for the bounded durable schedule scanner. Both scans sleep while idle (see {@link IdleBackoff})
 * so Neon can scale to zero: after an empty scan each one reads the earliest due time (a cheap MIN query) and sleeps
 * until then, never longer than {@code max-sleep} (aligned with the other pollers' wake-ups). A slot that is due is
 * picked up at the next 1 s tick after its due time; any due slot found resets the scan to the base interval.
 *
 * <p>A trigger that is published, updated, paused, resumed or deleted on this instance wakes both scans at once
 * after the commit (see {@code triggerActivity}). Multi-instance caveat: such a write on another instance cannot wake
 * this one, so it notices the change at its own due time or, at the latest, at its next aligned wake.
 */
@Component
@ConditionalOnProperty(prefix = "weav.workflow.schedule.scanner", name = "enabled",
        havingValue = "true", matchIfMissing = true)
public class WorkflowScheduleScanner {
    private static final Logger LOGGER = LoggerFactory.getLogger(WorkflowScheduleScanner.class);

    private final ScheduleTriggerService schedules;
    private final Clock clock;
    private final int batchSize;
    private final GmailTriggerService gmail;
    private final boolean gmailEnabled;
    private final int gmailBatchSize;
    private final IdleBackoff scheduleBackoff;
    private final IdleBackoff gmailBackoff;
    private final ActivitySignal triggerActivity;
    private volatile long scheduleSeenActivity;
    private volatile long gmailSeenActivity;
    private volatile ScheduledTaskMetrics taskMetrics;

    public WorkflowScheduleScanner(ScheduleTriggerService schedules, Clock workflowExecutionClock,
                                   @Value("${weav.workflow.schedule.scanner.batch-size:100}") int batchSize,
                                   GmailTriggerService gmail,
                                   @Value("${weav.workflow.gmail.poller.enabled:true}") boolean gmailEnabled,
                                   @Value("${weav.workflow.gmail.poller.batch-size:10}") int gmailBatchSize,
                                   @Value("${weav.workflow.schedule.scanner.poll-interval-ms:1000}") long pollIntervalMillis,
                                   @Value("${weav.workflow.schedule.scanner.max-sleep:PT10M}") Duration maxSleep,
                                   @Qualifier("triggerActivity") ActivitySignal triggerActivity) {
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
        Duration max = maxSleep.compareTo(base) < 0 ? base : maxSleep;
        this.scheduleBackoff = new IdleBackoff(base, max);
        this.gmailBackoff = new IdleBackoff(base, max);
        this.triggerActivity = Objects.requireNonNull(triggerActivity);
        this.scheduleSeenActivity = triggerActivity.generation();
        this.gmailSeenActivity = triggerActivity.generation();
    }

    /** Scheduled tick: scans unless the last scan was empty and the next slot is not due yet. */
    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scanOnSchedule() {
        long generation = triggerActivity.generation();
        if (generation != scheduleSeenActivity) {
            scheduleSeenActivity = generation;
            scheduleBackoff.wake();
        }
        if (!scheduleBackoff.shouldPoll()) {
            return;
        }
        ScheduleTriggerService.ScanResult result = null;
        try {
            result = scan();
        } finally {
            record(scheduleBackoff, result == null ? null : new Progress(result.selected(), result.admitted()),
                    schedules::earliestDue);
        }
        ScheduledTaskMetrics.markSucceeded(taskMetrics, ScheduledTaskMetrics.SCHEDULE_SCANNER);
    }

    /** Optional: records the last successful run for monitoring. */
    @Autowired(required = false)
    public void setScheduledTaskMetrics(ScheduledTaskMetrics metrics) {
        this.taskMetrics = metrics;
    }

    /** One bounded schedule scan, always run (direct callers bypass the idle backoff). */
    public ScheduleTriggerService.ScanResult scan() {
        return schedules.scan(clock.instant(), batchSize);
    }

    /**
     * Same scanner and tick period, but its own scheduled task so a slow Gmail call never delays schedule slots.
     * Only triggers whose next poll is due are selected, so most ticks do no work.
     */
    @Scheduled(fixedDelayString = "${weav.workflow.schedule.scanner.poll-interval-ms:1000}",
            initialDelayString = "${weav.workflow.schedule.scanner.initial-delay-ms:1000}")
    public void scanGmailOnSchedule() {
        if (!gmailEnabled) {
            return;
        }
        long generation = triggerActivity.generation();
        if (generation != gmailSeenActivity) {
            gmailSeenActivity = generation;
            gmailBackoff.wake();
        }
        if (!gmailBackoff.shouldPoll()) {
            return;
        }
        GmailTriggerService.ScanResult result = null;
        try {
            result = gmail.scan(clock.instant(), gmailBatchSize);
        } finally {
            record(gmailBackoff, result == null ? null : new Progress(result.selected(), result.admitted()),
                    gmail::earliestDue);
        }
        ScheduledTaskMetrics.markSucceeded(taskMetrics, ScheduledTaskMetrics.GMAIL_SCANNER);
    }

    /** One bounded Gmail scan, always run when enabled (direct callers bypass the idle backoff). */
    public void scanGmail() {
        if (gmailEnabled) {
            gmail.scan(clock.instant(), gmailBatchSize);
        }
    }

    /** What a scan did: candidates selected and runs admitted (null Progress = the scan failed). */
    private record Progress(int selected, int admitted) {
    }

    /**
     * A failed scan retries from the base interval (never the aligned sleep); admitted work keeps the base interval;
     * otherwise the scan sleeps until the next due time. If candidates were selected but none was admitted and the
     * earliest due time is still not in the future (an ineligible or misconfigured trigger that never advances), the
     * normal ramp applies instead of re-scanning every tick for ever, so the database can still suspend.
     */
    private void record(IdleBackoff backoff, Progress progress, Supplier<Optional<Instant>> earliestDue) {
        if (progress == null) {
            backoff.recordError();
            return;
        }
        if (progress.admitted() > 0) {
            backoff.record(true);
            return;
        }
        try {
            Instant now = clock.instant();
            Optional<Instant> due = earliestDue.get();
            if (progress.selected() > 0 && due.isPresent() && !due.get().isAfter(now)) {
                backoff.record(false);
                return;
            }
            backoff.recordIdle(due.map(instant -> Duration.between(now, instant)).orElse(null));
        } catch (RuntimeException exception) {
            LOGGER.warn("Trigger due lookup failed ({})", exception.getClass().getSimpleName());
            backoff.recordError();
        }
    }
}
