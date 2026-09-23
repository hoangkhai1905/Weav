package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.port.out.ConnectionReferenceUnavailableException;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.node.IntegrationReadiness;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.ValidationIssue;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.exception.ResourceNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/** Coordinates immutable publication and state changes in one workflow transaction. */
@Service
public class WorkflowPublicationService {

    private static final String PUBLISH_CAPABILITY = "WORKFLOW_PUBLISH";
    private static final String STATE_CAPABILITY = "WORKFLOW_MANAGE_STATE";

    private final WorkflowRepository workflowRepository;
    private final WorkflowVersionPort versions;
    private final WorkflowTriggerPort triggers;
    private final WorkspaceAuthorization workspaceAuthorization;
    private final WorkspaceConnectionPort workspaceConnections;
    private final Optional<ConnectionReferencePort> connectionReferences;
    private final ScheduleValidationPort schedules;
    private final WebhookSecretPort webhookSecrets;
    private final DefinitionValidator definitionValidator;

    public WorkflowPublicationService(
            WorkflowRepository workflowRepository,
            WorkflowVersionPort versions,
            WorkflowTriggerPort triggers,
            WorkspaceAuthorization workspaceAuthorization,
            WorkspaceConnectionPort workspaceConnections,
            Optional<ConnectionReferencePort> connectionReferences,
            ScheduleValidationPort schedules,
            WebhookSecretPort webhookSecrets) {
        this.workflowRepository = Objects.requireNonNull(workflowRepository, "workflowRepository must not be null");
        this.versions = Objects.requireNonNull(versions, "versions must not be null");
        this.triggers = Objects.requireNonNull(triggers, "triggers must not be null");
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization,
                "workspaceAuthorization must not be null");
        this.workspaceConnections = Objects.requireNonNull(workspaceConnections,
                "workspaceConnections must not be null");
        this.connectionReferences = Objects.requireNonNull(connectionReferences,
                "connectionReferences must not be null");
        this.schedules = Objects.requireNonNull(schedules, "schedules must not be null");
        this.webhookSecrets = Objects.requireNonNull(webhookSecrets, "webhookSecrets must not be null");
        this.definitionValidator = new DefinitionValidator(schedules);
    }

    @Transactional
    public Publication publish(UUID workspaceId, UUID workflowId, UUID actorId) {
        workspaceAuthorization.require(workspaceId, actorId, PUBLISH_CAPABILITY);

        Workflow beforeAuthorization = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        WorkflowDefinition validatedDefinition = definitionFor(beforeAuthorization);
        validateForPublish(validatedDefinition);
        Set<UUID> referencedConnections = connectionIds(validatedDefinition);
        for (UUID connectionId : referencedConnections) {
            workspaceConnections.authorizeAttachment(workspaceId, connectionId, actorId);
        }
        requireReferenceProjection(referencedConnections);

        Workflow locked = workflowRepository.lockByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        if (!samePublishSnapshot(beforeAuthorization, locked)) {
            throw new DraftChangedException();
        }

        WorkflowStatus previousStatus = locked.getStatus();
        int versionNumber = versions.nextNumber(workflowId);
        Instant publishedAt = Instant.now();
        WorkflowVersion version = WorkflowVersion.createNew(workflowId, versionNumber,
                beforeAuthorization.getDraftDefinition(), beforeAuthorization.getSchemaVersion(), actorId);
        versions.insert(version);

        locked.publishVersion(version.getId(), publishedAt);
        workflowRepository.save(locked);

        List<WebhookProvisioning> webhookProvisionings = new ArrayList<>();
        List<WorkflowTrigger> newTriggers = triggersFor(workflowId, version.getId(), validatedDefinition,
                previousStatus == WorkflowStatus.PAUSED, publishedAt, webhookProvisionings);
        triggers.replaceCurrent(workflowId, version.getId(), newTriggers);
        connectionReferences.ifPresent(port -> port.appendVersion(workflowId, version.getId(), referencedConnections));

        return new Publication(workflowId, version.getId(), versionNumber, locked.getStatus(), webhookProvisionings);
    }

    @Transactional
    public Workflow pause(UUID workspaceId, UUID workflowId, UUID actorId) {
        return changeState(workspaceId, workflowId, actorId, true);
    }

    @Transactional
    public Workflow resume(UUID workspaceId, UUID workflowId, UUID actorId) {
        return changeState(workspaceId, workflowId, actorId, false);
    }

    /** Current registration detail; callers must authorize the workflow before requesting this projection. */
    public List<WorkflowTrigger> currentTriggers(UUID workflowId, UUID versionId) {
        if (versionId == null) {
            return List.of();
        }
        return triggers.findCurrent(workflowId, versionId);
    }

    private Workflow changeState(UUID workspaceId, UUID workflowId, UUID actorId, boolean pause) {
        workspaceAuthorization.require(workspaceId, actorId, STATE_CAPABILITY);
        Workflow workflow = workflowRepository.lockByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        if (workflow.getCurrentVersionId() == null) {
            throw new InvalidStateException(pause
                    ? "A workflow must have a published version before it can be paused"
                    : "A workflow must have a published version before it can be resumed");
        }

        if (pause) {
            workflow.pause();
            triggers.setCurrentEnabled(workflowId, workflow.getCurrentVersionId(), false,
                    Instant.now(), java.util.Map.of());
        } else {
            workflow.resume();
            Instant resumedAt = Instant.now();
            Map<UUID, Instant> nextRuns = new HashMap<>();
            for (WorkflowTrigger trigger : triggers.findCurrent(workflowId, workflow.getCurrentVersionId())) {
                if (trigger.getType() == TriggerType.SCHEDULE
                        && IntegrationReadiness.forType("trigger.schedule").configured()) {
                    nextRuns.put(trigger.getId(), schedules.next(stringConfig(trigger, "cron"),
                            stringConfig(trigger, "timezone"), resumedAt));
                }
            }
            triggers.setCurrentEnabled(workflowId, workflow.getCurrentVersionId(), true, resumedAt, nextRuns);
        }
        return workflowRepository.save(workflow);
    }

    private boolean samePublishSnapshot(Workflow first, Workflow current) {
        return first.getSchemaVersion().equals(current.getSchemaVersion())
                && first.getDraftDefinition().equals(current.getDraftDefinition());
    }

    private void validateForPublish(WorkflowDefinition definition) {
        List<ValidationIssue> issues = definitionValidator.validatePublish(definition);
        if (issues.isEmpty()) {
            return;
        }
        if (issues.size() == 1 && "SCHEDULE_VALIDATION_UNAVAILABLE".equals(issues.getFirst().code())) {
            throw new TriggerDependencyUnavailableException();
        }
        throw new WorkflowDraftValidationException(issues);
    }

    private WorkflowDefinition definitionFor(Workflow workflow) {
        Map<String, Object> stored = workflow.getDraftDefinition();
        Object schemaValue = stored.get("schemaVersion");
        Object nodesValue = stored.get("nodes");
        Object edgesValue = stored.get("edges");
        Object variablesValue = stored.get("variables");
        if (!(nodesValue instanceof List<?> rawNodes) || !(edgesValue instanceof List<?> rawEdges)
                || variablesValue != null && !(variablesValue instanceof Map<?, ?>)) {
            throw invalidStoredDefinition();
        }

        List<WorkflowDefinition.Node> nodes = new ArrayList<>(rawNodes.size());
        for (Object rawNode : rawNodes) {
            if (rawNode == null) {
                nodes.add(null);
                continue;
            }
            if (!(rawNode instanceof Map<?, ?> node)) {
                nodes.add(null);
                continue;
            }
            Object configValue = node.get("config");
            if (!(configValue instanceof Map<?, ?> config)) {
                throw invalidStoredDefinition();
            }
            nodes.add(new WorkflowDefinition.Node(stringOrNull(node.get("id")),
                    stringOrNull(node.get("type")), stringMap(config)));
        }

        List<WorkflowDefinition.Edge> edges = new ArrayList<>(rawEdges.size());
        for (Object rawEdge : rawEdges) {
            if (!(rawEdge instanceof Map<?, ?> edge)) {
                edges.add(null);
                continue;
            }
            edges.add(new WorkflowDefinition.Edge(stringOrNull(edge.get("id")),
                    stringOrNull(edge.get("source")), stringOrNull(edge.get("target")),
                    stringOrNull(edge.get("sourcePort"))));
        }

        Map<String, Object> variables = variablesValue == null
                ? Map.of()
                : stringMap((Map<?, ?>) variablesValue);
        return new WorkflowDefinition(stringOrNull(schemaValue), nodes, edges, variables);
    }

    private WorkflowDraftValidationException invalidStoredDefinition() {
        return new WorkflowDraftValidationException(List.of(new ValidationIssue(
                null, "definition", "INVALID_DEFINITION", "The stored workflow definition is malformed.")));
    }

    private Map<String, Object> stringMap(Map<?, ?> source) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : source.entrySet()) {
            if (!(entry.getKey() instanceof String key)) {
                throw invalidStoredDefinition();
            }
            result.put(key, entry.getValue());
        }
        return result;
    }

    private String stringOrNull(Object value) {
        return value instanceof String text ? text : null;
    }

    private Set<UUID> connectionIds(WorkflowDefinition definition) {
        LinkedHashSet<UUID> result = new LinkedHashSet<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null || !node.config().containsKey("connectionId")) {
                continue;
            }
            Object value = node.config().get("connectionId");
            if (value == null) {
                continue;
            }
            try {
                String text = (String) value;
                UUID connectionId = UUID.fromString(text);
                if (!connectionId.toString().equalsIgnoreCase(text)) {
                    throw new IllegalArgumentException();
                }
                result.add(connectionId);
            } catch (RuntimeException exception) {
                throw new WorkflowDraftValidationException(List.of(new ValidationIssue(
                        node.id(), "config.connectionId", "INVALID_CONNECTION_ID",
                        "A connection reference must be a literal UUID.")));
            }
        }
        return Set.copyOf(result);
    }

    private void requireReferenceProjection(Set<UUID> referencedConnections) {
        if (!referencedConnections.isEmpty() && connectionReferences.isEmpty()) {
            throw new ConnectionReferenceUnavailableException();
        }
    }

    private List<WorkflowTrigger> triggersFor(
            UUID workflowId, UUID versionId, WorkflowDefinition definition, boolean workflowPaused,
            Instant publishedAt, List<WebhookProvisioning> webhookProvisionings) {
        List<WorkflowTrigger> result = new ArrayList<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null) {
                continue;
            }
            TriggerType type = triggerType(node.type());
            if (type == null) {
                continue;
            }
            IntegrationReadiness.Readiness readiness = IntegrationReadiness.forType(node.type());
            boolean enabled = !workflowPaused && readiness.configured();
            Instant nextRunAt = enabled && type == TriggerType.SCHEDULE
                    ? schedules.next(stringConfig(node.config(), "cron"),
                            stringConfig(node.config(), "timezone"), publishedAt)
                    : null;
            Map<String, Object> lastError = readiness.configured()
                    ? null
                    : Map.of("code", readiness.reasonCode());
            WorkflowTrigger trigger = WorkflowTrigger.createNew(workflowId, versionId, node.id(), type,
                    node.config(), enabled
                            ? com.weav.workflow.domain.valueobject.TriggerStatus.ACTIVE
                            : com.weav.workflow.domain.valueobject.TriggerStatus.DISABLED,
                    nextRunAt, lastError, publishedAt);
            if (type == TriggerType.WEBHOOK) {
                WebhookSecretPort.IssuedKey issued = webhookSecrets.provision();
                trigger.provisionWebhook(issued.endpointKey(), issued.secretHash());
                webhookProvisionings.add(new WebhookProvisioning(trigger.getId(),
                        issued.endpointKey(), issued.secret()));
            }
            result.add(trigger);
        }
        return List.copyOf(result);
    }

    private String stringConfig(WorkflowTrigger trigger, String field) {
        return stringConfig(trigger.getConfig(), field);
    }

    private String stringConfig(Map<String, Object> config, String field) {
        Object value = config.get(field);
        if (value instanceof String text && !text.isBlank()) {
            return text;
        }
        throw new IllegalStateException("Stored schedule registration is missing validated configuration");
    }

    private TriggerType triggerType(String nodeType) {
        return switch (nodeType) {
            case "trigger.schedule" -> TriggerType.SCHEDULE;
            case "trigger.webhook" -> TriggerType.WEBHOOK;
            case "trigger.telegram" -> TriggerType.TELEGRAM;
            default -> null;
        };
    }

    public record Publication(
            UUID workflowId,
            UUID versionId,
            int version,
            WorkflowStatus status,
            List<WebhookProvisioning> webhooks) {
        public Publication {
            webhooks = List.copyOf(webhooks);
        }
    }

    /** Response-only one-time provisioning material with a redacted string representation. */
    public record WebhookProvisioning(UUID triggerId, String endpointKey, String secret) {
        @Override
        public String toString() {
            return "WebhookProvisioning[triggerId=" + triggerId
                    + ", endpointKey=<redacted>, secret=<redacted>]";
        }
    }
}
