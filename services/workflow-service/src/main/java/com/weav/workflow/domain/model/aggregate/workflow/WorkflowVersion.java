package com.weav.workflow.domain.model.aggregate.workflow;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class WorkflowVersion {
    private final UUID id;
    private final UUID workflowId;
    private final Integer versionNumber;
    private final Map<String, Object> definition;
    private final String schemaVersion;
    private final UUID publishedBy;
    private final Instant createdAt;

    public WorkflowVersion(UUID id, UUID workflowId, Integer versionNumber, Map<String, Object> definition,
                           String schemaVersion, UUID publishedBy, Instant createdAt) {
        this.id = Objects.requireNonNull(id); this.workflowId = Objects.requireNonNull(workflowId);
        this.versionNumber = Objects.requireNonNull(versionNumber); this.definition = definition == null ? Map.of() : Map.copyOf(definition);
        this.schemaVersion = Objects.requireNonNull(schemaVersion); this.publishedBy = Objects.requireNonNull(publishedBy);
        this.createdAt = Objects.requireNonNull(createdAt);
    }

    public static WorkflowVersion createNew(UUID workflowId, int versionNumber, Map<String, Object> definition,
                                            String schemaVersion, UUID publishedBy) {
        return new WorkflowVersion(UUID.randomUUID(), workflowId, versionNumber, definition, schemaVersion, publishedBy, Instant.now());
    }
    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public Integer getVersionNumber() { return versionNumber; }
    public Map<String, Object> getDefinition() { return definition; }
    public String getSchemaVersion() { return schemaVersion; }
    public UUID getPublishedBy() { return publishedBy; }
    public Instant getCreatedAt() { return createdAt; }
}