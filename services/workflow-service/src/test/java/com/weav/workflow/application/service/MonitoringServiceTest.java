package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.MonitoringQueryPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort.DayCount;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunCounts;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunFilter;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunPage;
import com.weav.workflow.application.port.out.MonitoringQueryPort.SummaryData;
import com.weav.workflow.application.port.out.MonitoringQueryPort.WorkflowCounts;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MonitoringServiceTest {
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID USER = UUID.randomUUID();
    private static final Instant NOW = Instant.parse("2026-10-08T15:30:00Z");

    private final MonitoringQueryPort port = mock(MonitoringQueryPort.class);

    private MonitoringService service(Set<String> capabilities) {
        return new MonitoringService(
                new WorkspaceAuthorization((workspace, user) ->
                        new WorkspaceAccessPort.Access(workspace, user, "MEMBER", capabilities)),
                port, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    @Test
    void historyAndSummaryRequireTheMonitorCapability() {
        MonitoringService viewer = service(Set.of("WORKSPACE_VIEW"));

        assertThrows(ForbiddenException.class,
                () -> viewer.history(WORKSPACE, USER, null, null, null, null, 0, 20));
        assertThrows(ForbiddenException.class, () -> viewer.summary(WORKSPACE, USER, 7));
        verify(port, never()).history(any(), any(), org.mockito.ArgumentMatchers.anyInt(),
                org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void historyRejectsBadPagesAndRangesLongerThanNinetyDays() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));

        assertThrows(BadRequestException.class,
                () -> service.history(WORKSPACE, USER, null, null, null, null, -1, 20));
        assertThrows(BadRequestException.class,
                () -> service.history(WORKSPACE, USER, null, null, null, null, 0, 101));
        assertThrows(BadRequestException.class, () -> service.history(WORKSPACE, USER, null, null,
                NOW.minus(Duration.ofDays(91)), NOW, 0, 20));
        assertThrows(BadRequestException.class, () -> service.history(WORKSPACE, USER, null, null,
                NOW, NOW.minusSeconds(1), 0, 20));
    }

    @Test
    void historyPassesFiltersAndDefaultsAnOpenRange() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));
        UUID workflowId = UUID.randomUUID();
        when(port.history(eq(WORKSPACE), any(), eq(2), eq(50))).thenReturn(new RunPage(List.of(), 2, 50, 0));
        Instant from = NOW.minus(Duration.ofDays(3));

        service.history(WORKSPACE, USER, ExecutionStatus.FAILED, workflowId, from, null, 2, 50);

        ArgumentCaptor<RunFilter> filter = ArgumentCaptor.forClass(RunFilter.class);
        verify(port).history(eq(WORKSPACE), filter.capture(), eq(2), eq(50));
        assertEquals(ExecutionStatus.FAILED, filter.getValue().status());
        assertEquals(workflowId, filter.getValue().workflowId());
        assertEquals(from, filter.getValue().from());
        assertNull(filter.getValue().to(), "an open upper bound keeps runs created right now");
    }

    @Test
    void historyWithoutTimeFiltersDefaultsToTheLast90Days() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));
        when(port.history(eq(WORKSPACE), any(), eq(0), eq(20))).thenReturn(new RunPage(List.of(), 0, 20, 0));

        service.history(WORKSPACE, USER, null, null, null, null, 0, 20);

        ArgumentCaptor<RunFilter> filter = ArgumentCaptor.forClass(RunFilter.class);
        verify(port).history(eq(WORKSPACE), filter.capture(), eq(0), eq(20));
        assertEquals(NOW.minus(Duration.ofDays(90)), filter.getValue().from());
        assertNull(filter.getValue().to());
    }

    @Test
    void aFromOlderThanNinetyDaysIsRejectedEvenWithoutATo() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));

        assertThrows(BadRequestException.class, () -> service.history(WORKSPACE, USER, null, null,
                NOW.minus(Duration.ofDays(91)), null, 0, 20));
        assertThrows(BadRequestException.class, () -> service.history(WORKSPACE, USER, null, null,
                NOW.plusSeconds(60), null, 0, 20));
    }

    @Test
    void summaryZeroFillsTheTrendAndComputesTheSuccessRate() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));
        LocalDate today = LocalDate.of(2026, 10, 8);
        when(port.summary(eq(WORKSPACE), any(), any(), any())).thenReturn(new SummaryData(
                new WorkflowCounts(3, 1, 2),
                new RunCounts(10, 4, 6, 2, 1, 1500L, 4200L),
                List.of(new DayCount(today.minusDays(2), 5, 4, 1), new DayCount(today, 5, 2, 1)),
                List.of(), List.of()));

        MonitoringService.Summary summary = service.summary(WORKSPACE, USER, 4);

        assertEquals(4, summary.trend().size());
        assertEquals(today.minusDays(3), summary.trend().get(0).day());
        assertEquals(0, summary.trend().get(0).total());
        assertEquals(5, summary.trend().get(1).total());
        assertEquals(0, summary.trend().get(2).failed());
        assertEquals(today, summary.trend().get(3).day());
        assertEquals(0.75, summary.successRate());
        ArgumentCaptor<Instant> from = ArgumentCaptor.forClass(Instant.class);
        ArgumentCaptor<Instant> todayStart = ArgumentCaptor.forClass(Instant.class);
        verify(port).summary(eq(WORKSPACE), from.capture(), eq(NOW), todayStart.capture());
        assertEquals(Instant.parse("2026-10-05T00:00:00Z"), from.getValue());
        assertEquals(Instant.parse("2026-10-08T00:00:00Z"), todayStart.getValue());
    }

    @Test
    void emptyWorkspaceHasNoRateAndAZeroFilledTrend() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));
        when(port.summary(eq(WORKSPACE), any(), any(), any())).thenReturn(new SummaryData(
                new WorkflowCounts(0, 0, 0), new RunCounts(0, 0, 0, 0, 0, null, null),
                List.of(), List.of(), List.of()));

        MonitoringService.Summary summary = service.summary(WORKSPACE, USER, 7);

        assertNull(summary.successRate());
        assertEquals(7, summary.trend().size());
        assertEquals(0, summary.trend().stream().mapToLong(DayCount::total).sum());
    }

    @Test
    void summaryDaysAreBoundedAndOnlyFailedRunsLowerTheRate() {
        MonitoringService service = service(Set.of("WORKFLOW_MONITOR"));

        assertThrows(BadRequestException.class, () -> service.summary(WORKSPACE, USER, 0));
        assertThrows(BadRequestException.class, () -> service.summary(WORKSPACE, USER, 31));
        // 1 success + 2 failed + 7 still active: the rate only counts finished runs.
        assertEquals(0.3333, MonitoringService.successRate(new RunCounts(10, 0, 1, 2, 7, null, null)));
    }
}
