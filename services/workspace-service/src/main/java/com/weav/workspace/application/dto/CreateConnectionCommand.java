package com.weav.workspace.application.dto;

import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record CreateConnectionCommand(
        UUID workspaceId,
        UUID actorUserId,
        String name,
        ConnectionProvider provider,
        ConnectionAuthType authType,
        Map<String, Object> config) {

    public CreateConnectionCommand {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        config = config == null ? Map.of() : Map.copyOf(config);
    }
}
