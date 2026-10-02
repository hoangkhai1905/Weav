package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;

import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Read-only, workspace-scoped execution projections for the monitoring API. */
public interface ExecutionQueryPort {

    ExecutionPage list(UUID workspaceId, UUID workflowId, int page, int size);

    default ExecutionDetail detail(UUID workspaceId, UUID workflowId, UUID executionId, UUID actorId) {
        return detail(workspaceId, workflowId, executionId, actorId, 0, 20);
    }

    ExecutionDetail detail(UUID workspaceId, UUID workflowId, UUID executionId, UUID actorId,
                           int logPage, int logSize);

    record ExecutionPage(List<ExecutionSummary> items, int page, int size, long totalElements) {
        public ExecutionPage {
            items = List.copyOf(Objects.requireNonNull(items, "items must not be null"));
            if (page < 0 || size < 1 || size > 100 || totalElements < 0) {
                throw new IllegalArgumentException("Execution page bounds are invalid");
            }
        }
    }

    record ExecutionSummary(UUID executionId, UUID workflowId, UUID workflowVersionId,
                            ExecutionStatus status, ExecutionTriggerType triggerType,
                            Instant createdAt, Instant startedAt, Instant finishedAt) {
        public ExecutionSummary {
            Objects.requireNonNull(executionId, "executionId must not be null");
            Objects.requireNonNull(workflowId, "workflowId must not be null");
            Objects.requireNonNull(workflowVersionId, "workflowVersionId must not be null");
            Objects.requireNonNull(status, "status must not be null");
            Objects.requireNonNull(triggerType, "triggerType must not be null");
            Objects.requireNonNull(createdAt, "createdAt must not be null");
        }
    }

    record ExecutionDetail(ExecutionSummary summary, List<NodeState> nodes, LogPage logs) {
        public ExecutionDetail {
            summary = Objects.requireNonNull(summary, "summary must not be null");
            nodes = List.copyOf(Objects.requireNonNull(nodes, "nodes must not be null"));
            logs = Objects.requireNonNull(logs, "logs must not be null");
        }
    }

    record NodeState(UUID nodeExecutionId, String nodeId, String nodeType, NodeExecutionStatus status,
                     int attemptCount, Instant startedAt, Instant finishedAt,
                     Object output, Object error, List<AttemptState> attempts) {
        public NodeState {
            Objects.requireNonNull(nodeExecutionId, "nodeExecutionId must not be null");
            if (nodeId == null || nodeId.isBlank() || nodeType == null || nodeType.isBlank()) {
                throw new IllegalArgumentException("Node identity must be nonblank");
            }
            Objects.requireNonNull(status, "status must not be null");
            if (attemptCount < 0) {
                throw new IllegalArgumentException("attemptCount must not be negative");
            }
            attempts = List.copyOf(Objects.requireNonNull(attempts, "attempts must not be null"));
        }
    }

    record AttemptState(UUID attemptId, int attemptNumber, AttemptStatus status,
                        Instant startedAt, Instant finishedAt, Object output, Object error) {
        public AttemptState {
            Objects.requireNonNull(attemptId, "attemptId must not be null");
            if (attemptNumber < 1) {
                throw new IllegalArgumentException("attemptNumber must be positive");
            }
            Objects.requireNonNull(status, "status must not be null");
            Objects.requireNonNull(startedAt, "startedAt must not be null");
        }
    }

    record LogPage(List<LogEntry> items, int page, int size, long totalElements, boolean hasNext) {
        public LogPage {
            items = List.copyOf(Objects.requireNonNull(items, "items must not be null"));
            if (page < 0 || size < 1 || size > 100 || totalElements < 0) {
                throw new IllegalArgumentException("Log page bounds are invalid");
            }
        }
    }

    record LogEntry(UUID id, UUID nodeExecutionId, UUID attemptId, LogLevel level,
                    String eventType, String message, Map<String, Object> metadata, Instant createdAt) {
        public LogEntry {
            Objects.requireNonNull(id, "id must not be null");
            Objects.requireNonNull(level, "level must not be null");
            if (eventType == null || eventType.isBlank()) {
                throw new IllegalArgumentException("eventType must be nonblank");
            }
            metadata = metadata == null
                    ? Map.of()
                    : Collections.unmodifiableMap(new java.util.LinkedHashMap<>(metadata));
            Objects.requireNonNull(createdAt, "createdAt must not be null");
        }
    }
}
