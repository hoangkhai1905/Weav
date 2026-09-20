package com.weav.workspace.presentation.http.request;

import com.weav.workspace.application.dto.CreateConnectionCommand;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.Map;
import java.util.UUID;

public record CreateConnectionRequest(
        @NotBlank @Size(max = 120) String name,
        @NotNull ConnectionProvider provider,
        @NotNull ConnectionAuthType authType,
        Map<String, Object> config) {

    public CreateConnectionCommand toCommand(UUID workspaceId, UUID actorUserId) {
        return new CreateConnectionCommand(workspaceId, actorUserId, name, provider, authType, config);
    }

    @Override
    public String toString() {
        return "CreateConnectionRequest[name=" + name + ", provider=" + provider
                + ", authType=" + authType + ", config=<redacted>]";
    }
}
