package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import java.util.Optional;
import java.util.UUID;

public interface WorkflowExecutionRepository { WorkflowExecution save(WorkflowExecution execution); Optional<WorkflowExecution> findById(UUID id); }