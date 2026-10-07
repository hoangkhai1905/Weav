package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** In-memory store for email tests; a missing id is FILE_NOT_FOUND, an unconfigured one DEPENDENCY_NOT_CONFIGURED. */
final class FakeFileStore implements WorkflowFileStore {
    final Map<String, StoredFile> files = new HashMap<>();
    boolean configured = true;
    UUID readWorkspace;

    @Override
    public boolean configured() {
        return configured;
    }

    @Override
    public FileReference store(UUID workspaceId, UUID executionId, String filename, String mimeType, byte[] bytes) {
        throw new UnsupportedOperationException();
    }

    @Override
    public StoredFile read(UUID workspaceId, String fileId) {
        readWorkspace = workspaceId;
        if (!configured) {
            throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "File store is not configured.", false);
        }
        StoredFile file = files.get(fileId);
        if (file == null) {
            throw new NodeExecutor.Failure("FILE_NOT_FOUND", "The file was not found.", false);
        }
        return file;
    }

    @Override
    public int purgeExpired(int limit) {
        return 0;
    }

    FileReference put(String fileId, String filename, String mimeType, byte[] bytes) {
        FileReference reference = new FileReference(fileId, filename, mimeType, bytes.length);
        files.put(fileId, new StoredFile(reference, bytes));
        return reference;
    }
}
