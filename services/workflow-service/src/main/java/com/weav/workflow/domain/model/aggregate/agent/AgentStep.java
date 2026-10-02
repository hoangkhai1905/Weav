package com.weav.workflow.domain.model.aggregate.agent;

import com.weav.workflow.domain.valueobject.AgentStepDecisionType;
import com.weav.workflow.domain.valueobject.AgentStepStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class AgentStep {
    private final UUID id; private final UUID agentRunId; private final Integer stepNumber; private final AgentStepDecisionType decisionType; private AgentStepStatus status;
    private String toolName; private Map<String,Object> toolArguments; private Map<String,Object> toolResult; private String provider; private String model; private Map<String,Object> usage; private Map<String,Object> error;
    private final Instant startedAt; private Instant finishedAt; private final Instant createdAt;
    public AgentStep(UUID id, UUID agentRunId, Integer stepNumber, AgentStepDecisionType decisionType, AgentStepStatus status,
                     String toolName, Map<String,Object> toolArguments, Map<String,Object> toolResult, String provider, String model,
                     Map<String,Object> usage, Map<String,Object> error, Instant startedAt, Instant finishedAt, Instant createdAt) {
        this.id=Objects.requireNonNull(id); this.agentRunId=Objects.requireNonNull(agentRunId); this.stepNumber=Objects.requireNonNull(stepNumber); this.decisionType=Objects.requireNonNull(decisionType); this.status=Objects.requireNonNull(status);
        this.toolName=toolName; this.toolArguments=toolArguments==null?Map.of():Map.copyOf(toolArguments); this.toolResult=toolResult==null?Map.of():Map.copyOf(toolResult); this.provider=provider; this.model=model; this.usage=usage==null?Map.of():Map.copyOf(usage); this.error=error==null?Map.of():Map.copyOf(error);
        this.startedAt=Objects.requireNonNull(startedAt); this.finishedAt=finishedAt; this.createdAt=Objects.requireNonNull(createdAt);
    }
    public static AgentStep start(UUID agentRunId, int stepNumber, AgentStepDecisionType decisionType) {
        Instant now=Instant.now(); return new AgentStep(UUID.randomUUID(), agentRunId, stepNumber, decisionType, AgentStepStatus.RUNNING, null, null, null, null, null, null, null, now, null, now);
    }
    public void succeed(Map<String,Object> result, Instant at){status=AgentStepStatus.SUCCESS; toolResult=result==null?Map.of():Map.copyOf(result); finishedAt=at;}
    public UUID getId(){return id;} public UUID getAgentRunId(){return agentRunId;} public Integer getStepNumber(){return stepNumber;} public AgentStepDecisionType getDecisionType(){return decisionType;} public AgentStepStatus getStatus(){return status;}
    public String getToolName(){return toolName;} public Map<String,Object> getToolArguments(){return toolArguments;} public Map<String,Object> getToolResult(){return toolResult;} public String getProvider(){return provider;} public String getModel(){return model;} public Map<String,Object> getUsage(){return usage;} public Map<String,Object> getError(){return error;}
    public Instant getStartedAt(){return startedAt;} public Instant getFinishedAt(){return finishedAt;} public Instant getCreatedAt(){return createdAt;}
}