package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ExecutionQueryPort;
import com.weav.workflow.domain.exception.BadRequestException;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Authorizes monitoring reads before delegating to bounded, scoped projections. */
@Service
public final class ExecutionQueryService {
    private static final String MONITOR_CAPABILITY = "WORKFLOW_MONITOR";
    private static final int DEFAULT_LOG_PAGE = 0;
    private static final int DEFAULT_LOG_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final WorkspaceAuthorization workspaceAuthorization;
    private final ExecutionQueryPort queryPort;

    public ExecutionQueryService(WorkspaceAuthorization workspaceAuthorization, ExecutionQueryPort queryPort) {
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization,
                "workspaceAuthorization must not be null");
        this.queryPort = Objects.requireNonNull(queryPort, "queryPort must not be null");
    }

    public ExecutionQueryPort.ExecutionPage list(UUID workspaceId, UUID workflowId, UUID actorId,
                                                  int page, int size) {
        workspaceAuthorization.require(workspaceId, actorId, MONITOR_CAPABILITY);
        validatePage(page, size, "Execution page");
        return queryPort.list(workspaceId, workflowId, page, size);
    }

    public ExecutionQueryPort.ExecutionDetail detail(UUID workspaceId, UUID workflowId, UUID executionId,
                                                     UUID actorId) {
        return detail(workspaceId, workflowId, executionId, actorId, DEFAULT_LOG_PAGE, DEFAULT_LOG_SIZE);
    }

    public ExecutionQueryPort.ExecutionDetail detail(UUID workspaceId, UUID workflowId, UUID executionId,
                                                     UUID actorId, int logPage, int logSize) {
        workspaceAuthorization.require(workspaceId, actorId, MONITOR_CAPABILITY);
        validatePage(logPage, logSize, "Execution log page");
        return queryPort.detail(workspaceId, workflowId, executionId, actorId, logPage, logSize);
    }

    private void validatePage(int page, int size, String name) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new BadRequestException(name + " bounds are invalid");
        }
        long offset = (long) page * size;
        if (offset > Integer.MAX_VALUE) {
            throw new BadRequestException(name + " offset is out of range");
        }
    }
}
