package com.weav.workspace.presentation.http.request;

import com.weav.workspace.application.dto.UpdateConnectionCommand;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.Map;
import java.util.UUID;

public record UpdateConnectionRequest(
        @Pattern(regexp = ".*\\S.*", message = "name must not be blank")
        @Size(max = 120) String name,
        Map<String, Object> config) {

    @AssertTrue(message = "At least one connection field must be provided")
    public boolean isValidPatch() {
        return name != null || config != null;
    }

    public UpdateConnectionCommand toCommand(UUID actorUserId, UUID workspaceId, UUID connectionId) {
        return new UpdateConnectionCommand(workspaceId, actorUserId, connectionId, name, config);
    }

    @Override
    public String toString() {
        return "UpdateConnectionRequest[name=" + name + ", config=<redacted>]";
    }
}
