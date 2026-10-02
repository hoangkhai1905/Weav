package com.weav.workspace.application.dto;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Input for a manual credential replacement. The payload is write-only. */
public record SaveCredentialCommand(
        UUID workspaceId,
        UUID actorUserId,
        UUID connectionId,
        Map<String, Object> payload,
        Instant expiresAt) {

    public SaveCredentialCommand {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        payload = payload == null
                ? null
                : Collections.unmodifiableMap(new LinkedHashMap<>(payload));
    }

    @Override
    public String toString() {
        return "SaveCredentialCommand[workspaceId=" + workspaceId
                + ", actorUserId=" + actorUserId
                + ", connectionId=" + connectionId
                + ", payload=<redacted>"
                + ", expiresAt=" + expiresAt + "]";
    }
}
