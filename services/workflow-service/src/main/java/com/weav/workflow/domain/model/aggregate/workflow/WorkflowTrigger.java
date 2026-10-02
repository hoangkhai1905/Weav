package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.definition.JsonValues;
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
        this.config = JsonValues.freezeMap(config); this.endpointKey = endpointKey; this.secretHash = secretHash;
        this.nextRunAt = nextRunAt; this.lastTriggeredAt = lastTriggeredAt;
        this.lastError = JsonValues.freezeMap(lastError);
        this.createdAt = Objects.requireNonNull(createdAt); this.updatedAt = Objects.requireNonNull(updatedAt);
    }

    public static WorkflowTrigger createNew(UUID workflowId, UUID versionId, String nodeId, TriggerType type,
                                            Map<String, Object> config, TriggerStatus status, Instant nextRunAt,
                                            Map<String, Object> lastError, Instant createdAt) {
        return new WorkflowTrigger(UUID.randomUUID(), workflowId, versionId, nodeId, type, status,
                config, null, null, nextRunAt, null, lastError, createdAt, createdAt);
    }

    /** Test and migration helper for registrations without a computed schedule slot. */
    public static WorkflowTrigger createNew(UUID workflowId, UUID versionId, String nodeId, TriggerType type,
                                            Map<String, Object> config) {
        Instant now = Instant.now();
        return createNew(workflowId, versionId, nodeId, type, config, TriggerStatus.ACTIVE, null, null, now);
    }

    public void disable(Instant at) {
        status = TriggerStatus.DISABLED;
        updatedAt = Objects.requireNonNull(at);
    }

    public void scheduleAdvanced(Instant scheduledAt, Instant nextRunAt, Instant at) {
        if (type != TriggerType.SCHEDULE) {
            throw new IllegalStateException("Only schedule registrations can advance a schedule slot");
        }
        if (scheduledAt == null || nextRunAt == null || !nextRunAt.isAfter(scheduledAt)) {
            throw new IllegalArgumentException("Schedule slots must advance to a later instant");
        }
        this.lastTriggeredAt = scheduledAt;
        this.nextRunAt = nextRunAt;
        this.lastError = null;
        this.updatedAt = Objects.requireNonNull(at);
    }

    public void initializeSchedule(Instant nextRunAt, Instant at) {
        if (type != TriggerType.SCHEDULE || nextRunAt == null) {
            throw new IllegalArgumentException("A schedule registration requires a next run instant");
        }
        this.nextRunAt = nextRunAt;
        this.updatedAt = Objects.requireNonNull(at);
    }

    public void recordScheduleFailure(Instant retryAt, Instant at) {
        if (type != TriggerType.SCHEDULE || retryAt == null) {
            throw new IllegalArgumentException("Only schedule registrations can record schedule failures");
        }
        this.lastError = Map.of("code", "SCHEDULE_ADMISSION_FAILED", "retryAt", retryAt.toString());
        this.updatedAt = Objects.requireNonNull(at);
    }

    public void clearLastError(Instant at) {
        this.lastError = null;
        this.updatedAt = Objects.requireNonNull(at);
    }

    public void provisionWebhook(String endpointKey, String secretHash) {
        if (type != TriggerType.WEBHOOK || this.endpointKey != null || this.secretHash != null
                || endpointKey == null || endpointKey.isBlank()
                || secretHash == null || secretHash.isBlank()) {
            throw new IllegalStateException("Webhook credentials can only be provisioned once for a webhook trigger");
        }
        this.endpointKey = endpointKey;
        this.secretHash = secretHash;
    }

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
