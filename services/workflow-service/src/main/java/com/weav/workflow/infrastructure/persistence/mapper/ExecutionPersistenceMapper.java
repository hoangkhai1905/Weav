package com.weav.workflow.infrastructure.persistence.mapper;

import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.WorkflowExecution;
import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import com.weav.workflow.infrastructure.persistence.entity.NodeExecutionJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.OutboxEventJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowExecutionJpaEntity;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Maps execution delivery state without erasing JSON array, scalar, or null inputs. */
@Component
public final class ExecutionPersistenceMapper {
    private final ObjectMapper objectMapper;

    public ExecutionPersistenceMapper(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    public WorkflowExecutionJpaEntity toEntity(WorkflowExecution execution) {
        Objects.requireNonNull(execution, "execution must not be null");
        return new WorkflowExecutionJpaEntity(
                execution.getId(), execution.getWorkflowId(), execution.getWorkflowVersionId(),
                execution.getStatus(), execution.getTriggerType(), execution.getTriggerId(),
                execution.getTriggeredBy(), execution.getRootNodeId(), json(execution.getInput()),
                json(execution.getOutput()), json(execution.getError()), execution.getStartedAt(),
                execution.getFinishedAt(), execution.getCreatedAt(), null, execution.getCorrelationId(),
                execution.getTraceparent(), execution.getScheduledAt(), json(execution.getEdgeStates()),
                execution.getLeaseOwner(), execution.getLeaseToken(), execution.getLeaseUntil());
    }

    public WorkflowExecution toDomain(WorkflowExecutionJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        return new WorkflowExecution(entity.getId(), entity.getWorkflowId(), entity.getWorkflowVersionId(),
                entity.getTriggerType(), entity.getTriggerId(), entity.getStatus(), entity.getTriggeredBy(),
                entity.getRootNodeId(), value(entity.getInput()), objectMap(entity.getOutput()),
                objectMap(entity.getError()), entity.getStartedAt(), entity.getFinishedAt(), entity.getCreatedAt(),
                entity.getCorrelationId(), entity.getTraceparent(), entity.getScheduledAt(),
                objectMap(entity.getEdgeStates()), entity.getLeaseOwner(),
                entity.getLeaseToken() == null ? 0L : entity.getLeaseToken(), entity.getLeaseUntil());
    }

    public NodeExecutionJpaEntity toEntity(NodeExecution execution) {
        Objects.requireNonNull(execution, "execution must not be null");
        return new NodeExecutionJpaEntity(execution.getId(), execution.getExecutionId(), execution.getNodeId(),
                execution.getNodeType(), execution.getStatus(), json(execution.getInput()),
                json(execution.getOutput()), json(execution.getError()), execution.getAttemptCount(),
                execution.getStartedAt(), execution.getFinishedAt(), execution.getCreatedAt(),
                execution.getNextAttemptAt());
    }

    public NodeExecution toDomain(NodeExecutionJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        return new NodeExecution(entity.getId(), entity.getExecutionId(), entity.getNodeId(), entity.getNodeType(),
                entity.getStatus(), objectMap(entity.getInput()), objectMap(entity.getOutput()),
                objectMap(entity.getError()), entity.getAttemptCount(), entity.getStartedAt(),
                entity.getFinishedAt(), entity.getCreatedAt(), entity.getNextAttemptAt());
    }

    public OutboxEventJpaEntity toEntity(OutboxEvent event) {
        Objects.requireNonNull(event, "event must not be null");
        return new OutboxEventJpaEntity(event.getId(), event.getAggregateType(), event.getAggregateId(),
                event.getEventType(), json(event.getPayload()), event.getStatus(), event.getCreatedAt(),
                event.getPublishedAt(), event.getRetryCount(), event.getPublisherLeaseToken(),
                event.getPublisherLeaseUntil(), event.getNextAttemptAt());
    }

    public OutboxEvent toDomain(OutboxEventJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        return new OutboxEvent(entity.getId(), entity.getAggregateType(), entity.getAggregateId(),
                entity.getEventType(), objectMap(entity.getPayload()), entity.getStatus(), entity.getCreatedAt(),
                entity.getPublishedAt(), entity.getRetryCount(), entity.getPublisherLeaseToken(),
                entity.getPublisherLeaseUntil(), entity.getNextAttemptAt());
    }

    private JsonNode json(Object value) {
        return objectMapper.valueToTree(value);
    }

    private Object value(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (node.isObject()) return objectMap(node);
        if (node.isArray()) {
            List<Object> values = new ArrayList<>(node.size());
            for (JsonNode item : node) values.add(value(item));
            return values;
        }
        if (node.isString()) return node.stringValue();
        if (node.isBoolean()) return node.booleanValue();
        if (node.isNumber()) return node.numberValue();
        throw new IllegalStateException("Persisted execution JSON contains a non-JSON value");
    }

    private Map<String, Object> objectMap(JsonNode node) {
        if (node == null || node.isNull()) return null;
        if (!node.isObject()) {
            throw new IllegalStateException("Persisted execution JSON object is malformed");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> property : node.properties()) {
            values.put(property.getKey(), value(property.getValue()));
        }
        return values;
    }
}
