package com.weav.workflow.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workflow_versions")
public class WorkflowVersion {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workflow_id", nullable = false, updatable = false)
    private UUID workflowId;

    @Column(name = "version_number", nullable = false, updatable = false)
    private Integer versionNumber;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private JsonNode definition;

    @Column(name = "schema_version", nullable = false, length = 32, updatable = false)
    private String schemaVersion;

    @Column(name = "published_by", nullable = false, updatable = false)
    private UUID publishedBy;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected WorkflowVersion() {
    }

    public WorkflowVersion(UUID workflowId, Integer versionNumber, JsonNode definition, String schemaVersion, UUID publishedBy) {
        this.id = UUID.randomUUID();
        this.workflowId = workflowId;
        this.versionNumber = versionNumber;
        this.definition = definition;
        this.schemaVersion = schemaVersion;
        this.publishedBy = publishedBy;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public Integer getVersionNumber() { return versionNumber; }
    public JsonNode getDefinition() { return definition; }
    public String getSchemaVersion() { return schemaVersion; }
    public UUID getPublishedBy() { return publishedBy; }
    public Instant getCreatedAt() { return createdAt; }
}