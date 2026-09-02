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
@Table(name = "agent_steps")
public class AgentStepJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "agent_run_id", nullable = false, updatable = false)
    private UUID agentRunId;

    @Column(name = "step_number", nullable = false, updatable = false)
    private Integer stepNumber;

    @Enumerated(EnumType.STRING)
    @Column(name = "decision_type", nullable = false, length = 32)
    private AgentStepDecisionType decisionType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private AgentStepStatus status;

    @Column(name = "tool_name", length = 255)
    private String toolName;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tool_arguments", columnDefinition = "jsonb")
    private JsonNode toolArguments;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "tool_result", columnDefinition = "jsonb")
    private JsonNode toolResult;

    @Column(length = 128)
    private String provider;

    @Column(length = 128)
    private String model;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode usage;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode error;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected AgentStepJpaEntity() {
    }

    public AgentStepJpaEntity(UUID agentRunId, int stepNumber, AgentStepDecisionType decisionType, AgentStepStatus status) {
        this.id = UUID.randomUUID();
        this.agentRunId = agentRunId;
        this.stepNumber = stepNumber;
        this.decisionType = decisionType;
        this.status = status;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        Instant now = Instant.now();
        if (startedAt == null) startedAt = now;
        if (createdAt == null) createdAt = now;
    }

    public UUID getId() { return id; }
    public UUID getAgentRunId() { return agentRunId; }
    public Integer getStepNumber() { return stepNumber; }
    public AgentStepDecisionType getDecisionType() { return decisionType; }
    public AgentStepStatus getStatus() { return status; }
    public String getToolName() { return toolName; }
    public JsonNode getToolArguments() { return toolArguments; }
    public JsonNode getToolResult() { return toolResult; }
    public String getProvider() { return provider; }
    public String getModel() { return model; }
    public JsonNode getUsage() { return usage; }
    public JsonNode getError() { return error; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }

    public void setToolName(String toolName) { this.toolName = toolName; }
    public void setToolArguments(JsonNode toolArguments) { this.toolArguments = toolArguments; }
    public void setToolResult(JsonNode toolResult) { this.toolResult = toolResult; }
    public void setProvider(String provider) { this.provider = provider; }
    public void setModel(String model) { this.model = model; }
    public void setUsage(JsonNode usage) { this.usage = usage; }
    public void setError(JsonNode error) { this.error = error; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
}