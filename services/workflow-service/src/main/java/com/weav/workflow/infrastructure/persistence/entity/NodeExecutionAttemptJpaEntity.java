package com.weav.workflow.infrastructure.persistence.entity;

import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.OutboxStatus;
import com.weav.workflow.domain.valueobject.AgentRunStatus;
import com.weav.workflow.domain.valueobject.AgentStepStatus;
import com.weav.workflow.domain.valueobject.AgentStepDecisionType;

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
@Table(name = "node_execution_attempts")
public class NodeExecutionAttemptJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "node_execution_id", nullable = false, updatable = false)
    private UUID nodeExecutionId;

    @Column(name = "attempt_number", nullable = false, updatable = false)
    private Integer attemptNumber;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AttemptStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode input;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode output;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode error;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected NodeExecutionAttemptJpaEntity() {
    }

    public NodeExecutionAttemptJpaEntity(UUID nodeExecutionId, Integer attemptNumber, JsonNode input) {
        this.id = UUID.randomUUID();
        this.nodeExecutionId = nodeExecutionId;
        this.attemptNumber = attemptNumber;
        this.input = input;
        this.status = AttemptStatus.RUNNING;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        Instant now = Instant.now();
        if (startedAt == null) startedAt = now;
        if (createdAt == null) createdAt = now;
    }

    public UUID getId() { return id; }
    public UUID getNodeExecutionId() { return nodeExecutionId; }
    public Integer getAttemptNumber() { return attemptNumber; }
    public AttemptStatus getStatus() { return status; }
    public JsonNode getInput() { return input; }
    public JsonNode getOutput() { return output; }
    public JsonNode getError() { return error; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }

    public void setStatus(AttemptStatus status) { this.status = status; }
    public void setOutput(JsonNode output) { this.output = output; }
    public void setError(JsonNode error) { this.error = error; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
}