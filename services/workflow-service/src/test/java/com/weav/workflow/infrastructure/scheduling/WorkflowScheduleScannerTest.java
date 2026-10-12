package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.application.trigger.GmailTriggerService;
import com.weav.workflow.application.trigger.ScheduleTriggerService;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Batch 5: idle scans back off; a scan that finds due slots keeps polling at the base interval. */
class WorkflowScheduleScannerTest {

    @Test
    void emptyScansBackOffWhileDueSlotsKeepTheBaseInterval() {
        ScheduleTriggerService schedules = mock(ScheduleTriggerService.class);
        GmailTriggerService gmail = mock(GmailTriggerService.class);
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenReturn(new ScheduleTriggerService.ScanResult(1, 1, 0))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0));
        when(gmail.scan(any(Instant.class), anyInt())).thenReturn(new GmailTriggerService.ScanResult(0, 0, 0));
        WorkflowScheduleScanner scanner = new WorkflowScheduleScanner(schedules,
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 100, gmail, true, 10,
                1_000, Duration.ofSeconds(30));

        scanner.scanOnSchedule(); // finds a due slot
        scanner.scanOnSchedule(); // polls again at once, finds nothing
        scanner.scanOnSchedule(); // backing off: skipped
        verify(schedules, times(2)).scan(any(Instant.class), anyInt());

        scanner.scanGmailOnSchedule();
        scanner.scanGmailOnSchedule();
        verify(gmail, times(1)).scan(any(Instant.class), anyInt());

        scanner.scan(); // direct callers always scan
        verify(schedules, times(3)).scan(any(Instant.class), anyInt());
    }
}
