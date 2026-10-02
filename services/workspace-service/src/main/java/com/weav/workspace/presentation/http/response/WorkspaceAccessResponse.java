package com.weav.workspace.presentation.http.response;

import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;
import com.weav.workspace.domain.model.WorkspaceCapability;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.List;
import java.util.UUID;

public record WorkspaceAccessResponse(
        UUID workspaceId,
        UUID userId,
        MembershipRole role,
        List<WorkspaceCapability> capabilities) {

    public static WorkspaceAccessResponse from(WorkspaceAccessSnapshot snapshot) {
        return new WorkspaceAccessResponse(
                snapshot.workspaceId(),
                snapshot.userId(),
                snapshot.role(),
                snapshot.capabilities().stream().sorted().toList());
    }
}
