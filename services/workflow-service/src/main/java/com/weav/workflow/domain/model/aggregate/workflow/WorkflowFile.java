package com.weav.workflow.domain.model.aggregate.workflow;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public class WorkflowFile {
    private final UUID id;
    private final UUID workspaceId;
    private final String storageKey;
    private final String fileName;
    private final String mimeType;
    private final Long sizeBytes;
    private final UUID createdBy;
    private final Instant expiresAt;
    private final Instant createdAt;
    private Instant deletedAt;

    public WorkflowFile(UUID id, UUID workspaceId, String storageKey, String fileName, String mimeType, Long sizeBytes,
                        UUID createdBy, Instant expiresAt, Instant createdAt, Instant deletedAt) {
        this.id = Objects.requireNonNull(id); this.workspaceId = Objects.requireNonNull(workspaceId);
        this.storageKey = Objects.requireNonNull(storageKey); this.fileName = fileName; this.mimeType = mimeType;
        this.sizeBytes = sizeBytes; this.createdBy = createdBy; this.expiresAt = expiresAt;
        this.createdAt = Objects.requireNonNull(createdAt); this.deletedAt = deletedAt;
    }
    public static WorkflowFile createNew(UUID workspaceId, String storageKey, String fileName, String mimeType,
                                          Long sizeBytes, UUID createdBy, Instant expiresAt) {
        return new WorkflowFile(UUID.randomUUID(), workspaceId, storageKey, fileName, mimeType, sizeBytes, createdBy, expiresAt, Instant.now(), null);
    }
    public void delete(Instant at) { deletedAt = at; }
    public UUID getId() { return id; } public UUID getWorkspaceId() { return workspaceId; } public String getStorageKey() { return storageKey; }
    public String getFileName() { return fileName; } public String getMimeType() { return mimeType; } public Long getSizeBytes() { return sizeBytes; }
    public UUID getCreatedBy() { return createdBy; } public Instant getExpiresAt() { return expiresAt; } public Instant getCreatedAt() { return createdAt; }
    public Instant getDeletedAt() { return deletedAt; }
}