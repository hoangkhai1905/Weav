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
                   String correlationId, String traceparent, String idempotencyKey, String requestHash) {
        /** Admission without an idempotency key. */
        public Command(UUID workspaceId, UUID workflowId, UUID actorId, UUID triggerId,
                       ExecutionTriggerType triggerType, Object input, Instant scheduledAt,
                       String correlationId, String traceparent) {
            this(workspaceId, workflowId, actorId, triggerId, triggerType, input, scheduledAt,
                    correlationId, traceparent, null, null);
        }
    }

    record Admission(UUID executionId, UUID workflowId, UUID workflowVersionId, ExecutionStatus status) {
    }
}
