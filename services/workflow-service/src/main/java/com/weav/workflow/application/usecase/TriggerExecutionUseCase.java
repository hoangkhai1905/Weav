package com.weav.workflow.application.usecase;

import com.weav.workflow.application.dto.ExecutionResultDto;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import org.springframework.stereotype.Service;

/** Application entry points for user-triggered and registered automatic admissions. */
@Service
public final class TriggerExecutionUseCase {
    private final ExecutionAdmissionService admissionService;

    public TriggerExecutionUseCase(ExecutionAdmissionService admissionService) {
        this.admissionService = Objects.requireNonNull(admissionService);
    }

    public ExecutionResultDto manual(UUID workspaceId, UUID workflowId, UUID actorId, Object input,
                                     String correlationId, String traceparent) {
        return ExecutionResultDto.from(admissionService.manual(
                workspaceId, workflowId, actorId, input, correlationId, traceparent));
    }

    public ExecutionResultDto automatic(UUID triggerId, Object input, Instant scheduledAt,
                                        String correlationId, String traceparent) {
        return ExecutionResultDto.from(admissionService.automatic(
                triggerId, input, scheduledAt, correlationId, traceparent));
    }
}
