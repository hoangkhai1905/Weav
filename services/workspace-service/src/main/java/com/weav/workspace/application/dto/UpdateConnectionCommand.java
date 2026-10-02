package com.weav.workspace.application.dto;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Partial connection update. A null name/config means that field was omitted
 * from the patch. An empty config map is therefore a deliberate replacement.
 */
public record UpdateConnectionCommand(
        UUID workspaceId,
        UUID actorUserId,
        UUID connectionId,
        String name,
        Map<String, Object> config) {

    public UpdateConnectionCommand {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        config = config == null ? null : Map.copyOf(config);
    }

    public boolean hasName() {
        return name != null;
    }

    public boolean hasConfig() {
        return config != null;
    }
}
