package com.weav.workflow.domain.model.aggregate.execution;

import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class WorkflowExecution {
    private final UUID id; private final UUID workflowId; private final UUID workflowVersionId;
    private final ExecutionTriggerType triggerType; private ExecutionStatus status; private final UUID triggeredBy;
    private final Map<String, Object> input; private Map<String, Object> output; private Map<String, Object> error;
    private Instant startedAt; private Instant finishedAt; private final Instant createdAt;
    public WorkflowExecution(UUID id, UUID workflowId, UUID workflowVersionId, ExecutionTriggerType triggerType,
                             ExecutionStatus status, UUID triggeredBy, Map<String, Object> input, Map<String, Object> output,
                             Map<String, Object> error, Instant startedAt, Instant finishedAt, Instant createdAt) {
        this.id=Objects.requireNonNull(id); this.workflowId=Objects.requireNonNull(workflowId); this.workflowVersionId=workflowVersionId;
        this.triggerType=Objects.requireNonNull(triggerType); this.status=Objects.requireNonNull(status); this.triggeredBy=triggeredBy;
        this.input=input==null?Map.of():Map.copyOf(input); this.output=output==null?Map.of():Map.copyOf(output); this.error=error==null?Map.of():Map.copyOf(error);
        this.startedAt=startedAt; this.finishedAt=finishedAt; this.createdAt=Objects.requireNonNull(createdAt);
    }
    public static WorkflowExecution queue(UUID workflowId, UUID workflowVersionId, ExecutionTriggerType triggerType, UUID triggeredBy, Map<String,Object> input) {
        return new WorkflowExecution(UUID.randomUUID(), workflowId, workflowVersionId, triggerType, ExecutionStatus.QUEUED, triggeredBy, input, null, null, null, null, Instant.now());
    }
    public void start(Instant at) { status=ExecutionStatus.RUNNING; startedAt=at; }
    public void complete(Instant at) { status=ExecutionStatus.SUCCESS; finishedAt=at; }
    public void fail(Instant at, Map<String,Object> details) { status=ExecutionStatus.FAILED; error=details==null?Map.of():Map.copyOf(details); finishedAt=at; }
    public UUID getId(){return id;} public UUID getWorkflowId(){return workflowId;} public UUID getWorkflowVersionId(){return workflowVersionId;}
    public ExecutionTriggerType getTriggerType(){return triggerType;} public ExecutionStatus getStatus(){return status;} public UUID getTriggeredBy(){return triggeredBy;}
    public Map<String,Object> getInput(){return input;} public Map<String,Object> getOutput(){return output;} public Map<String,Object> getError(){return error;}
    public Instant getStartedAt(){return startedAt;} public Instant getFinishedAt(){return finishedAt;} public Instant getCreatedAt(){return createdAt;}
}