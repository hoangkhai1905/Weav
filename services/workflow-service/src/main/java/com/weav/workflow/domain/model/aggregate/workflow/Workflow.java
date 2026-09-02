package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.valueobject.WorkflowStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class Workflow {
    private final UUID id;
    private final UUID workspaceId;
    private String name;
    private String description;
    private WorkflowStatus status;
    private final String schemaVersion;
    private Map<String, Object> draftDefinition;
    private Map<String, Object> editorState;
    private UUID currentVersionId;
    private final UUID createdBy;
    private final Instant createdAt;
    private Instant updatedAt;
    private Instant publishedAt;
    private Instant deletedAt;
    private UUID deletedBy;

    public Workflow(UUID id, UUID workspaceId, String name, String description, WorkflowStatus status,
                    String schemaVersion, Map<String, Object> draftDefinition, Map<String, Object> editorState,
                    UUID currentVersionId, UUID createdBy, Instant createdAt, Instant updatedAt,
                    Instant publishedAt, Instant deletedAt, UUID deletedBy) {
        this.id = Objects.requireNonNull(id);
        this.workspaceId = Objects.requireNonNull(workspaceId);
        this.name = Objects.requireNonNull(name);
        this.description = description;
        this.status = Objects.requireNonNull(status);
        this.schemaVersion = Objects.requireNonNull(schemaVersion);
        this.draftDefinition = copy(draftDefinition);
        this.editorState = copy(editorState);
        this.currentVersionId = currentVersionId;
        this.createdBy = Objects.requireNonNull(createdBy);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.updatedAt = Objects.requireNonNull(updatedAt);
        this.publishedAt = publishedAt;
        this.deletedAt = deletedAt;
        this.deletedBy = deletedBy;
    }

    public static Workflow createNew(UUID workspaceId, String name, String schemaVersion,
                                     Map<String, Object> draftDefinition, UUID createdBy) {
        Instant now = Instant.now();
        return new Workflow(UUID.randomUUID(), workspaceId, name, null, WorkflowStatus.DRAFT,
                schemaVersion, draftDefinition, null, null, createdBy, now, now, null, null, null);
    }

    public void publish(Instant at) { status = WorkflowStatus.PUBLISHED; publishedAt = at; touch(); }
    public void pause() { status = WorkflowStatus.PAUSED; touch(); }
    public void delete(UUID actor, Instant at) { deletedBy = actor; deletedAt = at; touch(); }
    private void touch() { updatedAt = Instant.now(); }
    private static Map<String, Object> copy(Map<String, Object> value) { return value == null ? Map.of() : Map.copyOf(value); }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public WorkflowStatus getStatus() { return status; }
    public String getSchemaVersion() { return schemaVersion; }
    public Map<String, Object> getDraftDefinition() { return draftDefinition; }
    public Map<String, Object> getEditorState() { return editorState; }
    public UUID getCurrentVersionId() { return currentVersionId; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getPublishedAt() { return publishedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public UUID getDeletedBy() { return deletedBy; }
}