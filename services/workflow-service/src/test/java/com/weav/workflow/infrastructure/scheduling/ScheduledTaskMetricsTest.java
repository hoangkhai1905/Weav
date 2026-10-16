package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.infrastructure.metrics.ScheduledTaskMetrics;

import com.weav.workflow.application.port.out.ExecutionRecoveryPort;
import com.weav.workflow.application.trigger.GmailTriggerService;
import com.weav.workflow.application.trigger.ScheduleTriggerService;
import com.weav.workflow.domain.port.out.OutboxEventRepository;
import com.weav.workflow.domain.port.out.WorkflowExecutionRepository;
import com.weav.workflow.infrastructure.messaging.ExecutionOutboxPublisher;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.dao.DataAccessResourceFailureException;
import tools.jackson.databind.json.JsonMapper;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The last-success gauge only moves when a scheduled run finished without throwing. */
class ScheduledTaskMetricsTest {
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final ScheduledTaskMetrics metrics = new ScheduledTaskMetrics(registry);

    private double gauge(String task) {
        return registry.get("weav.scheduled.task.last.success.timestamp.seconds").tag("task", task).gauge().value();
    }

    @Test
    void gaugesAreNanUntilTheFirstSuccessThenHoldTheUnixTime() {
        for (String task : List.of(ScheduledTaskMetrics.EXECUTION_OUTBOX_PUBLISHER,
                ScheduledTaskMetrics.NOTIFICATION_OUTBOX_PUBLISHER, ScheduledTaskMetrics.SCHEDULE_SCANNER,
                ScheduledTaskMetrics.GMAIL_SCANNER, ScheduledTaskMetrics.EXECUTION_RECOVERY_SCANNER,
                ScheduledTaskMetrics.LONG_RUNNING_ALERT_SWEEPER, ScheduledTaskMetrics.RETENTION_PURGE)) {
            assertTrue(Double.isNaN(gauge(task)), task);
        }
        long before = Instant.now().getEpochSecond();

        metrics.succeeded(ScheduledTaskMetrics.RETENTION_PURGE);

        assertTrue(gauge(ScheduledTaskMetrics.RETENTION_PURGE) >= before);
        assertTrue(Double.isNaN(gauge(ScheduledTaskMetrics.SCHEDULE_SCANNER)));
        assertThrows(IllegalArgumentException.class, () -> metrics.succeeded("unknown"));
    }

    @Test
    void scansMarkSuccessOnlyWhenTheyRanAndDidNotThrow() {
        ScheduleTriggerService schedules = mock(ScheduleTriggerService.class);
        GmailTriggerService gmail = mock(GmailTriggerService.class);
        when(schedules.scan(any(Instant.class), anyInt()))
                .thenThrow(new DataAccessResourceFailureException("down"))
                .thenReturn(new ScheduleTriggerService.ScanResult(0, 0, 0));
        when(schedules.earliestDue()).thenReturn(Optional.empty());
        WorkflowScheduleScanner scanner = new WorkflowScheduleScanner(schedules,
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 100, gmail, true, 10, 1_000,
                Duration.ofMinutes(10), new ActivitySignal());
        scanner.setScheduledTaskMetrics(metrics);

        assertThrows(DataAccessResourceFailureException.class, scanner::scanOnSchedule);
        assertTrue(Double.isNaN(gauge(ScheduledTaskMetrics.SCHEDULE_SCANNER)), "a failed run is not a success");

        // the error retry waits one base interval; wake the scan to run it now
        ActivitySignal wake = new ActivitySignal();
        WorkflowScheduleScanner second = new WorkflowScheduleScanner(schedules,
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 100, gmail, true, 10, 1_000,
                Duration.ofMinutes(10), wake);
        second.setScheduledTaskMetrics(metrics);
        second.scanOnSchedule();
        assertTrue(gauge(ScheduledTaskMetrics.SCHEDULE_SCANNER) > 0);
        assertTrue(Double.isNaN(gauge(ScheduledTaskMetrics.GMAIL_SCANNER)));
    }

    @Test
    void idleSkippedTicksAreNotRunsAndAFailingPublisherPollIsNotASuccess() {
        ExecutionRecoveryPort recovery = mock(ExecutionRecoveryPort.class);
        ExecutionRecoveryScanner scanner = new ExecutionRecoveryScanner(recovery, 50, Duration.ofMinutes(1),
                Duration.ofMinutes(1));
        scanner.setScheduledTaskMetrics(metrics);
        scanner.configureIdleBackoff(Duration.ofSeconds(30), Duration.ofMinutes(10), new ActivitySignal());
        scanner.recoverOnSchedule(); // runs, then sleeps
        double first = gauge(ScheduledTaskMetrics.EXECUTION_RECOVERY_SCANNER);
        assertTrue(first > 0);

        OutboxEventRepository outbox = mock(OutboxEventRepository.class);
        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenThrow(new DataAccessResourceFailureException("down"));
        ExecutionOutboxPublisher publisher = new ExecutionOutboxPublisher(outbox, mock(WorkflowExecutionRepository.class),
                mock(RabbitTemplate.class), JsonMapper.builder().build(),
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 5, Duration.ofSeconds(30),
                Duration.ofSeconds(1), Duration.ofSeconds(60));
        publisher.setScheduledTaskMetrics(metrics);
        publisher.publishPendingOnSchedule();
        assertTrue(Double.isNaN(gauge(ScheduledTaskMetrics.EXECUTION_OUTBOX_PUBLISHER)));

        when(outbox.claimPending(any(UUID.class), any(Instant.class), any(Instant.class), anyInt()))
                .thenReturn(List.of());
        ExecutionOutboxPublisher healthy = new ExecutionOutboxPublisher(outbox, mock(WorkflowExecutionRepository.class),
                mock(RabbitTemplate.class), JsonMapper.builder().build(),
                Clock.fixed(Instant.parse("2026-10-12T00:00:00Z"), ZoneOffset.UTC), 5, Duration.ofSeconds(30),
                Duration.ofSeconds(1), Duration.ofSeconds(60));
        healthy.setScheduledTaskMetrics(metrics);
        healthy.publishPendingOnSchedule();
        assertEquals(true, gauge(ScheduledTaskMetrics.EXECUTION_OUTBOX_PUBLISHER) > 0);
    }
}
