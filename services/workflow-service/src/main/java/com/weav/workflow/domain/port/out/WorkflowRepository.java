package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkflowRepository {

    Workflow save(Workflow workflow);

    Optional<Workflow> findById(UUID id);

    Optional<Workflow> findByWorkspaceAndId(UUID workspaceId, UUID workflowId);

    List<Workflow> findPage(UUID workspaceId, int page, int size);

    long countByWorkspace(UUID workspaceId);

    Optional<Workflow> lockByWorkspaceAndId(UUID workspaceId, UUID workflowId);

    Optional<Workflow> lockById(UUID workflowId);

    /** As {@link #lockById(UUID)}, but every lock wait in the current transaction fails after {@code lockTimeout}. */
    Optional<Workflow> lockById(UUID workflowId, java.time.Duration lockTimeout);

    /** Ids of the workspace's undeleted workflows in {@code status}, oldest first (workspace shutdown). */
    List<UUID> findIdsByWorkspaceAndStatus(UUID workspaceId, com.weav.workflow.domain.valueobject.WorkflowStatus status);
}
