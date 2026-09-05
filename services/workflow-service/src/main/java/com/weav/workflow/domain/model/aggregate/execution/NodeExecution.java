package com.weav.workflow.domain.model.aggregate.execution;

import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class NodeExecution {
    private final UUID id; private final UUID executionId; private final String nodeId; private final String nodeType;
    private final Map<String,Object> input; private Map<String,Object> output; private Map<String,Object> error;
    private NodeExecutionStatus status; private Integer attemptCount; private Instant startedAt; private Instant finishedAt; private final Instant createdAt;
    public NodeExecution(UUID id, UUID executionId, String nodeId, String nodeType, NodeExecutionStatus status,
                         Map<String,Object> input, Map<String,Object> output, Map<String,Object> error, Integer attemptCount,
                         Instant startedAt, Instant finishedAt, Instant createdAt) {
        this.id=Objects.requireNonNull(id); this.executionId=Objects.requireNonNull(executionId); this.nodeId=Objects.requireNonNull(nodeId); this.nodeType=Objects.requireNonNull(nodeType);
        this.status=Objects.requireNonNull(status); this.input=input==null?Map.of():Map.copyOf(input); this.output=output==null?Map.of():Map.copyOf(output); this.error=error==null?Map.of():Map.copyOf(error);
        this.attemptCount=attemptCount==null?0:attemptCount; this.startedAt=startedAt; this.finishedAt=finishedAt; this.createdAt=Objects.requireNonNull(createdAt);
    }
    public static NodeExecution pending(UUID executionId, String nodeId, String nodeType, Map<String,Object> input) {
        return new NodeExecution(UUID.randomUUID(), executionId, nodeId, nodeType, NodeExecutionStatus.PENDING, input, null, null, 0, null, null, Instant.now());
    }
    public void start(Instant at){status=NodeExecutionStatus.RUNNING; startedAt=at; attemptCount++;}
    public void complete(Instant at, Map<String,Object> output){status=NodeExecutionStatus.SUCCESS; finishedAt=at; this.output=output==null?Map.of():Map.copyOf(output);}
    public UUID getId(){return id;} public UUID getExecutionId(){return executionId;} public String getNodeId(){return nodeId;} public String getNodeType(){return nodeType;}
    public NodeExecutionStatus getStatus(){return status;} public Map<String,Object> getInput(){return input;} public Map<String,Object> getOutput(){return output;} public Map<String,Object> getError(){return error;}
    public Integer getAttemptCount(){return attemptCount;} public Instant getStartedAt(){return startedAt;} public Instant getFinishedAt(){return finishedAt;} public Instant getCreatedAt(){return createdAt;}
}