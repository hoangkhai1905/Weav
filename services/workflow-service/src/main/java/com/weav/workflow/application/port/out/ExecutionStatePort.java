package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.model.aggregate.execution.ExecutionLog;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.valueobject.ExecutionStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Fenced ownership and durable state access for one workflow execution. */
public interface ExecutionStatePort {
    Optional<Lease> claim(UUID executionId, String owner, Duration leaseDuration);

    boolean renew(Lease lease, Duration leaseDuration);

    Snapshot load(Lease lease);

    boolean commit(Lease lease, Transition transition);

    void release(Lease lease);

    record Lease(UUID executionId, String owner, long token) {
        public Lease {
            Objects.requireNonNull(executionId, "executionId");
            if (owner == null || owner.isBlank() || owner.length() > 128) {
                throw new IllegalArgumentException("Lease owner must be nonblank and at most 128 characters");
            }
            if (token < 1) {
                throw new IllegalArgumentException("Lease token must be positive");
            }
        }
    }

    record Snapshot(UUID workflowId, UUID workspaceId, WorkflowVersion version,
                    WorkflowDefinition definition, String firingRoot, Object input, GraphState graph,
                    Map<String, NodeExecution> nodes, List<NodeExecutionAttempt> attempts,
                    Map<String, Instant> nextAttempts, String correlationId, String traceparent,
                    ExecutionStatus status) {
        public Snapshot {
            Objects.requireNonNull(workflowId, "workflowId");
            Objects.requireNonNull(workspaceId, "workspaceId");
            Objects.requireNonNull(version, "version");
            Objects.requireNonNull(definition, "definition");
            Objects.requireNonNull(firingRoot, "firingRoot");
            input = JsonValues.freeze(input);
            Objects.requireNonNull(graph, "graph");
            nodes = Map.copyOf(Objects.requireNonNull(nodes, "nodes"));
            attempts = List.copyOf(Objects.requireNonNull(attempts, "attempts"));
            nextAttempts = Map.copyOf(Objects.requireNonNull(nextAttempts, "nextAttempts"));
            Objects.requireNonNull(status, "status");
        }
    }

    record Transition(GraphState graph, List<NodeExecution> nodes,
                      List<NodeExecutionAttempt> attempts, Map<String, Instant> nextAttempts,
                      ExecutionStatus status, Map<String, Object> output, Map<String, Object> error,
                      Instant finishedAt, List<ExecutionLog> logs) {
        public Transition {
            Objects.requireNonNull(graph, "graph");
            nodes = List.copyOf(Objects.requireNonNull(nodes, "nodes"));
            attempts = List.copyOf(Objects.requireNonNull(attempts, "attempts"));
            nextAttempts = Map.copyOf(Objects.requireNonNull(nextAttempts, "nextAttempts"));
            Objects.requireNonNull(status, "status");
            output = freezeOptionalMap(output);
            error = freezeOptionalMap(error);
            logs = List.copyOf(Objects.requireNonNull(logs, "logs"));
        }
    }

    private static Map<String, Object> freezeOptionalMap(Map<String, Object> value) {
        return value == null ? null : JsonValues.freezeMap(value);
    }
}
