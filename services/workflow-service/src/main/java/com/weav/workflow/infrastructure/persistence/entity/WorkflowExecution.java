package com.weav.workflow.infrastructure.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workflow_executions")
public class WorkflowExecution {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "workflow_id", nullable = false, updatable = false)
    private UUID workflowId;

    @Column(name = "workflow_version_id", nullable = false, updatable = false)
    private UUID workflowVersionId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private ExecutionStatus status;

    @Enumerated(EnumType.STRING)
    @Column(name = "trigger_type", nullable = false, length = 32)
    private ExecutionTriggerType triggerType;

    @Column(name = "trigger_id")
    private UUID triggerId;

    @Column(name = "triggered_by")
    private UUID triggeredBy;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode input;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode output;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode error;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "parent_execution_id")
    private UUID parentExecutionId;

    protected WorkflowExecution() {
    }

    public WorkflowExecution(UUID workflowId, UUID workflowVersionId, ExecutionTriggerType triggerType, UUID triggerId, UUID triggeredBy, JsonNode input) {
        this.id = UUID.randomUUID();
        this.workflowId = workflowId;
        this.workflowVersionId = workflowVersionId;
        this.triggerType = triggerType;
        this.triggerId = triggerId;
        this.triggeredBy = triggeredBy;
        this.input = input;
        this.status = ExecutionStatus.QUEUED;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public UUID getWorkflowVersionId() { return workflowVersionId; }
    public ExecutionStatus getStatus() { return status; }
    public ExecutionTriggerType getTriggerType() { return triggerType; }
    public UUID getTriggerId() { return triggerId; }
    public UUID getTriggeredBy() { return triggeredBy; }
    public JsonNode getInput() { return input; }
    public JsonNode getOutput() { return output; }
    public JsonNode getError() { return error; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public UUID getParentExecutionId() { return parentExecutionId; }

    public void setStatus(ExecutionStatus status) { this.status = status; }
    public void setOutput(JsonNode output) { this.output = output; }
    public void setError(JsonNode error) { this.error = error; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
    public void setParentExecutionId(UUID parentExecutionId) { this.parentExecutionId = parentExecutionId; }
}