package com.weav.workspace.application.dto;

import java.util.Objects;
import java.util.UUID;

public record AddMemberCommand(UUID workspaceId, UUID actorUserId, String email) {

    public AddMemberCommand {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
    }
}
