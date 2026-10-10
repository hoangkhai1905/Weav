package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.ExecutionStatePort.CancelResult;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

/** W6-C3: authorizes and records a request to stop a run. */
@Service
public final class ExecutionCancelService {
    private static final Logger LOGGER = LoggerFactory.getLogger(ExecutionCancelService.class);
    private static final String RUN_CAPABILITY = "WORKFLOW_RUN";

    private final WorkspaceAuthorization workspaceAuthorization;
    private final ExecutionStatePort state;
    private final Clock clock;

    public ExecutionCancelService(WorkspaceAuthorization workspaceAuthorization, ExecutionStatePort state,
                                  @Qualifier("workflowExecutionClock") Clock clock) {
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization);
        this.state = Objects.requireNonNull(state);
        this.clock = Objects.requireNonNull(clock);
    }

    /** CANCELLED (a queued run ended at once) or REQUESTED (the runner stops it between nodes). */
    public CancelResult cancel(UUID workspaceId, UUID workflowId, UUID executionId, UUID actorId) {
        workspaceAuthorization.require(workspaceId, actorId, RUN_CAPABILITY);
        CancelResult result = state.requestCancel(workspaceId, workflowId, executionId, clock.instant());
        switch (result) {
            case NOT_FOUND -> throw new ResourceNotFoundException("Execution", executionId);
            case ALREADY_FINISHED -> throw new ExecutionAlreadyFinishedException();
            default -> LOGGER.info("Execution {} stop {} (workflow {}, actor {})", executionId, result,
                    workflowId, actorId);
        }
        return result;
    }
}
