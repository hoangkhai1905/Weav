package com.weav.workflow.domain.model.aggregate.execution;

import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** A durable execution pinned to one immutable workflow version and firing root. */
public class WorkflowExecution {
    private final UUID id;
    private final UUID workflowId;
    private final UUID workflowVersionId;
    private final ExecutionTriggerType triggerType;
    private final UUID triggerId;
    private ExecutionStatus status;
    private final UUID triggeredBy;
    private final String rootNodeId;
    private final Object input;
    private Map<String, Object> output;
    private Map<String, Object> error;
    private Instant startedAt;
    private Instant finishedAt;
    private final Instant createdAt;
    private final String correlationId;
    private final String traceparent;
    private final Instant scheduledAt;
    private final Map<String, Object> edgeStates;
    private final String leaseOwner;
    private final long leaseToken;
    private final Instant leaseUntil;

    /** Keeps the original persistence-fixture constructor source-compatible. */
    public WorkflowExecution(UUID id, UUID workflowId, UUID workflowVersionId, ExecutionTriggerType triggerType,
                             ExecutionStatus status, UUID triggeredBy, Map<String, Object> input,
                             Map<String, Object> output, Map<String, Object> error,
                             Instant startedAt, Instant finishedAt, Instant createdAt) {
        this(id, workflowId, workflowVersionId, triggerType, null, status, triggeredBy, null, input, output, error,
                startedAt, finishedAt, createdAt, null, null, null, Map.of(), null, 0, null);
    }

    public WorkflowExecution(UUID id, UUID workflowId, UUID workflowVersionId, ExecutionTriggerType triggerType,
                             UUID triggerId, ExecutionStatus status, UUID triggeredBy, String rootNodeId,
                             Object input, Map<String, Object> output, Map<String, Object> error,
                             Instant startedAt, Instant finishedAt, Instant createdAt, String correlationId,
                             String traceparent, Instant scheduledAt, Map<String, ?> edgeStates,
                             String leaseOwner, long leaseToken, Instant leaseUntil) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.workflowId = Objects.requireNonNull(workflowId, "workflowId must not be null");
        this.workflowVersionId = Objects.requireNonNull(workflowVersionId, "workflowVersionId must not be null");
        this.triggerType = Objects.requireNonNull(triggerType, "triggerType must not be null");
        this.triggerId = triggerId;
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.triggeredBy = triggeredBy;
        this.rootNodeId = rootNodeId;
        this.input = JsonValues.freeze(input);
        this.output = JsonValues.freezeMap(output);
        this.error = JsonValues.freezeMap(error);
        this.startedAt = startedAt;
        this.finishedAt = finishedAt;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt must not be null");
        this.correlationId = correlationId;
        this.traceparent = traceparent;
        this.scheduledAt = scheduledAt;
        this.edgeStates = freezeObjectMap(edgeStates);
        this.leaseOwner = leaseOwner;
        this.leaseToken = leaseToken;
        this.leaseUntil = leaseUntil;
    }

    public static WorkflowExecution queue(UUID workflowId, UUID workflowVersionId,
                                          ExecutionTriggerType triggerType, UUID triggeredBy,
                                          Map<String, Object> input) {
        return queue(workflowId, workflowVersionId, triggerType, null, triggeredBy, null, input,
                null, null, null, Map.of());
    }

    public static WorkflowExecution queue(UUID workflowId, UUID workflowVersionId,
                                          ExecutionTriggerType triggerType, UUID triggerId, UUID triggeredBy,
                                          String rootNodeId, Object input, String correlationId,
                                          String traceparent, Instant scheduledAt, Map<String, ?> edgeStates) {
        return new WorkflowExecution(UUID.randomUUID(), workflowId, workflowVersionId, triggerType, triggerId,
                ExecutionStatus.QUEUED, triggeredBy, rootNodeId, input, null, null, null, null, Instant.now(),
                correlationId, traceparent, scheduledAt, edgeStates, null, 0, null);
    }

    private static Map<String, Object> freezeObjectMap(Map<String, ?> value) {
        if (value == null || value.isEmpty()) {
            return Map.of();
        }
        java.util.LinkedHashMap<String, Object> copy = new java.util.LinkedHashMap<>();
        for (Map.Entry<String, ?> entry : value.entrySet()) {
            copy.put(entry.getKey(), entry.getValue());
        }
        return JsonValues.freezeMap(copy);
    }

    public void start(Instant at) {
        Objects.requireNonNull(at, "at must not be null");
        status = ExecutionStatus.RUNNING;
        startedAt = at;
    }

    public void complete(Instant at) {
        Objects.requireNonNull(at, "at must not be null");
        status = ExecutionStatus.SUCCESS;
        finishedAt = at;
    }

    public void fail(Instant at, Map<String, Object> details) {
        Map<String, Object> frozenDetails = JsonValues.freezeMap(details);
        error = frozenDetails;
        status = ExecutionStatus.FAILED;
        finishedAt = Objects.requireNonNull(at, "at must not be null");
    }

    public UUID getId() { return id; }
    public UUID getWorkflowId() { return workflowId; }
    public UUID getWorkflowVersionId() { return workflowVersionId; }
    public ExecutionTriggerType getTriggerType() { return triggerType; }
    public UUID getTriggerId() { return triggerId; }
    public ExecutionStatus getStatus() { return status; }
    public UUID getTriggeredBy() { return triggeredBy; }
    public String getRootNodeId() { return rootNodeId; }
    public Object getInput() { return input; }
    public Map<String, Object> getOutput() { return output; }
    public Map<String, Object> getError() { return error; }
    public Instant getStartedAt() { return startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public String getCorrelationId() { return correlationId; }
    public String getTraceparent() { return traceparent; }
    public Instant getScheduledAt() { return scheduledAt; }
    public Map<String, Object> getEdgeStates() { return edgeStates; }
    public String getLeaseOwner() { return leaseOwner; }
    public long getLeaseToken() { return leaseToken; }
    public Instant getLeaseUntil() { return leaseUntil; }
}
