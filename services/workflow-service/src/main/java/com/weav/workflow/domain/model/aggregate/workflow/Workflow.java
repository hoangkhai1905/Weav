package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
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
        this.editorState = copyOptional(editorState);
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

    public static Workflow createDraft(UUID workspaceId, String name, String description, UUID createdBy) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(Map.of(
                "id", "manual",
                "type", "trigger.manual",
                "config", Map.of())));
        definition.put("edges", List.of());
        definition.put("variables", Map.of());
        Instant now = Instant.now();
        return new Workflow(UUID.randomUUID(), workspaceId, name, description, WorkflowStatus.DRAFT,
                "1.0", definition, null, null, createdBy, now, now, null, null, null);
    }

    public void updateDraft(String name, String description, Map<String, Object> definition,
                            Map<String, Object> editorState) {
        String frozenName = Objects.requireNonNull(name, "name must not be null");
        Map<String, Object> frozenDefinition = Objects.requireNonNull(
                copy(definition), "draftDefinition must not be null");
        Map<String, Object> frozenEditorState = copyOptional(editorState);
        this.name = frozenName;
        this.description = description;
        this.draftDefinition = frozenDefinition;
        this.editorState = frozenEditorState;
        touch();
    }

    /**
     * Publishes a new immutable version while preserving an explicit pause.
     */
    public void publishVersion(UUID versionId, Instant at) {
        Objects.requireNonNull(versionId, "versionId must not be null");
        Objects.requireNonNull(at, "at must not be null");
        if (deletedAt != null) {
            throw new InvalidStateException("A deleted workflow cannot be published");
        }
        if (status != WorkflowStatus.PAUSED) {
            status = WorkflowStatus.PUBLISHED;
        }
        currentVersionId = versionId;
        publishedAt = at;
        touch();
    }

    /** @deprecated Prefer {@link #publishVersion(UUID, Instant)} with an inserted version identity. */
    @Deprecated(forRemoval = false)
    public void publish(Instant at) {
        if (currentVersionId == null) {
            throw new InvalidStateException("A workflow must have a published version before it can be published");
        }
        publishVersion(currentVersionId, at);
    }

    public void pause() {
        requirePublishedVersion("paused");
        if (status == WorkflowStatus.PAUSED) {
            return;
        }
        status = WorkflowStatus.PAUSED;
        touch();
    }

    public void resume() {
        requirePublishedVersion("resumed");
        if (status == WorkflowStatus.PUBLISHED) {
            return;
        }
        status = WorkflowStatus.PUBLISHED;
        touch();
    }

    private void requirePublishedVersion(String action) {
        if (deletedAt != null || status == WorkflowStatus.DRAFT || currentVersionId == null) {
            throw new InvalidStateException("A workflow must have a published version before it can be " + action);
        }
    }
    public void delete(UUID actor, Instant at) { deletedBy = actor; deletedAt = at; touch(); }
    private void touch() { updatedAt = Instant.now(); }
    private static Map<String, Object> copy(Map<String, Object> value) {
        return JsonValues.freezeMap(Objects.requireNonNull(value, "draftDefinition must not be null"));
    }
    private static Map<String, Object> copyOptional(Map<String, Object> value) {
        return value == null ? null : JsonValues.freezeMap(value);
    }

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
