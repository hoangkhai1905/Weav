package com.weav.workflow.domain.model.aggregate.execution;

import com.weav.workflow.domain.valueobject.AttemptStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class NodeExecutionAttempt {
    private final UUID id; private final UUID nodeExecutionId; private final Integer attemptNumber; private AttemptStatus status;
    private final Map<String,Object> input; private Map<String,Object> output; private Map<String,Object> error;
    private final Instant startedAt; private Instant finishedAt; private final Instant createdAt;
    public NodeExecutionAttempt(UUID id, UUID nodeExecutionId, Integer attemptNumber, AttemptStatus status, Map<String,Object> input,
                                Map<String,Object> output, Map<String,Object> error, Instant startedAt, Instant finishedAt, Instant createdAt) {
        this.id=Objects.requireNonNull(id); this.nodeExecutionId=Objects.requireNonNull(nodeExecutionId); this.attemptNumber=Objects.requireNonNull(attemptNumber); this.status=Objects.requireNonNull(status);
        this.input=input==null?Map.of():Map.copyOf(input); this.output=output==null?Map.of():Map.copyOf(output); this.error=error==null?Map.of():Map.copyOf(error);
        this.startedAt=Objects.requireNonNull(startedAt); this.finishedAt=finishedAt; this.createdAt=Objects.requireNonNull(createdAt);
    }
    public static NodeExecutionAttempt start(UUID nodeExecutionId, int number, Map<String,Object> input) {
        Instant now=Instant.now(); return new NodeExecutionAttempt(UUID.randomUUID(), nodeExecutionId, number, AttemptStatus.RUNNING, input, null, null, now, null, now);
    }
    public void succeed(Map<String,Object> output, Instant at){status=AttemptStatus.SUCCESS; this.output=output==null?Map.of():Map.copyOf(output); finishedAt=at;}
    public UUID getId(){return id;} public UUID getNodeExecutionId(){return nodeExecutionId;} public Integer getAttemptNumber(){return attemptNumber;} public AttemptStatus getStatus(){return status;}
    public Map<String,Object> getInput(){return input;} public Map<String,Object> getOutput(){return output;} public Map<String,Object> getError(){return error;}
    public Instant getStartedAt(){return startedAt;} public Instant getFinishedAt(){return finishedAt;} public Instant getCreatedAt(){return createdAt;}
}