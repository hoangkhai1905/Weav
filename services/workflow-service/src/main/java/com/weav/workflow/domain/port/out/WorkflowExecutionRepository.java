package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkflowExecutionRepository {
    WorkflowExecution save(WorkflowExecution execution);

    Optional<WorkflowExecution> findById(UUID id);

    /** One query for several executions; ids that do not exist are simply absent from the result. */
    List<WorkflowExecution> findAllById(Collection<UUID> ids);
}
