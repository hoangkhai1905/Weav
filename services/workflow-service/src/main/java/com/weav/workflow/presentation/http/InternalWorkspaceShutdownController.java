package com.weav.workflow.presentation.http;

import com.weav.workflow.application.service.WorkspaceShutdownService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Objects;
import java.util.UUID;

/** Workspace-service-only route (service key checked by {@code InternalServiceKeyFilter}). */
@RestController
public final class InternalWorkspaceShutdownController {

    private final WorkspaceShutdownService shutdown;

    public InternalWorkspaceShutdownController(WorkspaceShutdownService shutdown) {
        this.shutdown = Objects.requireNonNull(shutdown, "shutdown must not be null");
    }

    @PostMapping("/internal/workspaces/{workspaceId}/pause-all")
    public WorkspaceShutdownService.Result pauseAll(@PathVariable UUID workspaceId) {
        return shutdown.pauseAll(workspaceId);
    }
}
