package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Read-only workflow-schema lookups for the weav.workflow node and the workflow-event trigger. */
public interface ControlBotStore {

    /** Who published the version a run executes, and which workflow it belongs to. */
    Optional<RunOrigin> runOrigin(UUID executionId);

    /** Non-deleted workflows of the workspace, newest first. */
    List<WorkflowRef> workflows(UUID workspaceId);

    /** Ids from {@code ids} that are non-deleted workflows of the workspace. */
    Set<UUID> existingWorkflowIds(UUID workspaceId, Set<UUID> ids);

    Optional<LastRun> lastFinishedRun(UUID workflowId);

    /** SUCCESS / (SUCCESS + FAILED) of runs created since {@code since}; null when none finished. */
    Double successRate(UUID workflowId, Instant since);

    /** The finished run behind an execution id (SUCCESS, FAILED or CANCELLED), or empty. */
    Optional<FinishedSource> finishedSource(UUID executionId);

    /** Active WORKFLOW_EVENT registrations of the current version of PUBLISHED workflows in the workspace. */
    List<EventListener> eventListeners(UUID workspaceId);

    /** {@code triggerType} and {@code idempotencyKey} are those of the run itself (the chained-run marker). */
    record RunOrigin(UUID executionId, UUID workflowId, UUID workspaceId, UUID publishedBy,
                     ExecutionTriggerType triggerType, String idempotencyKey) {
    }

    record WorkflowRef(UUID id, String name, WorkflowStatus status) {
    }

    record LastRun(UUID executionId, ExecutionStatus status, Instant finishedAt) {
    }

    record FinishedSource(UUID executionId, UUID workflowId, UUID workspaceId, String workflowName,
                          ExecutionStatus status, ExecutionTriggerType triggerType, String errorCode,
                          String errorMessage, Instant startedAt, Instant finishedAt, String idempotencyKey) {
    }

    record EventListener(UUID triggerId, UUID workflowId, Map<String, Object> config) {
    }
}
