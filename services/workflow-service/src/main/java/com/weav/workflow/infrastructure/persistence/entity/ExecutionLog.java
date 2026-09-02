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
@Table(name = "execution_logs")
public class ExecutionLog {

    @Id
    @Column(nullable = false, updatable = false)
    private UUID id;

    @Column(name = "execution_id", nullable = false, updatable = false)
    private UUID executionId;

    @Column(name = "node_execution_id")
    private UUID nodeExecutionId;

    @Column(name = "attempt_id")
    private UUID attemptId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private LogLevel level;

    @Column(name = "event_type", nullable = false, length = 128)
    private String eventType;

    @Column(columnDefinition = "text")
    private String message;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private JsonNode metadata;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    protected ExecutionLog() {
    }

    public ExecutionLog(UUID executionId, UUID nodeExecutionId, UUID attemptId, LogLevel level, String eventType, String message, JsonNode metadata) {
        this.id = UUID.randomUUID();
        this.executionId = executionId;
        this.nodeExecutionId = nodeExecutionId;
        this.attemptId = attemptId;
        this.level = level;
        this.eventType = eventType;
        this.message = message;
        this.metadata = metadata;
    }

    @PrePersist
    void onCreate() {
        if (id == null) id = UUID.randomUUID();
        if (createdAt == null) createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public UUID getExecutionId() { return executionId; }
    public UUID getNodeExecutionId() { return nodeExecutionId; }
    public UUID getAttemptId() { return attemptId; }
    public LogLevel getLevel() { return level; }
    public String getEventType() { return eventType; }
    public String getMessage() { return message; }
    public JsonNode getMetadata() { return metadata; }
    public Instant getCreatedAt() { return createdAt; }
}