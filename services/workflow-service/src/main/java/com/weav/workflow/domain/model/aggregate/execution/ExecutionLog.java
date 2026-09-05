package com.weav.workflow.domain.model.aggregate.execution;

import com.weav.workflow.domain.valueobject.LogLevel;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class ExecutionLog {
    private final UUID id; private final UUID executionId; private final UUID nodeExecutionId; private final UUID attemptId;
    private final LogLevel level; private final String eventType; private final String message; private final Map<String,Object> metadata; private final Instant createdAt;
    public ExecutionLog(UUID id, UUID executionId, UUID nodeExecutionId, UUID attemptId, LogLevel level, String eventType,
                        String message, Map<String,Object> metadata, Instant createdAt) {
        this.id=Objects.requireNonNull(id); this.executionId=Objects.requireNonNull(executionId); this.nodeExecutionId=nodeExecutionId; this.attemptId=attemptId;
        this.level=Objects.requireNonNull(level); this.eventType=Objects.requireNonNull(eventType); this.message=message; this.metadata=metadata==null?Map.of():Map.copyOf(metadata); this.createdAt=Objects.requireNonNull(createdAt);
    }
    public static ExecutionLog record(UUID executionId, LogLevel level, String eventType, String message, Map<String,Object> metadata) {
        return new ExecutionLog(UUID.randomUUID(), executionId, null, null, level, eventType, message, metadata, Instant.now());
    }
    public UUID getId(){return id;} public UUID getExecutionId(){return executionId;} public UUID getNodeExecutionId(){return nodeExecutionId;} public UUID getAttemptId(){return attemptId;}
    public LogLevel getLevel(){return level;} public String getEventType(){return eventType;} public String getMessage(){return message;} public Map<String,Object> getMetadata(){return metadata;} public Instant getCreatedAt(){return createdAt;}
}