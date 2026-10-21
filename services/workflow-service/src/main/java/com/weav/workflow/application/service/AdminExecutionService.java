package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.AdminExecutionQueryPort;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminCounts;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminFailingWorkflow;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminRunDetail;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminRunPage;
import com.weav.workflow.application.port.out.MonitoringQueryPort.DayCount;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunFilter;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

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

/** Cross-workspace run history for system admins; the caller (controller) enforces the ADMIN role. */
@Service
public final class AdminExecutionService {
    public static final int MIN_SUMMARY_HOURS = 1;
    public static final int MAX_SUMMARY_HOURS = 168;
    public static final int MIN_TREND_DAYS = 1;
    public static final int MAX_TREND_DAYS = 30;
    public static final int TOP_FAILING_LIMIT = 5;

    private final AdminExecutionQueryPort queryPort;
    private final Clock clock;

    public AdminExecutionService(AdminExecutionQueryPort queryPort,
                                 @Qualifier("workflowExecutionClock") Clock clock) {
        this.queryPort = Objects.requireNonNull(queryPort);
        this.clock = Objects.requireNonNull(clock);
    }

    public AdminRunPage history(ExecutionStatus status, UUID workspaceId, Instant from, Instant to,
                                int page, int size) {
        MonitoringService.RunRange range = MonitoringService.validateRunRange(page, size, from, to, clock.instant());
        return queryPort.history(workspaceId, new RunFilter(status, null, range.from(), range.to()), page, size);
    }

    public AdminRunDetail detail(UUID executionId) {
        return queryPort.detail(executionId).orElseThrow(() -> new ResourceNotFoundException("Execution not found"));
    }

    public Summary summary(int hours, int days) {
        if (hours < MIN_SUMMARY_HOURS || hours > MAX_SUMMARY_HOURS) {
            throw new BadRequestException("hours must be between " + MIN_SUMMARY_HOURS + " and " + MAX_SUMMARY_HOURS);
        }
        if (days < MIN_TREND_DAYS || days > MAX_TREND_DAYS) {
            throw new BadRequestException("days must be between " + MIN_TREND_DAYS + " and " + MAX_TREND_DAYS);
        }
        Instant to = clock.instant();
        Instant from = to.minus(Duration.ofHours(hours));
        LocalDate today = to.atZone(ZoneOffset.UTC).toLocalDate();
        LocalDate firstDay = today.minusDays(days - 1L);
        Instant trendFrom = firstDay.atStartOfDay(ZoneOffset.UTC).toInstant();

        Map<LocalDate, DayCount> byDay = queryPort.dayCounts(trendFrom, to).stream()
                .collect(Collectors.toMap(DayCount::day, Function.identity()));
        List<DayCount> trend = new ArrayList<>(days);
        for (LocalDate day = firstDay; !day.isAfter(today); day = day.plusDays(1)) {
            trend.add(byDay.getOrDefault(day, new DayCount(day, 0, 0, 0)));
        }
        return new Summary(hours, from, to, queryPort.counts(from, to), trend,
                queryPort.topFailing(trendFrom, to, TOP_FAILING_LIMIT));
    }

    /**
     * Run counts over [from, to) where from = to - hours; {@code trend} (one entry per UTC day, oldest first,
     * zero-filled) and {@code topFailing} cover the {@code days} UTC days ending today.
     */
    public record Summary(int hours, Instant from, Instant to, AdminCounts counts, List<DayCount> trend,
                          List<AdminFailingWorkflow> topFailing) {
    }
}
