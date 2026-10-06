package com.weav.workflow.infrastructure.files;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;

import java.util.UUID;

/** Used when the file store settings are missing: file features fail with DEPENDENCY_NOT_CONFIGURED. */
public final class UnavailableWorkflowFileStore implements WorkflowFileStore {

    @Override
    public boolean configured() {
        return false;
    }

    @Override
    public FileReference store(UUID workspaceId, UUID executionId, String filename, String mimeType, byte[] bytes) {
        throw notConfigured();
    }

    @Override
    public StoredFile read(UUID workspaceId, String fileId) {
        throw notConfigured();
    }

    @Override
    public int purgeExpired(int limit) {
        return 0;
    }

    private static NodeExecutor.Failure notConfigured() {
        return new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "The workflow file store is not configured.", false);
    }
}
