package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.MonitoringQueryPort;
import com.weav.workflow.application.port.out.MonitoringQueryPort.DayCount;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunCounts;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunFilter;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunPage;
import com.weav.workflow.application.port.out.MonitoringQueryPort.SummaryData;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Workspace run history and metrics. Authorized like the per-workflow execution list (WORKFLOW_MONITOR). */
@Service
public final class MonitoringService {
    static final String MONITOR_CAPABILITY = "WORKFLOW_MONITOR";
    public static final int MAX_PAGE_SIZE = 100;
    public static final int MAX_RANGE_DAYS = 90;
    public static final int MIN_SUMMARY_DAYS = 1;
    public static final int MAX_SUMMARY_DAYS = 30;

    private final WorkspaceAuthorization workspaceAuthorization;
    private final MonitoringQueryPort queryPort;
    private final Clock clock;

    public MonitoringService(WorkspaceAuthorization workspaceAuthorization, MonitoringQueryPort queryPort,
                             @Qualifier("workflowExecutionClock") Clock clock) {
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization);
        this.queryPort = Objects.requireNonNull(queryPort);
        this.clock = Objects.requireNonNull(clock);
    }

    public RunPage history(UUID workspaceId, UUID actorId, ExecutionStatus status, UUID workflowId,
                           Instant from, Instant to, int page, int size) {
        workspaceAuthorization.require(workspaceId, actorId, MONITOR_CAPABILITY);
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE || (long) page * size > Integer.MAX_VALUE) {
            throw new BadRequestException("Execution page bounds are invalid");
        }
        // The 90-day cap always applies: a missing "from" is "to" (or now) minus 90 days; a missing "to" stays open
        // upwards so runs created right now are included.
        Instant upper = to != null ? to : clock.instant();
        Instant lower = from != null ? from : upper.minus(Duration.ofDays(MAX_RANGE_DAYS));
        if (!lower.isBefore(upper) || Duration.between(lower, upper).compareTo(Duration.ofDays(MAX_RANGE_DAYS)) > 0) {
            throw new BadRequestException("The time range must be positive and at most " + MAX_RANGE_DAYS + " days");
        }
        Instant effectiveFrom = lower;
        Instant effectiveTo = to;
        return queryPort.history(workspaceId, new RunFilter(status, workflowId, effectiveFrom, effectiveTo),
                page, size);
    }

    public Summary summary(UUID workspaceId, UUID actorId, int days) {
        workspaceAuthorization.require(workspaceId, actorId, MONITOR_CAPABILITY);
        if (days < MIN_SUMMARY_DAYS || days > MAX_SUMMARY_DAYS) {
            throw new BadRequestException(
                    "days must be between " + MIN_SUMMARY_DAYS + " and " + MAX_SUMMARY_DAYS);
        }
        Instant now = clock.instant();
        LocalDate today = now.atZone(ZoneOffset.UTC).toLocalDate();
        LocalDate firstDay = today.minusDays(days - 1L);
        Instant from = firstDay.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant todayStart = today.atStartOfDay(ZoneOffset.UTC).toInstant();
        SummaryData data = queryPort.summary(workspaceId, from, now, todayStart);

        Map<LocalDate, DayCount> byDay = data.days().stream()
                .collect(Collectors.toMap(DayCount::day, Function.identity()));
        List<DayCount> trend = new ArrayList<>(days);
        for (LocalDate day = firstDay; !day.isAfter(today); day = day.plusDays(1)) {
            trend.add(byDay.getOrDefault(day, new DayCount(day, 0, 0, 0)));
        }
        return new Summary(days, from, now, data.workflows(), data.runs(), successRate(data.runs()), trend,
                data.topFailing(), data.recentFailures());
    }

    /** SUCCESS / (SUCCESS + FAILED), 4 decimals; null when no run has finished. */
    static Double successRate(RunCounts runs) {
        long finished = runs.success() + runs.failed();
        if (finished == 0) {
            return null;
        }
        return BigDecimal.valueOf(runs.success()).divide(BigDecimal.valueOf(finished), 4, RoundingMode.HALF_UP)
                .doubleValue();
    }

    public record Summary(int days, Instant from, Instant to, MonitoringQueryPort.WorkflowCounts workflows,
                          RunCounts runs, Double successRate, List<DayCount> trend,
                          List<MonitoringQueryPort.FailingWorkflow> topFailing,
                          List<MonitoringQueryPort.RunItem> recentFailures) {
    }
}
