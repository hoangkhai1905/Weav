package com.weav.workflow.infrastructure.persistence.entity;

import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
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
import tools.jackson.databind.node.JsonNodeFactory;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "workflow_executions")
public class WorkflowExecutionJpaEntity {

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

    @Column(name = "root_node_id", length = 255)
    private String rootNodeId;

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

    @Column(name = "correlation_id", length = 128)
    private String correlationId;

    @Column(name = "traceparent", length = 255)
    private String traceparent;

    @Column(name = "scheduled_at")
    private Instant scheduledAt;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "edge_states", nullable = false, columnDefinition = "jsonb")
    private JsonNode edgeStates;

    @Column(name = "lease_owner", length = 128)
    private String leaseOwner;

    @Column(name = "lease_token", nullable = false)
    private Long leaseToken;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    protected WorkflowExecutionJpaEntity() {
    }

    /** Retains compatibility with existing persistence fixtures and V1 callers. */
    public WorkflowExecutionJpaEntity(UUID workflowId, UUID workflowVersionId,
                                      ExecutionTriggerType triggerType, UUID triggerId,
                                      UUID triggeredBy, JsonNode input) {
        this(UUID.randomUUID(), workflowId, workflowVersionId, ExecutionStatus.QUEUED, triggerType,
                triggerId, triggeredBy, null, input, null, null, null, null, Instant.now(), null,
                null, null, null, JsonNodeFactory.instance.objectNode(), null, 0L, null);
    }

    public WorkflowExecutionJpaEntity(UUID id, UUID workflowId, UUID workflowVersionId,
                                      ExecutionStatus status, ExecutionTriggerType triggerType,
                                      UUID triggerId, UUID triggeredBy, String rootNodeId,
                                      JsonNode input, JsonNode output, JsonNode error,
                                      Instant startedAt, Instant finishedAt, Instant createdAt,
                                      UUID parentExecutionId, String correlationId, String traceparent,
                                      Instant scheduledAt, JsonNode edgeStates, String leaseOwner,
                                      Long leaseToken, Instant leaseUntil) {
        this.id = id;
        this.workflowId = workflowId;
        this.workflowVersionId = workflowVersionId;
        this.status = status;
        this.triggerType = triggerType;
        this.triggerId = triggerId;
        this.triggeredBy = triggeredBy;
        this.rootNodeId = rootNodeId;
        this.input = input;
        this.output = output;
        this.error = error;
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
        this.createdAt = createdAt;
        this.parentExecutionId = parentExecutionId;
        this.correlationId = correlationId;
        this.traceparent = traceparent;
        this.scheduledAt = scheduledAt;
        this.edgeStates = edgeStates == null ? JsonNodeFactory.instance.objectNode() : edgeStates;
        this.leaseOwner = leaseOwner;
        this.leaseToken = leaseToken == null ? 0L : leaseToken;
        this.leaseUntil = leaseUntil;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
        if (edgeStates == null) edgeStates = JsonNodeFactory.instance.objectNode();
        if (leaseToken == null) leaseToken = 0L;
    }

    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public UUID getWorkflowVersionId() { return workflowVersionId; }
    public ExecutionStatus getStatus() { return status; }
    public ExecutionTriggerType getTriggerType() { return triggerType; }
    public UUID getTriggerId() { return triggerId; }
    public UUID getTriggeredBy() { return triggeredBy; }
    public String getRootNodeId() { return rootNodeId; }
    public JsonNode getInput() { return input; }
    public JsonNode getOutput() { return output; }
    public JsonNode getError() { return error; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public UUID getParentExecutionId() { return parentExecutionId; }
    public String getCorrelationId() { return correlationId; }
    public String getTraceparent() { return traceparent; }
    public Instant getScheduledAt() { return scheduledAt; }
    public JsonNode getEdgeStates() { return edgeStates; }
    public String getLeaseOwner() { return leaseOwner; }
    public Long getLeaseToken() { return leaseToken; }
    public Instant getLeaseUntil() { return leaseUntil; }

    public void setStatus(ExecutionStatus status) { this.status = status; }
    public void setOutput(JsonNode output) { this.output = output; }
    public void setError(JsonNode error) { this.error = error; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
    public void setParentExecutionId(UUID parentExecutionId) { this.parentExecutionId = parentExecutionId; }
    public void setEdgeStates(JsonNode edgeStates) {
        this.edgeStates = edgeStates == null ? JsonNodeFactory.instance.objectNode() : edgeStates;
    }
    public void setLeaseOwner(String leaseOwner) { this.leaseOwner = leaseOwner; }
    public void setLeaseToken(Long leaseToken) { this.leaseToken = leaseToken == null ? 0L : leaseToken; }
    public void setLeaseUntil(Instant leaseUntil) { this.leaseUntil = leaseUntil; }
}
