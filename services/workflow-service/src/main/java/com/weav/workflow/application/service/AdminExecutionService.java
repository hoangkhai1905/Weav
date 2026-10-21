package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.AdminExecutionQueryPort;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminCounts;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminRunDetail;
import com.weav.workflow.application.port.out.AdminExecutionQueryPort.AdminRunPage;
import com.weav.workflow.application.port.out.MonitoringQueryPort.RunFilter;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Cross-workspace run history for system admins; the caller (controller) enforces the ADMIN role. */
@Service
public final class AdminExecutionService {
    public static final int MIN_SUMMARY_HOURS = 1;
    public static final int MAX_SUMMARY_HOURS = 168;

    private final AdminExecutionQueryPort queryPort;
    private final Clock clock;

    public AdminExecutionService(AdminExecutionQueryPort queryPort,
                                 @Qualifier("workflowExecutionClock") Clock clock) {
        this.queryPort = Objects.requireNonNull(queryPort);
        this.clock = Objects.requireNonNull(clock);
    }

    public AdminRunPage history(ExecutionStatus status, UUID workspaceId, Instant from, Instant to,
                                int page, int size) {
        if (page < 0 || size < 1 || size > MonitoringService.MAX_PAGE_SIZE || (long) page * size > Integer.MAX_VALUE) {
            throw new BadRequestException("Execution page bounds are invalid");
        }
        // Same window rules as MonitoringService.history: the cap always applies; a missing "to" stays open.
        int maxDays = MonitoringService.MAX_RANGE_DAYS;
        Instant upper = to != null ? to : clock.instant();
        Instant lower = from != null ? from : upper.minus(Duration.ofDays(maxDays));
        if (!lower.isBefore(upper) || Duration.between(lower, upper).compareTo(Duration.ofDays(maxDays)) > 0) {
            throw new BadRequestException("The time range must be positive and at most " + maxDays + " days");
        }
        return queryPort.history(workspaceId, new RunFilter(status, null, lower, to), page, size);
    }

    public AdminRunDetail detail(UUID executionId) {
        return queryPort.detail(executionId).orElseThrow(() -> new ResourceNotFoundException("Execution not found"));
    }

    public Summary summary(int hours) {
        if (hours < MIN_SUMMARY_HOURS || hours > MAX_SUMMARY_HOURS) {
            throw new BadRequestException("hours must be between " + MIN_SUMMARY_HOURS + " and " + MAX_SUMMARY_HOURS);
        }
        Instant to = clock.instant();
        Instant from = to.minus(Duration.ofHours(hours));
        return new Summary(hours, from, to, queryPort.counts(from, to));
    }

    /** Run counts over [from, to) where from = to - hours. */
    public record Summary(int hours, Instant from, Instant to, AdminCounts counts) {
    }
}
