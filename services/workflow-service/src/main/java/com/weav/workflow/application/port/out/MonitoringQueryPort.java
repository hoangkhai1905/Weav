package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** Read-only, workspace-scoped aggregates for run history and the monitoring summary. */
public interface MonitoringQueryPort {

    RunPage history(UUID workspaceId, RunFilter filter, int page, int size);

    /** Aggregates the runs created in [from, to); {@code todayStart} splits out the "today" counter. */
    SummaryData summary(UUID workspaceId, Instant from, Instant to, Instant todayStart);

    /** All fields are optional; a null field does not filter. */
    record RunFilter(ExecutionStatus status, UUID workflowId, Instant from, Instant to) {
    }

    record RunPage(List<RunItem> items, int page, int size, long totalElements) {
        public RunPage {
            items = List.copyOf(items);
        }
    }

    record RunItem(UUID executionId, UUID workflowId, String workflowName, ExecutionStatus status,
                   ExecutionTriggerType triggerType, Instant createdAt, Instant startedAt, Instant finishedAt,
                   String errorCode, String errorMessage) {
    }

    record SummaryData(WorkflowCounts workflows, RunCounts runs, List<DayCount> days,
                       List<FailingWorkflow> topFailing, List<RunItem> recentFailures) {
        public SummaryData {
            days = List.copyOf(days);
            topFailing = List.copyOf(topFailing);
            recentFailures = List.copyOf(recentFailures);
        }
    }

    record WorkflowCounts(long published, long paused, long draft) {
    }

    /** {@code avgDurationMs}/{@code p95DurationMs} are over finished (SUCCESS/FAILED) runs with both timestamps. */
    record RunCounts(long total, long today, long success, long failed, long active,
                     Long avgDurationMs, Long p95DurationMs) {
    }

    record DayCount(LocalDate day, long total, long success, long failed) {
    }

    record FailingWorkflow(UUID workflowId, String workflowName, long failures, Instant lastFailureAt) {
    }
}
