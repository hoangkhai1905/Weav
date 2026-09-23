package com.weav.workflow.application.port.out;

import java.util.UUID;

/** Documented Workflow-facing operations owned by Workspace. */
public interface WorkspaceConnectionPort {

    void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId);

    ResolvedConnection resolve(UUID workspaceId, UUID connectionId);

    void reportAuthenticationRejected(UUID workspaceId, UUID connectionId);
}
