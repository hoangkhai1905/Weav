package com.weav.workspace.application.dto;

import java.util.Objects;
import java.util.UUID;

public record UpdateMemberPermissionsCommand(
        UUID workspaceId,
        UUID actorUserId,
        UUID targetUserId,
        boolean canPublishWorkflow,
        boolean canManageWorkflowState) {

    public UpdateMemberPermissionsCommand {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(targetUserId, "targetUserId must not be null");
    }
}
