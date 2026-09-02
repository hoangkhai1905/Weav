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
@Table(name = "workflow_triggers")
public class WorkflowTrigger {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workflow_id", nullable = false, updatable = false)
    private UUID workflowId;

    @Column(name = "workflow_version_id", nullable = false, updatable = false)
    private UUID workflowVersionId;

    @Column(name = "trigger_node_id", nullable = false, length = 255)
    private String triggerNodeId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private TriggerType type;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private TriggerStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode config;

    @Column(name = "endpoint_key", length = 255)
    private String endpointKey;

    @Column(name = "secret_hash", length = 255)
    private String secretHash;

    @Column(name = "next_run_at")
    private Instant nextRunAt;

    @Column(name = "last_triggered_at")
    private Instant lastTriggeredAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "last_error", columnDefinition = "jsonb")
    private JsonNode lastError;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected WorkflowTrigger() {
    }

    public WorkflowTrigger(UUID workflowId, UUID workflowVersionId, String triggerNodeId, TriggerType type, JsonNode config) {
        this.id = UUID.randomUUID();
        this.workflowId = workflowId;
        this.workflowVersionId = workflowVersionId;
        this.triggerNodeId = triggerNodeId;
        this.type = type;
        this.status = TriggerStatus.ACTIVE;
        this.config = config;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        Instant now = Instant.now();
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void onUpdate() { updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public UUID getWorkflowVersionId() { return workflowVersionId; }
    public String getTriggerNodeId() { return triggerNodeId; }
    public TriggerType getType() { return type; }
    public TriggerStatus getStatus() { return status; }
    public JsonNode getConfig() { return config; }
    public String getEndpointKey() { return endpointKey; }
    public String getSecretHash() { return secretHash; }
    public Instant getNextRunAt() { return nextRunAt; }
    public Instant getLastTriggeredAt() { return lastTriggeredAt; }
    public JsonNode getLastError() { return lastError; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void setStatus(TriggerStatus status) { this.status = status; }
    public void setEndpointKey(String endpointKey) { this.endpointKey = endpointKey; }
    public void setSecretHash(String secretHash) { this.secretHash = secretHash; }
    public void setNextRunAt(Instant nextRunAt) { this.nextRunAt = nextRunAt; }
    public void setLastTriggeredAt(Instant lastTriggeredAt) { this.lastTriggeredAt = lastTriggeredAt; }
    public void setLastError(JsonNode lastError) { this.lastError = lastError; }
}