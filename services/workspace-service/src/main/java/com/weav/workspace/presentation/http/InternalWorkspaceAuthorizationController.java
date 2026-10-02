package com.weav.workspace.presentation.http;

import com.weav.workspace.application.usecase.ResolveWorkspaceAccessUseCase;
import com.weav.workspace.presentation.http.response.WorkspaceAccessResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/internal/workspaces")
public final class InternalWorkspaceAuthorizationController {

    private final ResolveWorkspaceAccessUseCase resolveWorkspaceAccess;

    public InternalWorkspaceAuthorizationController(ResolveWorkspaceAccessUseCase resolveWorkspaceAccess) {
        this.resolveWorkspaceAccess = resolveWorkspaceAccess;
    }

    @GetMapping("/{workspaceId}/users/{userId}/access")
    public WorkspaceAccessResponse getAccess(
            @PathVariable UUID workspaceId,
            @PathVariable UUID userId) {
        return WorkspaceAccessResponse.from(resolveWorkspaceAccess.execute(workspaceId, userId));
    }
}
