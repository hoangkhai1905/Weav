package com.weav.workflow.infrastructure.persistence.entity;

import com.weav.workflow.domain.valueobject.NodeExecutionStatus;

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
@Table(name = "node_executions")
public class NodeExecutionJpaEntity {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "execution_id", nullable = false, updatable = false)
    private UUID executionId;

    @Column(name = "node_id", nullable = false, length = 255, updatable = false)
    private String nodeId;

    @Column(name = "node_type", nullable = false, length = 255, updatable = false)
    private String nodeType;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private NodeExecutionStatus status;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode input;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode output;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode error;

    @Column(name = "attempt_count", nullable = false)
    private Integer attemptCount;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "next_attempt_at")
    private Instant nextAttemptAt;

    protected NodeExecutionJpaEntity() {
    }

    public NodeExecutionJpaEntity(UUID executionId, String nodeId, String nodeType, JsonNode input) {
        this(UUID.randomUUID(), executionId, nodeId, nodeType, NodeExecutionStatus.PENDING,
                input, null, null, 0, null, null, null, null);
    }

    public NodeExecutionJpaEntity(UUID id, UUID executionId, String nodeId, String nodeType,
                                  NodeExecutionStatus status, JsonNode input, JsonNode output,
                                  JsonNode error, Integer attemptCount, Instant startedAt,
                                  Instant finishedAt, Instant createdAt, Instant nextAttemptAt) {
        this.id = id;
        this.executionId = executionId;
        this.nodeId = nodeId;
        this.nodeType = nodeType;
        this.status = status;
        this.input = input;
        this.output = output;
        this.error = error;
        this.attemptCount = attemptCount;
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
        this.createdAt = createdAt;
        this.nextAttemptAt = nextAttemptAt;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        if (attemptCount == null) attemptCount = 0;
        if (createdAt == null) createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getExecutionId() { return executionId; }
    public String getNodeId() { return nodeId; }
    public String getNodeType() { return nodeType; }
    public NodeExecutionStatus getStatus() { return status; }
    public JsonNode getInput() { return input; }
    public JsonNode getOutput() { return output; }
    public JsonNode getError() { return error; }
    public Integer getAttemptCount() { return attemptCount; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getNextAttemptAt() { return nextAttemptAt; }

    public void setStatus(NodeExecutionStatus status) { this.status = status; }
    public void setOutput(JsonNode output) { this.output = output; }
    public void setError(JsonNode error) { this.error = error; }
    public void setAttemptCount(Integer attemptCount) { this.attemptCount = attemptCount; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
    public void setNextAttemptAt(Instant nextAttemptAt) { this.nextAttemptAt = nextAttemptAt; }
}
