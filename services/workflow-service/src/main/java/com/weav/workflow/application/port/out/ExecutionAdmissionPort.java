package com.weav.workflow.application.port.out;

import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import java.time.Instant;
import java.util.UUID;

/** Atomic persistence boundary for admitting an execution and its outbox intent. */
public interface ExecutionAdmissionPort {
    Admission create(Command command);

    record Command(UUID workspaceId, UUID workflowId, UUID actorId, UUID triggerId,
                   ExecutionTriggerType triggerType, Object input, Instant scheduledAt,
                   String correlationId, String traceparent) {
    }

    record Admission(UUID executionId, UUID workflowId, UUID workflowVersionId, ExecutionStatus status) {
    }
}
