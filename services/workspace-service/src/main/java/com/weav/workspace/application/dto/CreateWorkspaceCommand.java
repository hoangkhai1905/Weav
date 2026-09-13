package com.weav.workspace.application.dto;

import java.util.Objects;
import java.util.UUID;

public record CreateWorkspaceCommand(UUID actorUserId, String name) {

    public CreateWorkspaceCommand {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
    }

    public boolean hasExplicitName() {
        return name != null;
    }
}
