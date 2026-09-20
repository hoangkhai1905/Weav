package com.weav.workspace.application.port.out;

import java.util.UUID;

/**
 * Reads the Workflow Service's authoritative connection usage state.
 *
 * <p>The port deliberately exposes only the boolean needed by Workspace
 * mutation guards. Workflow definitions and execution data stay owned by the
 * Workflow Service.</p>
 */
public interface WorkflowConnectionUsagePort {

    boolean isInUse(UUID workspaceId, UUID connectionId);
}
