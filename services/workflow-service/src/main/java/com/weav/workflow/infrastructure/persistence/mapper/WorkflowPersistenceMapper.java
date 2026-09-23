package com.weav.workflow.infrastructure.persistence.mapper;

import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowTriggerJpaEntity;
import com.weav.workflow.infrastructure.persistence.entity.WorkflowVersionJpaEntity;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

@Component
public final class WorkflowPersistenceMapper {

    private final ObjectMapper objectMapper;

    public WorkflowPersistenceMapper(ObjectMapper objectMapper) {
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    public WorkflowJpaEntity toEntity(Workflow workflow) {
        Objects.requireNonNull(workflow, "workflow must not be null");
        return new WorkflowJpaEntity(
                workflow.getId(),
                workflow.getWorkspaceId(),
                workflow.getName(),
                workflow.getDescription(),
                workflow.getStatus(),
                workflow.getSchemaVersion(),
                objectMapper.valueToTree(workflow.getDraftDefinition()),
                workflow.getEditorState() == null ? null : objectMapper.valueToTree(workflow.getEditorState()),
                workflow.getCurrentVersionId(),
                workflow.getCreatedBy(),
                workflow.getCreatedAt(),
                workflow.getUpdatedAt(),
                workflow.getPublishedAt(),
                workflow.getDeletedAt(),
                workflow.getDeletedBy());
    }

    public WorkflowVersionJpaEntity toEntity(WorkflowVersion version) {
        Objects.requireNonNull(version, "version must not be null");
        return new WorkflowVersionJpaEntity(version.getId(), version.getWorkflowId(), version.getVersionNumber(),
                objectMapper.valueToTree(version.getDefinition()), version.getSchemaVersion(),
                version.getPublishedBy(), version.getCreatedAt());
    }

    public WorkflowTriggerJpaEntity toEntity(WorkflowTrigger trigger) {
        Objects.requireNonNull(trigger, "trigger must not be null");
        return new WorkflowTriggerJpaEntity(trigger.getId(), trigger.getWorkflowId(), trigger.getWorkflowVersionId(),
                trigger.getTriggerNodeId(), trigger.getType(), trigger.getStatus(),
                objectMapper.valueToTree(trigger.getConfig()), trigger.getEndpointKey(), trigger.getSecretHash(),
                trigger.getNextRunAt(), trigger.getLastTriggeredAt(),
                trigger.getLastError().isEmpty() ? null : objectMapper.valueToTree(trigger.getLastError()),
                trigger.getCreatedAt(), trigger.getUpdatedAt());
    }

    public Workflow toDomain(WorkflowJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        Map<String, Object> definition = objectMap(entity.getDraftDefinition());
        if (definition == null) {
            throw new IllegalStateException("Persisted workflow definition is missing");
        }
        return new Workflow(
                entity.getId(),
                entity.getWorkspaceId(),
                entity.getName(),
                entity.getDescription(),
                entity.getStatus(),
                entity.getSchemaVersion(),
                definition,
                objectMap(entity.getEditorState()),
                entity.getCurrentVersionId(),
                entity.getCreatedBy(),
                entity.getCreatedAt(),
                entity.getUpdatedAt(),
                entity.getPublishedAt(),
                entity.getDeletedAt(),
                entity.getDeletedBy());
    }

    public WorkflowVersion toDomain(WorkflowVersionJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        Map<String, Object> definition = objectMap(entity.getDefinition());
        if (definition == null) {
            throw new IllegalStateException("Persisted workflow version definition is missing");
        }
        return new WorkflowVersion(entity.getId(), entity.getWorkflowId(), entity.getVersionNumber(), definition,
                entity.getSchemaVersion(), entity.getPublishedBy(), entity.getCreatedAt());
    }

    public WorkflowTrigger toDomain(WorkflowTriggerJpaEntity entity) {
        Objects.requireNonNull(entity, "entity must not be null");
        return new WorkflowTrigger(entity.getId(), entity.getWorkflowId(), entity.getWorkflowVersionId(),
                entity.getTriggerNodeId(), entity.getType(), entity.getStatus(), objectMap(entity.getConfig()),
                entity.getEndpointKey(), entity.getSecretHash(), entity.getNextRunAt(), entity.getLastTriggeredAt(),
                objectMap(entity.getLastError()), entity.getCreatedAt(), entity.getUpdatedAt());
    }

    public JsonNode toJsonNode(Object value) {
        return objectMapper.valueToTree(value);
    }

    public void updateEntity(WorkflowJpaEntity entity, Workflow workflow) {
        Objects.requireNonNull(entity, "entity must not be null");
        Objects.requireNonNull(workflow, "workflow must not be null");
        if (!entity.getId().equals(workflow.getId())
                || !entity.getWorkspaceId().equals(workflow.getWorkspaceId())) {
            throw new IllegalArgumentException("Workflow identity cannot be changed during persistence mapping");
        }
        entity.setName(workflow.getName());
        entity.setDescription(workflow.getDescription());
        entity.setStatus(workflow.getStatus());
        entity.setSchemaVersion(workflow.getSchemaVersion());
        entity.setDraftDefinition(objectMapper.valueToTree(workflow.getDraftDefinition()));
        entity.setEditorState(workflow.getEditorState() == null ? null : objectMapper.valueToTree(workflow.getEditorState()));
        entity.setCurrentVersionId(workflow.getCurrentVersionId());
        entity.setPublishedAt(workflow.getPublishedAt());
        entity.setDeletedAt(workflow.getDeletedAt());
        entity.setDeletedBy(workflow.getDeletedBy());
    }

    private Map<String, Object> objectMap(JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        if (!node.isObject()) {
            throw new IllegalStateException("Persisted workflow JSON object is malformed");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> property : node.properties()) {
            result.put(property.getKey(), jsonValue(property.getValue()));
        }
        return result;
    }

    private Object jsonValue(JsonNode node) {
        if (node.isNull()) {
            return null;
        }
        if (node.isString()) {
            return node.stringValue();
        }
        if (node.isBoolean()) {
            return node.booleanValue();
        }
        if (node.isNumber()) {
            return node.numberValue();
        }
        if (node.isArray()) {
            List<Object> result = new ArrayList<>(node.size());
            for (JsonNode item : node) {
                result.add(jsonValue(item));
            }
            return result;
        }
        if (node.isObject()) {
            return objectMap(node);
        }
        throw new IllegalStateException("Persisted workflow JSON contains a non-JSON value");
    }
}
