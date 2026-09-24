package com.weav.workflow.application.usecase;

import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import java.util.Objects;
import org.springframework.stereotype.Service;

@Service
public class CreateWorkflowUseCase {

    private final WorkflowRepository workflowRepository;

    public CreateWorkflowUseCase(WorkflowRepository workflowRepository) {
        this.workflowRepository = Objects.requireNonNull(workflowRepository, "workflowRepository must not be null");
    }

    public Workflow execute(CreateWorkflowCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        Workflow workflow = Workflow.createDraft(
                command.workspaceId(), command.name(), command.description(), command.actorId());
        return workflowRepository.save(workflow);
    }
}
