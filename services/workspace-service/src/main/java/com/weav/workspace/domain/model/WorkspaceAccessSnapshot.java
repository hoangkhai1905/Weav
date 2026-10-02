package com.weav.workspace.domain.model;

import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public record WorkspaceAccessSnapshot(
        UUID workspaceId,
        UUID userId,
        MembershipRole role,
        Set<WorkspaceCapability> capabilities) {

    private static final Set<WorkspaceCapability> MEMBER_BASELINE = Set.of(
            WorkspaceCapability.WORKSPACE_VIEW,
            WorkspaceCapability.MEMBER_VIEW,
            WorkspaceCapability.WORKFLOW_CREATE,
            WorkspaceCapability.WORKFLOW_EDIT,
            WorkspaceCapability.WORKFLOW_RUN,
            WorkspaceCapability.WORKFLOW_MONITOR);

    public WorkspaceAccessSnapshot {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(role, "role must not be null");
        capabilities = Set.copyOf(Objects.requireNonNull(capabilities, "capabilities must not be null"));
    }

    public boolean hasValidAuthorizationSchema() {
        if (role == MembershipRole.OWNER) {
            return capabilities.equals(EnumSet.allOf(WorkspaceCapability.class));
        }
        EnumSet<WorkspaceCapability> allowed = EnumSet.copyOf(MEMBER_BASELINE);
        allowed.add(WorkspaceCapability.WORKFLOW_PUBLISH);
        allowed.add(WorkspaceCapability.WORKFLOW_MANAGE_STATE);
        return capabilities.containsAll(MEMBER_BASELINE) && allowed.containsAll(capabilities);
    }
}
