package com.weav.workflow.infrastructure.files;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/** In-memory store for tests: stores and reads bytes, can be switched off or made to fail. */
public final class InMemoryFileStore implements WorkflowFileStore {
    public final Map<String, StoredFile> files = new LinkedHashMap<>();
    public boolean configured = true;
    public UUID lastWorkspace;
    public UUID lastExecution;

    @Override
    public boolean configured() {
        return configured;
    }

    @Override
    public FileReference store(UUID workspaceId, UUID executionId, String filename, String mimeType, byte[] bytes) {
        if (!configured) {
            throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "File store is not configured.", false);
        }
        lastWorkspace = workspaceId;
        lastExecution = executionId;
        FileReference reference = new FileReference(UUID.randomUUID().toString(), filename, mimeType, bytes.length);
        files.put(reference.fileId(), new StoredFile(reference, bytes));
        return reference;
    }

    @Override
    public StoredFile read(UUID workspaceId, String fileId) {
        lastWorkspace = workspaceId;
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

    public FileReference put(String fileId, String filename, String mimeType, byte[] bytes) {
        FileReference reference = new FileReference(fileId, filename, mimeType, bytes.length);
        files.put(fileId, new StoredFile(reference, bytes));
        return reference;
    }
}
