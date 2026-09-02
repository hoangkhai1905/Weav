package com.weav.workflow.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workflows")
public class Workflow {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workspace_id", nullable = false, updatable = false)
    private UUID workspaceId;

    @Column(nullable = false, length = 255)
    private String name;

    @Column(columnDefinition = "text")
    private String description;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private WorkflowStatus status;

    @Column(name = "schema_version", nullable = false, length = 32)
    private String schemaVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "draft_definition", nullable = false, columnDefinition = "jsonb")
    private JsonNode draftDefinition;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "editor_state", columnDefinition = "jsonb")
    private JsonNode editorState;

    @Column(name = "current_version_id")
    private UUID currentVersionId;

    @Column(name = "created_by", nullable = false, updatable = false)
    private UUID createdBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "published_at")
    private Instant publishedAt;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "deleted_by")
    private UUID deletedBy;

    protected Workflow() {
    }

    public Workflow(UUID workspaceId, String name, String schemaVersion, JsonNode draftDefinition, UUID createdBy) {
        this.id = UUID.randomUUID();
        this.workspaceId = workspaceId;
        this.name = name;
        this.schemaVersion = schemaVersion;
        this.draftDefinition = draftDefinition;
        this.createdBy = createdBy;
        this.status = WorkflowStatus.DRAFT;
    }

    @PrePersist
    void onCreate() {
        if (id == null) {
            id = UUID.randomUUID();
        }
        Instant now = Instant.now();
        if (createdAt == null) {
            createdAt = now;
        }
        if (updatedAt == null) {
            updatedAt = now;
        }
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getWorkspaceId() { return workspaceId; }
    public String getName() { return name; }
    public String getDescription() { return description; }
    public WorkflowStatus getStatus() { return status; }
    public String getSchemaVersion() { return schemaVersion; }
    public JsonNode getDraftDefinition() { return draftDefinition; }
    public JsonNode getEditorState() { return editorState; }
    public UUID getCurrentVersionId() { return currentVersionId; }
    public UUID getCreatedBy() { return createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getPublishedAt() { return publishedAt; }
    public Instant getDeletedAt() { return deletedAt; }
    public UUID getDeletedBy() { return deletedBy; }

    public void setDescription(String description) { this.description = description; }
    public void setStatus(WorkflowStatus status) { this.status = status; }
    public void setDraftDefinition(JsonNode draftDefinition) { this.draftDefinition = draftDefinition; }
    public void setEditorState(JsonNode editorState) { this.editorState = editorState; }
    public void setCurrentVersionId(UUID currentVersionId) { this.currentVersionId = currentVersionId; }
    public void setPublishedAt(Instant publishedAt) { this.publishedAt = publishedAt; }
    public void setDeletedAt(Instant deletedAt) { this.deletedAt = deletedAt; }
    public void setDeletedBy(UUID deletedBy) { this.deletedBy = deletedBy; }
}