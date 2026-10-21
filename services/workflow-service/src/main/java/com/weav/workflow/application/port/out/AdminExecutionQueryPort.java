package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.valueobject.NodeExecutionStatus;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Read-only, cross-workspace run queries for system admins (UC028). Never exposes node payloads. */
public interface AdminExecutionQueryPort {

    /** Runs of non-deleted workflows, newest first; a null workspace id means every workspace. */
    AdminRunPage history(UUID workspaceIdOrNull, MonitoringQueryPort.RunFilter filter, int page, int size);

    /** Empty when the run does not exist or its workflow is deleted. */
    Optional<AdminRunDetail> detail(UUID executionId);

    /** Counts the runs created in [from, to). */
    AdminCounts counts(Instant from, Instant to);

    record AdminRunItem(MonitoringQueryPort.RunItem run, UUID workspaceId) {
    }

    record AdminRunPage(List<AdminRunItem> items, int page, int size, long totalElements) {
        public AdminRunPage {
            items = List.copyOf(items);
        }
    }

    record AdminStep(String nodeId, String nodeType, NodeExecutionStatus status, int attemptCount,
                     Instant startedAt, Instant finishedAt, String errorCode, String errorMessage) {
    }

    record AdminRunDetail(AdminRunItem run, List<AdminStep> steps) {
        public AdminRunDetail {
            steps = List.copyOf(steps);
        }
    }

    record AdminCounts(long total, long success, long failed, long active) {
    }
}
