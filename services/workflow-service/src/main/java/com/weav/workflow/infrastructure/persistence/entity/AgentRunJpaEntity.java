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
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "agent_runs")
public class AgentRunJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "node_execution_attempt_id", nullable = false, unique = true, updatable = false)
    private UUID nodeExecutionAttemptId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AgentRunStatus status;

    @Column(name = "resolved_goal", nullable = false, columnDefinition = "text")
    private String resolvedGoal;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "allowed_tools", nullable = false, columnDefinition = "jsonb")
    private JsonNode allowedTools;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private JsonNode state;

    @Column(name = "step_count", nullable = false)
    private Integer stepCount;

    @Column(name = "max_steps", nullable = false)
    private Integer maxSteps;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "final_output", columnDefinition = "jsonb")
    private JsonNode finalOutput;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode error;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AgentRunJpaEntity() {
    }

    public AgentRunJpaEntity(UUID nodeExecutionAttemptId, String resolvedGoal, JsonNode allowedTools, JsonNode state, int maxSteps) {
        this.id = UUID.randomUUID();
        this.nodeExecutionAttemptId = nodeExecutionAttemptId;
        this.resolvedGoal = resolvedGoal;
        this.allowedTools = allowedTools;
        this.state = state;
        this.maxSteps = maxSteps;
        this.status = AgentRunStatus.RUNNING;
        this.stepCount = 0;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        Instant now = Instant.now();
        if (startedAt == null) startedAt = now;
        if (createdAt == null) createdAt = now;
        if (updatedAt == null) updatedAt = now;
    }

    @PreUpdate
    void onUpdate() { updatedAt = Instant.now(); }

    public UUID getId() { return id; }
    public UUID getNodeExecutionAttemptId() { return nodeExecutionAttemptId; }
    public AgentRunStatus getStatus() { return status; }
    public String getResolvedGoal() { return resolvedGoal; }
    public JsonNode getAllowedTools() { return allowedTools; }
    public JsonNode getState() { return state; }
    public Integer getStepCount() { return stepCount; }
    public Integer getMaxSteps() { return maxSteps; }
    public JsonNode getFinalOutput() { return finalOutput; }
    public JsonNode getError() { return error; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void setStatus(AgentRunStatus status) { this.status = status; }
    public void setState(JsonNode state) { this.state = state; }
    public void setStepCount(Integer stepCount) { this.stepCount = stepCount; }
    public void setFinalOutput(JsonNode finalOutput) { this.finalOutput = finalOutput; }
    public void setError(JsonNode error) { this.error = error; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
}