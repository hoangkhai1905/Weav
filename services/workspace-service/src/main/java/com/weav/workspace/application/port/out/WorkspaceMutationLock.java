package com.weav.workspace.application.port.out;

import java.util.UUID;

/** Serializes state-sensitive mutations by locking the existing Workspace row. */
public interface WorkspaceMutationLock {
    void lock(UUID workspaceId);
}
