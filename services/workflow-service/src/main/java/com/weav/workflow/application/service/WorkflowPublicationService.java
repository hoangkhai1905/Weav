package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.port.out.ConnectionReferenceUnavailableException;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.TelegramWebhookPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.application.port.out.WorkflowNotificationOutboxPort;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

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

    private static final Logger log = LoggerFactory.getLogger(WorkflowPublicationService.class);
    /** Registration runs inside the publish transaction, one short call per bot, so the count is bounded. */
    public static final int MAX_TELEGRAM_TRIGGERS = 5;

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
    private final WorkflowNotificationOutboxPort notificationOutbox;
    private final TransactionOperations transactions;
    private final Optional<TelegramWebhookPort> telegram;

    public WorkflowPublicationService(
            WorkflowRepository workflowRepository,
            WorkflowVersionPort versions,
            WorkflowTriggerPort triggers,
            WorkspaceAuthorization workspaceAuthorization,
            WorkspaceConnectionPort workspaceConnections,
            Optional<ConnectionReferencePort> connectionReferences,
            ScheduleValidationPort schedules,
            WebhookSecretPort webhookSecrets) {
        this(workflowRepository, versions, triggers, workspaceAuthorization, workspaceConnections,
                connectionReferences, schedules, webhookSecrets, event -> { });
    }

    public WorkflowPublicationService(
            WorkflowRepository workflowRepository,
            WorkflowVersionPort versions,
            WorkflowTriggerPort triggers,
            WorkspaceAuthorization workspaceAuthorization,
            WorkspaceConnectionPort workspaceConnections,
            Optional<ConnectionReferencePort> connectionReferences,
            ScheduleValidationPort schedules,
            WebhookSecretPort webhookSecrets,
            WorkflowNotificationOutboxPort notificationOutbox) {
        this(workflowRepository, versions, triggers, workspaceAuthorization, workspaceConnections,
                connectionReferences, schedules, webhookSecrets, notificationOutbox,
                TransactionOperations.withoutTransaction());
    }

    public WorkflowPublicationService(
            WorkflowRepository workflowRepository,
            WorkflowVersionPort versions,
            WorkflowTriggerPort triggers,
            WorkspaceAuthorization workspaceAuthorization,
            WorkspaceConnectionPort workspaceConnections,
            Optional<ConnectionReferencePort> connectionReferences,
            ScheduleValidationPort schedules,
            WebhookSecretPort webhookSecrets,
            WorkflowNotificationOutboxPort notificationOutbox,
            TransactionOperations transactions) {
        this(workflowRepository, versions, triggers, workspaceAuthorization, workspaceConnections,
                connectionReferences, schedules, webhookSecrets, notificationOutbox, transactions,
                Optional.empty());
    }

    @Autowired
    public WorkflowPublicationService(
            WorkflowRepository workflowRepository,
            WorkflowVersionPort versions,
            WorkflowTriggerPort triggers,
            WorkspaceAuthorization workspaceAuthorization,
            WorkspaceConnectionPort workspaceConnections,
            Optional<ConnectionReferencePort> connectionReferences,
            ScheduleValidationPort schedules,
            WebhookSecretPort webhookSecrets,
            WorkflowNotificationOutboxPort notificationOutbox,
            TransactionOperations transactions,
            Optional<TelegramWebhookPort> telegram) {
        this.telegram = Objects.requireNonNull(telegram, "telegram must not be null");
        this.transactions = Objects.requireNonNull(transactions, "transactions must not be null");
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
        this.notificationOutbox = Objects.requireNonNull(notificationOutbox,
                "notificationOutbox must not be null");
    }

    /**
     * Remote Workspace checks run first with no transaction or pooled connection held; only the lock, the
     * snapshot re-check and the writes share one short transaction.
     */
    public Publication publish(UUID workspaceId, UUID workflowId, UUID actorId) {
        workspaceAuthorization.require(workspaceId, actorId, PUBLISH_CAPABILITY);

        Workflow beforeAuthorization = workflowRepository.findByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        WorkflowDefinition validatedDefinition = definitionFor(beforeAuthorization);
        validateForPublish(validatedDefinition);
        requireTelegramTriggerLimit(validatedDefinition);
        Set<UUID> referencedConnections = connectionIds(validatedDefinition);
        for (UUID connectionId : referencedConnections) {
            workspaceConnections.authorizeAttachment(workspaceId, connectionId, actorId);
        }
        requireReferenceProjection(referencedConnections);

        return transactions.execute(status -> publishLocked(workspaceId, workflowId, actorId,
                beforeAuthorization, validatedDefinition, referencedConnections));
    }

    private Publication publishLocked(UUID workspaceId, UUID workflowId, UUID actorId,
                                      Workflow beforeAuthorization, WorkflowDefinition validatedDefinition,
                                      Set<UUID> referencedConnections) {
        Workflow locked = workflowRepository.lockByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        if (!samePublishSnapshot(beforeAuthorization, locked)) {
            throw new DraftChangedException();
        }

        // Republishing an unchanged draft is a no-op: no version, no new webhook secret, no event.
        Publication unchanged = unchangedPublication(locked);
        if (unchanged != null) {
            return unchanged;
        }

        WorkflowStatus previousStatus = locked.getStatus();
        UUID previousVersionId = locked.getCurrentVersionId();
        String telegramBaseUrl = telegramBaseUrl();
        boolean telegramEnabled = previousStatus != WorkflowStatus.PAUSED && telegramBaseUrl != null;
        if (telegramEnabled) {
            requireTelegramBotsFree(validatedDefinition, workflowId);
        }
        int versionNumber = versions.nextNumber(workflowId);
        Instant publishedAt = Instant.now();
        WorkflowVersion version = WorkflowVersion.createNew(workflowId, versionNumber,
                beforeAuthorization.getDraftDefinition(), beforeAuthorization.getSchemaVersion(), actorId);
        versions.insert(version);

        locked.publishVersion(version.getId(), publishedAt);
        workflowRepository.save(locked);

        List<WebhookProvisioning> webhookProvisionings = new ArrayList<>();
        Map<UUID, String> telegramSecrets = new LinkedHashMap<>();
        List<WorkflowTrigger> newTriggers = triggersFor(workflowId, version.getId(), validatedDefinition,
                previousStatus == WorkflowStatus.PAUSED, publishedAt, webhookProvisionings, telegramSecrets);
        List<WorkflowTrigger> retired = previousVersionId == null
                ? List.of() : activeTelegramTriggers(triggers.findCurrent(workflowId, previousVersionId));
        triggers.replaceCurrent(workflowId, version.getId(), newTriggers);
        connectionReferences.ifPresent(port -> port.appendVersion(workflowId, version.getId(), referencedConnections));
        notificationOutbox.record(WorkflowNotificationEvent.lifecycle("workflow.published", locked.getWorkspaceId(),
                actorId, locked.getId(), locked.getName(), publishedAt));

        // Last step on purpose: a registration failure rolls everything above back. Telegram holds one webhook per
        // bot, so a bot that is registered again simply replaces the retired one. After a rollback (failed call or
        // failed commit) a retired trigger that is active again gets its webhook restored with a new secret, and
        // bots nobody serves any more are cleared; after a commit, bots this workflow no longer uses are cleared.
        List<WorkflowTrigger> activeTelegram = newTriggers.stream()
                .filter(trigger -> trigger.getType() == TriggerType.TELEGRAM
                        && trigger.getStatus() == com.weav.workflow.domain.valueobject.TriggerStatus.ACTIVE)
                .toList();
        registerTelegram(workspaceId, activeTelegram, telegramSecrets, telegramBaseUrl, retired);

        return new Publication(workflowId, version.getId(), versionNumber, locked.getStatus(), webhookProvisionings);
    }

    public Workflow pause(UUID workspaceId, UUID workflowId, UUID actorId) {
        return changeState(workspaceId, workflowId, actorId, true);
    }

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
        return transactions.execute(status -> changeStateLocked(workspaceId, workflowId, actorId, pause));
    }

    private Workflow changeStateLocked(UUID workspaceId, UUID workflowId, UUID actorId, boolean pause) {
        Workflow workflow = workflowRepository.lockByWorkspaceAndId(workspaceId, workflowId)
                .orElseThrow(() -> new ResourceNotFoundException("Workflow not found"));
        if (workflow.getCurrentVersionId() == null) {
            throw new InvalidStateException(pause
                    ? "A workflow must have a published version before it can be paused"
                    : "A workflow must have a published version before it can be resumed");
        }
        WorkflowStatus previousStatus = workflow.getStatus();

        List<WorkflowTrigger> telegramToResume = List.of();
        if (pause) {
            workflow.pause();
            Set<UUID> pausedBots = activeTelegramConnections(
                    triggers.findCurrent(workflowId, workflow.getCurrentVersionId()));
            triggers.setCurrentEnabled(workflowId, workflow.getCurrentVersionId(), false,
                    Instant.now(), java.util.Map.of());
            afterCompletion(() -> clearUnusedBots(workspaceId, pausedBots), () -> { });
        } else {
            workflow.resume();
            Instant resumedAt = Instant.now();
            telegramToResume = telegramTriggersToResume(workflowId, workflow.getCurrentVersionId());
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
        Workflow saved = workflowRepository.save(workflow);
        if (!telegramToResume.isEmpty()) {
            if (telegramBaseUrl() == null) {
                // Without a public https URL Telegram cannot deliver: keep the trigger off like a publish would.
                telegramToResume.forEach(trigger -> triggers.disableTelegramNotConfigured(trigger.getId()));
            } else {
                reRegisterTelegram(workspaceId, telegramToResume);
            }
        }
        if (saved.getStatus() != previousStatus) {
            String eventType = saved.getStatus() == WorkflowStatus.PAUSED
                    ? "workflow.paused" : "workflow.resumed";
            notificationOutbox.record(WorkflowNotificationEvent.lifecycle(eventType, saved.getWorkspaceId(),
                    actorId, saved.getId(), saved.getName(), Instant.now()));
        }
        return saved;
    }

    private Publication unchangedPublication(Workflow locked) {
        if (locked.getStatus() != WorkflowStatus.PUBLISHED || locked.getCurrentVersionId() == null) {
            return null;
        }
        WorkflowVersion current = versions.require(locked.getCurrentVersionId());
        if (current == null || !current.getSchemaVersion().equals(locked.getSchemaVersion())
                || !current.getDefinition().equals(locked.getDraftDefinition())) {
            return null;
        }
        // Webhook secrets were shown once at provisioning, so none is returned here.
        return new Publication(locked.getId(), current.getId(), current.getVersionNumber(),
                locked.getStatus(), List.of());
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

    private static void requireTelegramTriggerLimit(WorkflowDefinition definition) {
        long telegramTriggers = definition.nodes().stream()
                .filter(node -> node != null && "trigger.telegram".equals(node.type())).count();
        if (telegramTriggers > MAX_TELEGRAM_TRIGGERS) {
            throw new WorkflowDraftValidationException(List.of(new ValidationIssue(null, "nodes",
                    "TELEGRAM_TRIGGER_LIMIT_EXCEEDED",
                    "A workflow can have at most " + MAX_TELEGRAM_TRIGGERS + " Telegram triggers.")));
        }
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
            Instant publishedAt, List<WebhookProvisioning> webhookProvisionings,
            Map<UUID, String> telegramSecrets) {
        List<WorkflowTrigger> result = new ArrayList<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null) {
                continue;
            }
            TriggerType type = triggerType(node.type());
            if (type == null) {
                continue;
            }
            IntegrationReadiness.Readiness readiness = IntegrationReadiness.forType(node.type(), telegramBaseUrl());
            boolean enabled = !workflowPaused && readiness.configured();
            Instant nextRunAt = enabled && type == TriggerType.SCHEDULE
                    ? schedules.next(stringConfig(node.config(), "cron"),
                            stringConfig(node.config(), "timezone"), publishedAt)
                    : enabled && type == TriggerType.GMAIL ? publishedAt : null; // first poll is due at once
            Map<String, Object> lastError = readiness.configured()
                    ? null
                    : Map.of("code", readiness.reasonCode());
            WorkflowTrigger trigger = WorkflowTrigger.createNew(workflowId, versionId, node.id(), type,
                    node.config(), enabled
                            ? com.weav.workflow.domain.valueobject.TriggerStatus.ACTIVE
                            : com.weav.workflow.domain.valueobject.TriggerStatus.DISABLED,
                    nextRunAt, lastError, publishedAt);
            if (enabled && type == TriggerType.GMAIL) {
                trigger.startPolling(publishedAt); // mail that arrived before publishing never starts a run
            }
            if (type == TriggerType.WEBHOOK) {
                WebhookSecretPort.IssuedKey issued = webhookSecrets.provision();
                trigger.provisionWebhook(issued.endpointKey(), issued.secretHash());
                webhookProvisionings.add(new WebhookProvisioning(trigger.getId(),
                        issued.endpointKey(), issued.secret()));
            } else if (type == TriggerType.TELEGRAM) {
                // The secret goes to Telegram as secret_token and is never shown to the user; only the hash is stored.
                WebhookSecretPort.IssuedKey issued = webhookSecrets.provision();
                trigger.provisionWebhook(issued.endpointKey(), issued.secretHash());
                telegramSecrets.put(trigger.getId(), issued.secret());
            }
            result.add(trigger);
        }
        return List.copyOf(result);
    }

    private String telegramBaseUrl() {
        return telegram.map(TelegramWebhookPort::publicBaseUrl).orElse(null);
    }

    private static UUID telegramConnection(WorkflowTrigger trigger) {
        return UUID.fromString((String) trigger.getConfig().get("connectionId"));
    }

    private static List<WorkflowTrigger> activeTelegramTriggers(List<WorkflowTrigger> current) {
        return current.stream()
                .filter(trigger -> trigger.getType() == TriggerType.TELEGRAM
                        && trigger.getStatus() == com.weav.workflow.domain.valueobject.TriggerStatus.ACTIVE)
                .toList();
    }

    private static Set<UUID> activeTelegramConnections(List<WorkflowTrigger> current) {
        Set<UUID> bots = new LinkedHashSet<>();
        activeTelegramTriggers(current).forEach(trigger -> bots.add(telegramConnection(trigger)));
        return bots;
    }

    /** One bot can have one webhook: refuse a bot another workflow uses, or two nodes of this workflow. */
    private void requireTelegramBotsFree(WorkflowDefinition definition, UUID workflowId) {
        Set<UUID> seen = new java.util.TreeSet<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            if (node == null || !"trigger.telegram".equals(node.type())) {
                continue;
            }
            if (!seen.add(UUID.fromString((String) node.config().get("connectionId")))) {
                throw botInUse();
            }
        }
        // Sorted, so two publishes that share several bots take the advisory locks in the same order.
        for (UUID bot : seen) {
            if (triggers.isTelegramConnectionInUse(bot, workflowId)) {
                throw botInUse();
            }
        }
    }

    private static TelegramTriggerException botInUse() {
        return new TelegramTriggerException(TelegramTriggerException.BOT_IN_USE,
                "This Telegram bot is already used by another active workflow. Pause that workflow first.");
    }

    private void registerTelegram(UUID workspaceId, List<WorkflowTrigger> active, Map<UUID, String> secrets,
                                  String baseUrl, List<WorkflowTrigger> retired) {
        TelegramWebhookPort port = telegram.orElse(null);
        Set<UUID> registered = new LinkedHashSet<>();
        Set<UUID> retiredBots = new LinkedHashSet<>();
        retired.forEach(trigger -> retiredBots.add(telegramConnection(trigger)));
        Runnable onCommit = () -> {
            Set<UUID> toClear = new LinkedHashSet<>(retiredBots);
            toClear.removeAll(registered);
            clearUnusedBots(workspaceId, toClear);
        };
        Runnable onRollback = () -> recoverAfterRollback(workspaceId, registered, retired, baseUrl);
        // Inside a transaction both outcomes are handled once it ends; without one (unit tests) right here.
        boolean deferred = TransactionSynchronizationManager.isSynchronizationActive();
        if (deferred) {
            afterCompletion(onCommit, onRollback);
        }
        try {
            for (WorkflowTrigger trigger : active) {
                UUID bot = telegramConnection(trigger);
                // Added before the call: a failing call may have half-applied.
                registered.add(bot);
                port.register(workspaceId, bot, webhookUrl(baseUrl, trigger), secrets.get(trigger.getId()));
            }
        } catch (RuntimeException failure) {
            if (!deferred) {
                onRollback.run();
            }
            throw failure;
        }
        if (!deferred) {
            onCommit.run();
        }
    }

    /**
     * The publish did not commit. Telegram may already point at the rolled-back registration. A bot that a retired
     * trigger of this workflow serves is active again in the database, so that trigger gets a fresh secret and its
     * webhook back; every other bot is cleared unless something active uses it.
     */
    private void recoverAfterRollback(UUID workspaceId, Set<UUID> registered, List<WorkflowTrigger> retired,
                                      String baseUrl) {
        Set<UUID> clear = new LinkedHashSet<>();
        for (UUID bot : registered) {
            List<WorkflowTrigger> restorable = retired.stream()
                    .filter(trigger -> telegramConnection(trigger).equals(bot)).toList();
            if (restorable.isEmpty()) {
                clear.add(bot);
            }
            restorable.forEach(trigger -> restoreRegistration(workspaceId, trigger, baseUrl));
        }
        clearUnusedBots(workspaceId, clear);
    }

    private void restoreRegistration(UUID workspaceId, WorkflowTrigger trigger, String baseUrl) {
        try {
            WebhookSecretPort.IssuedKey issued = webhookSecrets.provision();
            triggers.updateTelegramRegistration(trigger.getId(), issued.secretHash(), null);
            telegram.orElseThrow().register(workspaceId, telegramConnection(trigger),
                    webhookUrl(baseUrl, trigger), issued.secret());
        } catch (RuntimeException failure) {
            log.warn("event=telegram_webhook_restore_failed triggerId={} errorType={}",
                    trigger.getId(), failure.getClass().getSimpleName());
            try {
                triggers.updateTelegramRegistration(trigger.getId(), null,
                        Map.of("code", TelegramTriggerException.REGISTRATION_FAILED));
            } catch (RuntimeException ignored) {
                log.warn("event=telegram_webhook_restore_error_not_recorded triggerId={}", trigger.getId());
            }
        }
    }

    private static String webhookUrl(String baseUrl, WorkflowTrigger trigger) {
        return baseUrl + "/api/v1/webhooks/telegram/" + trigger.getEndpointKey();
    }

    private List<WorkflowTrigger> telegramTriggersToResume(UUID workflowId, UUID versionId) {
        List<WorkflowTrigger> result = new ArrayList<>();
        for (WorkflowTrigger trigger : triggers.findCurrent(workflowId, versionId)) {
            boolean readinessBlocked = trigger.getLastError() != null
                    && "DEPENDENCY_NOT_CONFIGURED".equals(trigger.getLastError().get("code"));
            if (trigger.getType() == TriggerType.TELEGRAM && !readinessBlocked
                    && trigger.getStatus() == com.weav.workflow.domain.valueobject.TriggerStatus.DISABLED) {
                result.add(trigger);
            }
        }
        result.sort(java.util.Comparator.comparing(WorkflowPublicationService::telegramConnection));
        if (telegramBaseUrl() != null) {
            // Sorted above so concurrent resumes take the advisory locks in the same order.
            for (WorkflowTrigger trigger : result) {
                if (triggers.isTelegramConnectionInUse(telegramConnection(trigger), workflowId)) {
                    throw botInUse();
                }
            }
        }
        return result;
    }

    /** The old secret is unrecoverable (only its hash is stored), so resuming issues a new one. */
    private void reRegisterTelegram(UUID workspaceId, List<WorkflowTrigger> resumed) {
        String baseUrl = telegramBaseUrl();
        Map<UUID, String> secrets = new LinkedHashMap<>();
        for (WorkflowTrigger trigger : resumed) {
            WebhookSecretPort.IssuedKey issued = webhookSecrets.provision();
            triggers.replaceSecretHash(trigger.getId(), issued.secretHash());
            secrets.put(trigger.getId(), issued.secret());
        }
        registerTelegram(workspaceId, resumed, secrets, baseUrl, List.of());
    }

    /**
     * Deletes the webhook of each bot unless an active Telegram trigger uses it by now (checked in a new
     * transaction, since another workflow may have taken the bot between the decision and this call).
     */
    private void clearUnusedBots(UUID workspaceId, Set<UUID> bots) {
        for (UUID bot : bots) {
            try {
                if (!triggers.hasActiveTelegramTrigger(bot)) {
                    telegram.ifPresent(port -> port.unregister(workspaceId, bot));
                }
            } catch (RuntimeException failure) {
                log.warn("event=telegram_webhook_clear_skipped connectionId={} errorType={}",
                        bot, failure.getClass().getSimpleName());
            }
        }
    }

    /** Runs after the surrounding transaction ends; immediately when there is none (unit tests). */
    private static void afterCompletion(Runnable onCommit, Runnable onNotCommitted) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            onCommit.run();
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                (status == STATUS_COMMITTED ? onCommit : onNotCommitted).run();
            }
        });
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
            case "trigger.gmail" -> TriggerType.GMAIL;
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
