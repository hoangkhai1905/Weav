package com.weav.workspace.presentation.http.request;

import com.weav.workspace.application.dto.SaveCredentialCommand;
import jakarta.validation.constraints.NotNull;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record SaveCredentialRequest(
        @NotNull Map<String, Object> payload,
        Instant expiresAt) {

    public SaveCredentialCommand toCommand(UUID actorUserId, UUID workspaceId, UUID connectionId) {
        return new SaveCredentialCommand(workspaceId, actorUserId, connectionId, payload, expiresAt);
    }

    @Override
    public String toString() {
        return "SaveCredentialRequest[workspaceId=<request>, payload=<redacted>, expiresAt=" + expiresAt + "]";
    }
}
