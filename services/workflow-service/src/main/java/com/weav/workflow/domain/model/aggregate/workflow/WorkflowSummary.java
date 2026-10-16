package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.valueobject.WorkflowStatus;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** List-view projection of a workflow: no draft definition or editor state, only the node types in it. */
public record WorkflowSummary(UUID id, String name, String description, WorkflowStatus status,
                              String schemaVersion, UUID currentVersionId, Instant createdAt,
                              Instant updatedAt, Instant publishedAt, List<String> nodeTypes) {
    public WorkflowSummary {
        nodeTypes = List.copyOf(nodeTypes);
    }
}
