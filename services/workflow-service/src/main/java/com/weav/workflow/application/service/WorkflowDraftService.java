package com.weav.workflow.application.service;

import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.port.out.ConnectionReferenceUnavailableException;
import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.usecase.CreateWorkflowUseCase;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.definition.ValidationIssue;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
public class WorkflowDraftService {

    private final CreateWorkflowUseCase createWorkflow;
    private final WorkflowRepository workflowRepository;
    private final WorkspaceAuthorization workspaceAuthorization;
    private final WorkspaceConnectionPort workspaceConnections;
    private final Optional<ConnectionReferencePort> connectionReferences;
    private final DefinitionValidator definitionValidator = new DefinitionValidator();

    public WorkflowDraftService(
            CreateWorkflowUseCase createWorkflow,
            WorkflowRepository workflowRepository,
            WorkspaceAuthorization workspaceAuthorization,
            WorkspaceConnectionPort workspaceConnections,
            Optional<ConnectionReferencePort> connectionReferences) {
        this.createWorkflow = Objects.requireNonNull(createWorkflow, "createWorkflow must not be null");
        this.workflowRepository = Objects.requireNonNull(workflowRepository, "workflowRepository must not be null");
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization, "workspaceAuthorization must not be null");
        this.workspaceConnections = Objects.requireNonNull(workspaceConnections, "workspaceConnections must not be null");
        this.connectionReferences = Objects.requireNonNull(connectionReferences, "connectionReferences must not be null");
    }

    @Transactional
    public Workflow create(CreateWorkflowCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        workspaceAuthorization.require(command.workspaceId(), command.actorId(), "WORKFLOW_CREATE");
        validateName(command.name());
        return createWorkflow.execute(command);
    }

    @Transactional
    public Workflow save(UUID workspaceId, UUID workflowId, UUID actorId, String name, String description,
                         WorkflowDefinition definition, Map<String, Object> editorState) {
        workspaceAuthorization.require(workspaceId, actorId, "WORKFLOW_EDIT");
        validateName(name);
        validateDefinition(definition);
        Map<String, Object> frozenEditorState = freezeEditorState(editorState);
        validateEditorState(frozenEditorState);
        Map<String, Object> serializedDefinition = toMap(definition);
        Set<UUID> newReferences = connectionIds(definition);

        Workflow beforeAuthorization = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        Set<UUID> existingReferences = connectionIds(beforeAuthorization.getDraftDefinition());
        requireReferenceProjectionIfNeeded(existingReferences, newReferences);

        for (UUID connectionId : newReferences) {
            workspaceConnections.authorizeAttachment(workspaceId, connectionId, actorId);
        }

        Workflow workflow = workflowRepository.lockByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        existingReferences = connectionIds(workflow.getDraftDefinition());
        requireReferenceProjectionIfNeeded(existingReferences, newReferences);
        connectionReferences.ifPresent(port -> port.replaceDraft(workflowId, newReferences));

        workflow.updateDraft(name, description, serializedDefinition, frozenEditorState);
        return workflowRepository.save(workflow);
    }

    @Transactional(readOnly = true)
    public Workflow get(UUID workspaceId, UUID workflowId, UUID actorId) {
        workspaceAuthorization.require(workspaceId, actorId, "WORKSPACE_VIEW");
        return workflowRepository.findByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
    }

    @Transactional(readOnly = true)
    public WorkflowPage list(UUID workspaceId, UUID actorId, int page, int size) {
        workspaceAuthorization.require(workspaceId, actorId, "WORKSPACE_VIEW");
        validatePage(page, size);
        long offset = (long) page * size;
        if (offset > Integer.MAX_VALUE) {
            throw new BadRequestException("Workflow page is out of range");
        }
        return new WorkflowPage(workflowRepository.findPage(workspaceId, page, size),
                page, size, workflowRepository.countByWorkspace(workspaceId));
    }

    private void validateDefinition(WorkflowDefinition definition) {
        List<ValidationIssue> issues = definitionValidator.validateDraft(definition);
        if (!issues.isEmpty()) {
            throw new WorkflowDraftValidationException(issues);
        }
    }

    private void validateEditorState(Map<String, Object> editorState) {
        List<ValidationIssue> issues = definitionValidator.validateEditorState(editorState);
        if (!issues.isEmpty()) {
            throw new WorkflowDraftValidationException(issues);
        }
    }

    private Map<String, Object> freezeEditorState(Map<String, Object> editorState) {
        if (editorState == null) {
            return null;
        }
        try {
            validateEditorStateDepth(editorState);
            return JsonValues.freezeMap(editorState);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException("Editor state is invalid");
        }
    }

    private void validateEditorStateDepth(Map<String, Object> editorState) {
        Deque<DepthEntry> pending = new ArrayDeque<>();
        IdentityHashMap<Object, Boolean> activeContainers = new IdentityHashMap<>();
        pending.addLast(new DepthEntry(editorState, 1, false));
        while (!pending.isEmpty()) {
            DepthEntry entry = pending.removeLast();
            if (entry.exit()) {
                activeContainers.remove(entry.value());
                continue;
            }
            if (!(entry.value() instanceof Map<?, ?>) && !(entry.value() instanceof List<?>)) {
                continue;
            }
            if (entry.depth() > DefinitionValidator.MAX_JSON_DEPTH) {
                throw new IllegalArgumentException("editor state exceeds the supported depth");
            }
            if (activeContainers.put(entry.value(), Boolean.TRUE) != null) {
                throw new IllegalArgumentException("editor state contains a cyclic value");
            }
            pending.addLast(new DepthEntry(entry.value(), entry.depth(), true));
            int childDepth = entry.depth() + 1;
            if (entry.value() instanceof Map<?, ?> object) {
                object.values().forEach(value -> pending.addLast(new DepthEntry(value, childDepth, false)));
            } else if (entry.value() instanceof List<?> array) {
                array.forEach(value -> pending.addLast(new DepthEntry(value, childDepth, false)));
            }
        }
    }

    private Map<String, Object> toMap(WorkflowDefinition definition) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", definition.schemaVersion());
        List<Object> nodes = new ArrayList<>(definition.nodes().size());
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null) {
                nodes.add(null);
                continue;
            }
            Map<String, Object> serialized = new LinkedHashMap<>();
            serialized.put("id", node.id());
            serialized.put("type", node.type());
            serialized.put("config", node.config());
            nodes.add(serialized);
        }
        result.put("nodes", nodes);
        List<Object> edges = new ArrayList<>(definition.edges().size());
        for (WorkflowDefinition.Edge edge : definition.edges()) {
            if (edge == null) {
                edges.add(null);
                continue;
            }
            Map<String, Object> serialized = new LinkedHashMap<>();
            serialized.put("id", edge.id());
            serialized.put("source", edge.source());
            serialized.put("target", edge.target());
            serialized.put("sourcePort", edge.sourcePort());
            edges.add(serialized);
        }
        result.put("edges", edges);
        result.put("variables", definition.variables());
        return JsonValues.freezeMap(result);
    }

    private Set<UUID> connectionIds(WorkflowDefinition definition) {
        LinkedHashSet<UUID> ids = new LinkedHashSet<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node != null) {
                addConnectionId(node.config().get("connectionId"), ids);
            }
        }
        return Set.copyOf(ids);
    }

    private Set<UUID> connectionIds(Map<String, Object> definition) {
        Object nodesValue = definition.get("nodes");
        if (!(nodesValue instanceof List<?> nodes)) {
            return Set.of();
        }
        LinkedHashSet<UUID> ids = new LinkedHashSet<>();
        for (Object nodeValue : nodes) {
            if (!(nodeValue instanceof Map<?, ?> node)) {
                continue;
            }
            Object configValue = node.get("config");
            if (!(configValue instanceof Map<?, ?> config)) {
                continue;
            }
            if (config.containsKey("connectionId")) {
                addConnectionId(config.get("connectionId"), ids);
            }
        }
        return Set.copyOf(ids);
    }

    private void addConnectionId(Object value, Set<UUID> ids) {
        if (value == null) {
            return;
        }
        if (!(value instanceof String text)) {
            throw new ConnectionReferenceUnavailableException();
        }
        try {
            UUID id = UUID.fromString(text);
            if (!id.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            ids.add(id);
        } catch (IllegalArgumentException exception) {
            throw new ConnectionReferenceUnavailableException();
        }
    }

    private void requireReferenceProjectionIfNeeded(Set<UUID> previous, Set<UUID> next) {
        if ((!previous.isEmpty() || !next.isEmpty()) && connectionReferences.isEmpty()) {
            throw new ConnectionReferenceUnavailableException();
        }
    }

    private void validateName(String name) {
        if (name == null || name.isBlank() || name.length() > 255) {
            throw new BadRequestException("Workflow name is invalid");
        }
    }

    private void validatePage(int page, int size) {
        if (page < 0 || size < 1 || size > 100) {
            throw new BadRequestException("Workflow page bounds are invalid");
        }
    }

    private record DepthEntry(Object value, int depth, boolean exit) {
    }

    public record WorkflowPage(List<Workflow> items, int page, int size, long totalElements) {
        public WorkflowPage {
            items = List.copyOf(items);
        }
    }
}
