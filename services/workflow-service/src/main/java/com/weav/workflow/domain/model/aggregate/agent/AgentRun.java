package com.weav.workflow.domain.model.aggregate.agent;

import com.weav.workflow.domain.valueobject.AgentRunStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class AgentRun {
    private final UUID id; private final UUID nodeExecutionAttemptId; private AgentRunStatus status;
    private final String resolvedGoal; private final Map<String,Object> allowedTools; private Map<String,Object> state;
    private Integer stepCount; private final Integer maxSteps; private Map<String,Object> finalOutput; private Map<String,Object> error;
    private final Instant startedAt; private Instant finishedAt; private final Instant createdAt; private Instant updatedAt;
    public AgentRun(UUID id, UUID nodeExecutionAttemptId, AgentRunStatus status, String resolvedGoal, Map<String,Object> allowedTools,
                    Map<String,Object> state, Integer stepCount, Integer maxSteps, Map<String,Object> finalOutput, Map<String,Object> error,
                    Instant startedAt, Instant finishedAt, Instant createdAt, Instant updatedAt) {
        this.id=Objects.requireNonNull(id); this.nodeExecutionAttemptId=Objects.requireNonNull(nodeExecutionAttemptId); this.status=Objects.requireNonNull(status);
        this.resolvedGoal=Objects.requireNonNull(resolvedGoal); this.allowedTools=allowedTools==null?Map.of():Map.copyOf(allowedTools); this.state=state==null?Map.of():Map.copyOf(state);
        this.stepCount=stepCount==null?0:stepCount; this.maxSteps=Objects.requireNonNull(maxSteps); this.finalOutput=finalOutput==null?Map.of():Map.copyOf(finalOutput); this.error=error==null?Map.of():Map.copyOf(error);
        this.startedAt=Objects.requireNonNull(startedAt); this.finishedAt=finishedAt; this.createdAt=Objects.requireNonNull(createdAt); this.updatedAt=Objects.requireNonNull(updatedAt);
    }
    public static AgentRun start(UUID attemptId, String goal, Map<String,Object> allowedTools, Map<String,Object> state, int maxSteps) {
        Instant now=Instant.now(); return new AgentRun(UUID.randomUUID(), attemptId, AgentRunStatus.RUNNING, goal, allowedTools, state, 0, maxSteps, null, null, now, null, now, now);
    }
    public void succeed(Map<String,Object> output, Instant at){status=AgentRunStatus.SUCCESS; finalOutput=output==null?Map.of():Map.copyOf(output); finishedAt=at; updatedAt=at;}
    public void fail(Map<String,Object> details, Instant at){status=AgentRunStatus.FAILED; error=details==null?Map.of():Map.copyOf(details); finishedAt=at; updatedAt=at;}
    public void countStep(){stepCount++; updatedAt=Instant.now();}
    public UUID getId(){return id;} public UUID getNodeExecutionAttemptId(){return nodeExecutionAttemptId;} public AgentRunStatus getStatus(){return status;} public String getResolvedGoal(){return resolvedGoal;}
    public Map<String,Object> getAllowedTools(){return allowedTools;} public Map<String,Object> getState(){return state;} public Integer getStepCount(){return stepCount;} public Integer getMaxSteps(){return maxSteps;}
    public Map<String,Object> getFinalOutput(){return finalOutput;} public Map<String,Object> getError(){return error;} public Instant getStartedAt(){return startedAt;} public Instant getFinishedAt(){return finishedAt;}
    public Instant getCreatedAt(){return createdAt;} public Instant getUpdatedAt(){return updatedAt;}
}