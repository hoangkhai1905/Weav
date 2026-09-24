package com.weav.workflow.presentation.http;

import com.weav.workflow.application.service.ConnectionUsageService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.Objects;
import java.util.UUID;

@RestController
public final class InternalConnectionUsageController {

    private final ConnectionUsageService connectionUsageService;

    public InternalConnectionUsageController(ConnectionUsageService connectionUsageService) {
        this.connectionUsageService = Objects.requireNonNull(
                connectionUsageService, "connectionUsageService must not be null");
    }

    @GetMapping("/internal/workspaces/{workspaceId}/connections/{connectionId}/usage")
    public ConnectionUsageResponse getUsage(
            @PathVariable UUID workspaceId,
            @PathVariable UUID connectionId) {
        return new ConnectionUsageResponse(connectionUsageService.lookup(workspaceId, connectionId));
    }

    public record ConnectionUsageResponse(boolean inUse) {
    }
}
