package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class WorkflowTrigger {
    private final UUID id;
    private final UUID workflowId;
    private final UUID workflowVersionId;
    private final String triggerNodeId;
    private final TriggerType type;
    private TriggerStatus status;
    private final Map<String, Object> config;
    private String endpointKey;
    private String secretHash;
    private Instant nextRunAt;
    private Instant lastTriggeredAt;
    private Map<String, Object> lastError;
    private final Instant createdAt;
    private Instant updatedAt;

    public WorkflowTrigger(UUID id, UUID workflowId, UUID workflowVersionId, String triggerNodeId, TriggerType type,
                           TriggerStatus status, Map<String, Object> config, String endpointKey, String secretHash,
                           Instant nextRunAt, Instant lastTriggeredAt, Map<String, Object> lastError,
                           Instant createdAt, Instant updatedAt) {
        this.id = Objects.requireNonNull(id); this.workflowId = Objects.requireNonNull(workflowId);
        this.workflowVersionId = Objects.requireNonNull(workflowVersionId); this.triggerNodeId = Objects.requireNonNull(triggerNodeId);
        this.type = Objects.requireNonNull(type); this.status = Objects.requireNonNull(status);
        this.config = config == null ? Map.of() : Map.copyOf(config); this.endpointKey = endpointKey; this.secretHash = secretHash;
        this.nextRunAt = nextRunAt; this.lastTriggeredAt = lastTriggeredAt;
        this.lastError = lastError == null ? Map.of() : Map.copyOf(lastError);
        this.createdAt = Objects.requireNonNull(createdAt); this.updatedAt = Objects.requireNonNull(updatedAt);
    }

    public static WorkflowTrigger createNew(UUID workflowId, UUID versionId, String nodeId, TriggerType type, Map<String, Object> config) {
        Instant now = Instant.now();
        return new WorkflowTrigger(UUID.randomUUID(), workflowId, versionId, nodeId, type, TriggerStatus.ACTIVE,
                config, null, null, null, null, null, now, now);
    }
    public void disable() { status = TriggerStatus.DISABLED; updatedAt = Instant.now(); }
    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public UUID getWorkflowVersionId() { return workflowVersionId; }
    public String getTriggerNodeId() { return triggerNodeId; }
    public TriggerType getType() { return type; }
    public TriggerStatus getStatus() { return status; }
    public Map<String, Object> getConfig() { return config; }
    public String getEndpointKey() { return endpointKey; }
    public String getSecretHash() { return secretHash; }
    public Instant getNextRunAt() { return nextRunAt; }
    public Instant getLastTriggeredAt() { return lastTriggeredAt; }
    public Map<String, Object> getLastError() { return lastError; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}