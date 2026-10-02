package com.weav.workflow.application.dto;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import java.util.Objects;
import java.util.UUID;

/** Compact result returned once the execution and its outbox intent commit. */
public record ExecutionResultDto(UUID executionId, UUID workflowId, UUID workflowVersionId,
                                 ExecutionStatus status) {
    public ExecutionResultDto {
        Objects.requireNonNull(executionId, "executionId must not be null");
        Objects.requireNonNull(workflowId, "workflowId must not be null");
        Objects.requireNonNull(workflowVersionId, "workflowVersionId must not be null");
        Objects.requireNonNull(status, "status must not be null");
    }

    public static ExecutionResultDto from(ExecutionAdmissionPort.Admission admission) {
        Objects.requireNonNull(admission, "admission must not be null");
        return new ExecutionResultDto(admission.executionId(), admission.workflowId(),
                admission.workflowVersionId(), admission.status());
    }
}
