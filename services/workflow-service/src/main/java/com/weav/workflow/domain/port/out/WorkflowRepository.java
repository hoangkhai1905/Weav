package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import java.util.Optional;
import java.util.UUID;

public interface WorkflowRepository { Workflow save(Workflow workflow); Optional<Workflow> findById(UUID id); }