package com.weav.workflow.application;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.port.out.ConnectionReferenceUnavailableException;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.application.service.WorkflowDraftValidationException;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.exception.ConflictException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.domain.exception.InvalidStateException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WorkflowPublicationTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000071");
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000071");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000071");

    @Mock
    private WorkflowRepository workflows;
    @Mock
    private WorkflowVersionPort versions;
    @Mock
    private WorkflowTriggerPort triggers;
    @Mock
    private WorkspaceAccessPort workspaceAccess;
    @Mock
    private WorkspaceConnectionPort workspaceConnections;
    @Mock
    private ConnectionReferencePort connectionReferences;
    @Mock
    private ScheduleValidationPort schedules;
    @Mock
    private WebhookSecretPort webhookSecrets;

    private WorkspaceAuthorization authorization;

    @BeforeEach
    void setUp() {
        authorization = new WorkspaceAuthorization(workspaceAccess);
        lenient().when(schedules.validate(any(), any(), any())).thenReturn(List.of());
        lenient().when(workspaceAccess.getAccess(WORKSPACE_ID, ACTOR_ID)).thenReturn(
                new WorkspaceAccessPort.Access(WORKSPACE_ID, ACTOR_ID, "MEMBER",
                        Set.of("WORKFLOW_PUBLISH", "WORKFLOW_MANAGE_STATE")));
    }

    @Test
    void validatesAndAuthorizesFrozenDraftBeforeLockThenPersistsVersionAndReferenceProjection() {
        Workflow observed = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null, withConnection("before"));
        Workflow locked = copy(observed);
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(observed));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(locked));
        when(versions.nextNumber(observed.getId())).thenReturn(1);

        WorkflowPublicationService.Publication result = service(Optional.of(connectionReferences))
                .publish(WORKSPACE_ID, observed.getId(), ACTOR_ID);

        assertEquals(1, result.version());
        assertEquals(observed.getId(), result.workflowId());
        assertEquals(WorkflowStatus.PUBLISHED, result.status());
        assertTrue(result.webhooks().isEmpty());
        verify(workspaceConnections).authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, ACTOR_ID);

        ArgumentCaptor<WorkflowVersion> versionCaptor = ArgumentCaptor.forClass(WorkflowVersion.class);
        verify(versions).insert(versionCaptor.capture());
        WorkflowVersion frozen = versionCaptor.getValue();
        assertEquals(observed.getDraftDefinition(), frozen.getDefinition());
        assertEquals(1, frozen.getVersionNumber());
        assertEquals(ACTOR_ID, frozen.getPublishedBy());

        InOrder order = inOrder(workflows, versions, triggers, connectionReferences);
        order.verify(workflows).lockByWorkspaceAndId(WORKSPACE_ID, observed.getId());
        order.verify(versions).nextNumber(observed.getId());
        order.verify(versions).insert(any(WorkflowVersion.class));
        order.verify(workflows).save(locked);
        order.verify(triggers).replaceCurrent(eq(observed.getId()), eq(frozen.getId()), eq(List.of()));
        order.verify(connectionReferences).appendVersion(observed.getId(), frozen.getId(), Set.of(CONNECTION_ID));

        locked.updateDraft("later", "edit after publication", withConnection("later"), Map.of());
        assertEquals("before", ((Map<?, ?>) frozen.getDefinition().get("variables")).get("revision"));
        assertEquals(WorkflowStatus.PUBLISHED, locked.getStatus());
        assertFalse(frozen.getDefinition().equals(locked.getDraftDefinition()));
    }

    @Test
    void failedAttachmentAuthorizationDoesNotLockOrPersistPublicationState() {
        Workflow observed = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null, withConnection("before"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(observed));
        org.mockito.Mockito.doThrow(new ForbiddenException()).when(workspaceConnections)
                .authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, ACTOR_ID);

        assertThrows(ForbiddenException.class,
                () -> service(Optional.of(connectionReferences)).publish(WORKSPACE_ID, observed.getId(), ACTOR_ID));

        verify(workflows, never()).lockByWorkspaceAndId(any(), any());
        verifyNoInteractions(versions, triggers, connectionReferences);
    }

    @Test
    void draftChangedDuringRemoteAttachmentAuthorizationConflictsBeforeVersionInsert() {
        Workflow observed = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null, withConnection("before"));
        Workflow changed = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null, withConnection("after"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(observed));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(changed));

        assertThrows(ConflictException.class,
                () -> service(Optional.of(connectionReferences)).publish(WORKSPACE_ID, observed.getId(), ACTOR_ID));

        verify(workspaceConnections).authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, ACTOR_ID);
        verify(versions, never()).nextNumber(any());
        verify(versions, never()).insert(any());
        verifyNoInteractions(triggers, connectionReferences);
    }

    @Test
    void connectionBearingPublishFailsClosedWhenReferenceProjectionIsMissing() {
        Workflow observed = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null, withConnection("before"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(observed));

        assertThrows(ConnectionReferenceUnavailableException.class,
                () -> service(Optional.empty()).publish(WORKSPACE_ID, observed.getId(), ACTOR_ID));

        verify(workspaceConnections).authorizeAttachment(WORKSPACE_ID, CONNECTION_ID, ACTOR_ID);
        verify(workflows, never()).lockByWorkspaceAndId(any(), any());
        verifyNoInteractions(versions, triggers);
    }

    @Test
    void publishCapabilityIsRequiredBeforeWorkflowLookup() {
        when(workspaceAccess.getAccess(WORKSPACE_ID, ACTOR_ID)).thenReturn(
                new WorkspaceAccessPort.Access(WORKSPACE_ID, ACTOR_ID, "MEMBER", Set.of("WORKSPACE_VIEW")));

        assertThrows(ForbiddenException.class,
                () -> service(Optional.of(connectionReferences)).publish(WORKSPACE_ID, UUID.randomUUID(), ACTOR_ID));

        verifyNoInteractions(workflows, versions, triggers, workspaceConnections, connectionReferences);
    }

    @Test
    void aggregatePublishesNewVersionWithoutResumingPausedWorkflow() {
        UUID previousVersion = UUID.randomUUID();
        UUID nextVersion = UUID.randomUUID();
        Instant publishedAt = Instant.parse("2026-09-21T04:05:06Z");
        Workflow paused = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.PAUSED, previousVersion,
                simpleDefinition("paused"));

        paused.publishVersion(nextVersion, publishedAt);

        assertEquals(WorkflowStatus.PAUSED, paused.getStatus());
        assertEquals(nextVersion, paused.getCurrentVersionId());
        assertEquals(publishedAt, paused.getPublishedAt());
    }

    @Test
    void aggregateRejectsPausingDraftAndResumingWithoutPublishedVersion() {
        Workflow draft = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null, simpleDefinition("draft"));

        assertThrows(InvalidStateException.class, draft::pause);
        assertThrows(InvalidStateException.class, draft::resume);
    }

    @Test
    void publishingWhilePausedKeepsPausedStatusAndReplacesTriggersForTheNewVersion() {
        Workflow observed = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.PAUSED,
                UUID.randomUUID(), simpleDefinition("still-paused"));
        Workflow locked = copy(observed);
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(observed));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, observed.getId())).thenReturn(Optional.of(locked));
        when(versions.nextNumber(observed.getId())).thenReturn(2);

        WorkflowPublicationService.Publication publication = service(Optional.of(connectionReferences))
                .publish(WORKSPACE_ID, observed.getId(), ACTOR_ID);

        assertEquals(2, publication.version());
        assertEquals(WorkflowStatus.PAUSED, publication.status());
        verify(versions).insert(any(WorkflowVersion.class));
        verify(workflows).save(locked);
        verify(triggers).replaceCurrent(eq(observed.getId()), eq(publication.versionId()), eq(List.of()));
    }

    @Test
    void schedulePublicationCreatesAnActiveRegistrationWithItsFirstFutureSlot() {
        Instant firstFutureSlot = Instant.now().plusSeconds(60);
        Workflow schedule = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null,
                definition(List.of(node("manual", "trigger.manual", Map.of()),
                        node("schedule", "trigger.schedule", Map.of("cron", "0 * * * * *",
                                "timezone", "UTC"))),
                        List.of(), "schedule"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, schedule.getId())).thenReturn(Optional.of(schedule));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, schedule.getId())).thenReturn(Optional.of(copy(schedule)));
        when(versions.nextNumber(schedule.getId())).thenReturn(1);
        when(schedules.next(eq("0 * * * * *"), eq("UTC"), any(Instant.class))).thenReturn(firstFutureSlot);

        service(Optional.of(connectionReferences)).publish(WORKSPACE_ID, schedule.getId(), ACTOR_ID);

        ArgumentCaptor<List<WorkflowTrigger>> registrations = ArgumentCaptor.forClass(List.class);
        verify(triggers).replaceCurrent(eq(schedule.getId()), any(), registrations.capture());
        WorkflowTrigger registration = registrations.getValue().stream()
                .filter(trigger -> trigger.getType() == TriggerType.SCHEDULE).findFirst().orElseThrow();
        assertEquals(TriggerStatus.ACTIVE, registration.getStatus());
        assertEquals(firstFutureSlot, registration.getNextRunAt());
        assertTrue(registration.getNextRunAt().isAfter(Instant.now()));
        assertTrue(registration.getLastError().isEmpty());
    }

    @Test
    void telegramPublicationPersistsDisabledRegistrationWithOnlyTheDependencyReason() {
        Workflow telegram = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null,
                definition(List.of(node("manual", "trigger.manual", Map.of()),
                        node("telegram", "trigger.telegram", Map.of())), List.of(), "telegram"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, telegram.getId())).thenReturn(Optional.of(telegram));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, telegram.getId())).thenReturn(Optional.of(copy(telegram)));
        when(versions.nextNumber(telegram.getId())).thenReturn(1);

        service(Optional.of(connectionReferences)).publish(WORKSPACE_ID, telegram.getId(), ACTOR_ID);

        ArgumentCaptor<List<WorkflowTrigger>> registrations = ArgumentCaptor.forClass(List.class);
        verify(triggers).replaceCurrent(eq(telegram.getId()), any(), registrations.capture());
        WorkflowTrigger registration = registrations.getValue().stream()
                .filter(trigger -> trigger.getType() == TriggerType.TELEGRAM).findFirst().orElseThrow();
        assertEquals(TriggerStatus.DISABLED, registration.getStatus());
        assertEquals(Map.of("code", "DEPENDENCY_NOT_CONFIGURED"), registration.getLastError());
    }

    @Test
    void webhookPublicationProvisionsRandomRegistrationAndReturnsItsSecretOnce() {

        Workflow webhook = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null,
                definition(List.of(node("manual", "trigger.manual", Map.of()),
                        node("webhook", "trigger.webhook", Map.of())), List.of(), "webhook"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, webhook.getId())).thenReturn(Optional.of(webhook));
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, webhook.getId())).thenReturn(Optional.of(copy(webhook)));
        when(versions.nextNumber(webhook.getId())).thenReturn(1);
        when(webhookSecrets.provision()).thenReturn(new WebhookSecretPort.IssuedKey(
                "opaque-endpoint-key", "one-time-secret", "sha256-verifier"));

        WorkflowPublicationService.Publication publication = service(Optional.of(connectionReferences))
                .publish(WORKSPACE_ID, webhook.getId(), ACTOR_ID);

        assertEquals(1, publication.webhooks().size());
        assertEquals("opaque-endpoint-key", publication.webhooks().getFirst().endpointKey());
        assertEquals("one-time-secret", publication.webhooks().getFirst().secret());
        ArgumentCaptor<List<WorkflowTrigger>> registrations = ArgumentCaptor.forClass(List.class);
        verify(triggers).replaceCurrent(eq(webhook.getId()), eq(publication.versionId()), registrations.capture());
        WorkflowTrigger registration = registrations.getValue().getFirst();
        assertEquals(TriggerType.WEBHOOK, registration.getType());
        assertEquals("opaque-endpoint-key", registration.getEndpointKey());
        assertEquals("sha256-verifier", registration.getSecretHash());
        assertTrue(registration.getConfig().isEmpty());
        assertFalse(registration.getConfig().toString().contains("one-time-secret"));
        verify(webhookSecrets).provision();
    }

    @Test
    void credentialBearingDraftCannotCreateVersionAndSafeDiagnosticsOmitTheValue() {
        String secretMarker = "do-not-persist-or-return-this-credential";
        Map<String, Object> requestConfig = new LinkedHashMap<>();
        requestConfig.put("method", "GET");
        requestConfig.put("url", "https://example.test");
        requestConfig.put("headers", Map.of("Authorization", secretMarker));
        Workflow workflow = workflow(WORKSPACE_ID, ACTOR_ID, WorkflowStatus.DRAFT, null,
                definition(List.of(node("manual", "trigger.manual", Map.of()),
                        node("request", "http.request", requestConfig)),
                        List.of(edge("manual-to-request", "manual", "request")), "credential"));
        when(workflows.findByWorkspaceAndId(WORKSPACE_ID, workflow.getId())).thenReturn(Optional.of(workflow));

        WorkflowDraftValidationException rejection = assertThrows(WorkflowDraftValidationException.class,
                () -> service(Optional.of(connectionReferences)).publish(WORKSPACE_ID, workflow.getId(), ACTOR_ID));

        assertFalse(rejection.getMessage().contains(secretMarker));
        assertTrue(rejection.issues().stream().noneMatch(issue -> issue.message().contains(secretMarker)));
        verify(workflows, never()).lockByWorkspaceAndId(any(), any());
        verifyNoInteractions(versions, triggers, connectionReferences, workspaceConnections);
    }

    @Test
    void webhookProvisioningRenderingRedactsEndpointAndSecret() {
        WorkflowPublicationService.WebhookProvisioning provisioning =
                new WorkflowPublicationService.WebhookProvisioning(UUID.randomUUID(), "endpoint-marker", "secret-marker");

        assertFalse(provisioning.toString().contains("endpoint-marker"));
        assertFalse(provisioning.toString().contains("secret-marker"));
    }

    private WorkflowPublicationService service(Optional<ConnectionReferencePort> referencePort) {
        return new WorkflowPublicationService(workflows, versions, triggers, authorization,
                workspaceConnections, referencePort, schedules, webhookSecrets);
    }

    private Workflow workflow(UUID workspaceId, UUID actorId, WorkflowStatus status,
                              UUID currentVersionId, Map<String, Object> definition) {
        Instant now = Instant.parse("2026-09-20T12:00:00Z");
        return new Workflow(UUID.randomUUID(), workspaceId, "Workflow", "Description", status, "1.0",
                definition, Map.of(), currentVersionId, actorId, now, now,
                currentVersionId == null ? null : now, null, null);
    }

    private Workflow copy(Workflow workflow) {
        return new Workflow(workflow.getId(), workflow.getWorkspaceId(), workflow.getName(), workflow.getDescription(),
                workflow.getStatus(), workflow.getSchemaVersion(), workflow.getDraftDefinition(),
                workflow.getEditorState(), workflow.getCurrentVersionId(), workflow.getCreatedBy(),
                workflow.getCreatedAt(), workflow.getUpdatedAt(), workflow.getPublishedAt(),
                workflow.getDeletedAt(), workflow.getDeletedBy());
    }

    private Map<String, Object> withConnection(String revision) {
        Map<String, Object> httpConfig = new LinkedHashMap<>();
        httpConfig.put("method", "GET");
        httpConfig.put("url", "https://example.test");
        httpConfig.put("connectionId", CONNECTION_ID.toString());
        Map<String, Object> edge = new LinkedHashMap<>();
        edge.put("id", "manual-to-request");
        edge.put("source", "manual");
        edge.put("target", "request");
        edge.put("sourcePort", null);
        return definition(List.of(
                node("manual", "trigger.manual", Map.of()),
                node("request", "http.request", httpConfig)),
                List.of(edge), revision);
    }

    private Map<String, Object> simpleDefinition(String revision) {
        return definition(List.of(node("manual", "trigger.manual", Map.of())), List.of(), revision);
    }

    private Map<String, Object> definition(List<Map<String, Object>> nodes, List<Map<String, Object>> edges,
                                           String revision) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(nodes));
        definition.put("edges", new ArrayList<>(edges));
        definition.put("variables", Map.of("revision", revision));
        return definition;
    }

    private Map<String, Object> node(String id, String type, Map<String, Object> config) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("id", id);
        node.put("type", type);
        node.put("config", config);
        return node;
    }

    private Map<String, Object> edge(String id, String source, String target) {
        Map<String, Object> edge = new LinkedHashMap<>();
        edge.put("id", id);
        edge.put("source", source);
        edge.put("target", target);
        edge.put("sourcePort", null);
        return edge;
    }
}
