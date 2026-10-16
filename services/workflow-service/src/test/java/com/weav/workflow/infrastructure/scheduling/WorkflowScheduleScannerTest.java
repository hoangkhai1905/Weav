package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.trigger.GmailTriggerService;
import com.weav.workflow.application.trigger.ScheduleTriggerService;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Idle scans sleep until the earliest due time; a slot that is due fires on time, a local write wakes the scan. */
class WorkflowScheduleScannerTest {
    private static final Instant NOW = Instant.parse("2026-10-12T00:00:00Z");

    private final ScheduleTriggerService schedules = mock(ScheduleTriggerService.class);
    private final GmailTriggerService gmail = mock(GmailTriggerService.class);
    private final ActivitySignal triggerActivity = new ActivitySignal();

    private WorkflowScheduleScanner scanner(long pollIntervalMillis, Duration maxSleep) {
        when(gmail.scan(any(Instant.class), anyInt())).thenReturn(new GmailTriggerService.ScanResult(0, 0, 0));
        return new WorkflowScheduleScanner(schedules, Clock.fixed(NOW, ZoneOffset.UTC), 100, gmail, true, 10,
                pollIntervalMillis, maxSleep, triggerActivity);
    }

    @Test
    void dueSlotsKeepTheBaseIntervalAndAnEmptyScanWithNothingPendingSleeps() {
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenReturn(new ScheduleTriggerService.ScanResult(1, 1, 0))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0));
        when(schedules.earliestDue()).thenReturn(Optional.empty());
        WorkflowScheduleScanner scanner = scanner(1_000, Duration.ofMinutes(10));

        scanner.scanOnSchedule(); // finds a due slot
        scanner.scanOnSchedule(); // polls again at once, finds nothing
        scanner.scanOnSchedule(); // sleeping until the aligned wake: skipped
        verify(schedules, times(2)).scan(any(Instant.class), anyInt());
        verify(schedules, times(1)).earliestDue();

        scanner.scan(); // direct callers always scan
        verify(schedules, times(3)).scan(any(Instant.class), anyInt());
    }

    @Test
    void aDueScheduleFiresOnTimeAfterTheScannerSleptUntilItsDueTime() throws InterruptedException {
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0))
                .thenReturn(new ScheduleTriggerService.ScanResult(1, 1, 0));
        when(schedules.earliestDue()).thenReturn(Optional.of(NOW.plusMillis(400)));
        WorkflowScheduleScanner scanner = scanner(50, Duration.ofMinutes(10));

        scanner.scanOnSchedule(); // empty: next slot is 400 ms away
        scanner.scanOnSchedule();
        verify(schedules, times(1)).scan(any(Instant.class), anyInt());

        Thread.sleep(450); // past the due time: the very next tick scans and admits the slot
        scanner.scanOnSchedule();
        verify(schedules, times(2)).scan(any(Instant.class), anyInt());
    }

    @Test
    void aTriggerWriteCommittedLocallyWakesTheSleepingScans() {
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0));
        when(schedules.earliestDue()).thenReturn(Optional.empty());
        when(gmail.earliestDue()).thenReturn(Optional.empty());
        WorkflowScheduleScanner scanner = scanner(1_000, Duration.ofMinutes(10));

        scanner.scanOnSchedule();
        scanner.scanGmailOnSchedule();
        scanner.scanOnSchedule();
        scanner.scanGmailOnSchedule();
        verify(schedules, times(1)).scan(any(Instant.class), anyInt());
        verify(gmail, times(1)).scan(any(Instant.class), anyInt());

        triggerActivity.signalAfterCommit(); // e.g. a workflow was published or resumed
        scanner.scanOnSchedule();
        scanner.scanGmailOnSchedule();
        verify(schedules, times(2)).scan(any(Instant.class), anyInt());
        verify(gmail, times(2)).scan(any(Instant.class), anyInt());
    }

    @Test
    void aFailingDueLookupFallsBackToTheNormalBackoff() {
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0));
        when(schedules.earliestDue()).thenThrow(new IllegalStateException("database unavailable"));
        WorkflowScheduleScanner scanner = scanner(1_000, Duration.ofMinutes(10));

        scanner.scanOnSchedule();
        scanner.scanOnSchedule(); // backing off: skipped

        verify(schedules, times(1)).scan(any(Instant.class), anyInt());
    }

    @Test
    void aFailedScanRetriesFromTheBaseIntervalEvenAfterAnAlignedSleep() {
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0))
                .thenThrow(new IllegalStateException("cold start timeout"))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0));
        when(schedules.earliestDue()).thenReturn(Optional.empty());
        WorkflowScheduleScanner scanner = scanner(50, Duration.ofMinutes(10));

        scanner.scanOnSchedule(); // idle: aligned sleep (minutes)
        triggerActivity.signalAfterCommit();
        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class, scanner::scanOnSchedule);
        verify(schedules, times(2)).scan(any(Instant.class), anyInt());

        try {
            Thread.sleep(120); // the error retry comes after the base interval, not after the aligned sleep
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
        scanner.scanOnSchedule();
        verify(schedules, times(3)).scan(any(Instant.class), anyInt());
    }

    @Test
    void anIneligibleTriggerThatStaysDueDoesNotMakeTheScannerSpin() {
        when(gmail.scan(any(Instant.class), anyInt())).thenReturn(new GmailTriggerService.ScanResult(1, 0, 0));
        when(schedules.scan(any(Instant.class), anyInt())).thenReturn(new ScheduleTriggerService.ScanResult(1, 0, 0));
        when(schedules.earliestDue()).thenReturn(Optional.of(NOW.minusSeconds(60))); // never advances
        WorkflowScheduleScanner scanner = scanner(1_000, Duration.ofMinutes(10));

        scanner.scanOnSchedule(); // selected, nothing admitted, still due: ramp (2 s), not a 1 s loop
        scanner.scanOnSchedule();
        scanner.scanOnSchedule();

        verify(schedules, times(1)).scan(any(Instant.class), anyInt());
        verify(schedules, times(1)).earliestDue();
    }
}
