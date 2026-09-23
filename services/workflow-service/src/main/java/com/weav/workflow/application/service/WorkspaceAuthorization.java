package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Enforces the exact capabilities returned by Workspace without role policy duplication. */
@Service
public final class WorkspaceAuthorization {

    private final WorkspaceAccessPort workspaceAccess;

    public WorkspaceAuthorization(WorkspaceAccessPort workspaceAccess) {
        this.workspaceAccess = Objects.requireNonNull(workspaceAccess, "workspaceAccess must not be null");
    }

    public void require(UUID workspaceId, UUID userId, String capability) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        if (capability == null || capability.isBlank()) {
            throw new IllegalArgumentException("capability must not be blank");
        }

        WorkspaceAccessPort.Access access = workspaceAccess.getAccess(workspaceId, userId);
        if (access == null
                || !workspaceId.equals(access.workspaceId())
                || !userId.equals(access.userId())) {
            throw new WorkspaceDependencyUnavailableException();
        }
        if (!access.capabilities().contains(capability)) {
            throw new ForbiddenException();
        }
    }
}
