package com.weav.workflow.application;

import com.weav.workflow.application.port.out.ConnectionReferencePort;
import com.weav.workflow.application.port.out.ScheduleValidationPort;
import com.weav.workflow.application.port.out.TelegramWebhookPort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.port.out.WorkflowVersionPort;
import com.weav.workflow.application.port.out.WorkspaceAccessPort;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.service.TelegramTriggerException;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.application.service.WorkspaceAuthorization;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.support.TransactionOperations;

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
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Publish, pause, resume and republish drive the Telegram webhook registration of the workspace's bot. */
@ExtendWith(MockitoExtension.class)
class TelegramTriggerPublicationTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000072");
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000072");
    private static final UUID BOT = UUID.fromString("30000000-0000-0000-0000-000000000072");
    private static final UUID OTHER_BOT = UUID.fromString("40000000-0000-0000-0000-000000000072");
    private static final String BASE_URL = "https://weav.example.test";

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

    private final RecordingTelegram telegram = new RecordingTelegram();

    @BeforeEach
    void setUp() {
        lenient().when(schedules.validate(any(), any(), any())).thenReturn(List.of());
        lenient().when(workspaceAccess.getAccess(WORKSPACE_ID, ACTOR_ID)).thenReturn(
                new WorkspaceAccessPort.Access(WORKSPACE_ID, ACTOR_ID, "MEMBER",
                        Set.of("WORKFLOW_PUBLISH", "WORKFLOW_MANAGE_STATE")));
        lenient().when(workflows.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        lenient().when(webhookSecrets.provision()).thenReturn(new WebhookSecretPort.IssuedKey(
                "endpoint-key-0123456789abcdefghijkl", "secret-token-0123456789", "sha256-of-secret"));
    }

    @Test
    void publishRegistersTheWebhookWithTheSecretAndKeepsTheSecretOutOfTheResponse() {
        Workflow draft = draft(BOT);
        stubPublishable(draft);

        WorkflowPublicationService.Publication publication = service(BASE_URL).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID);

        assertEquals(List.of("register " + BOT + " " + BASE_URL
                + "/api/v1/webhooks/telegram/endpoint-key-0123456789abcdefghijkl secret-token-0123456789"), telegram.calls);
        assertTrue(publication.webhooks().isEmpty(), "the secret_token is for Telegram only");
        WorkflowTrigger stored = telegramTrigger();
        assertEquals(TriggerStatus.ACTIVE, stored.getStatus());
        assertEquals("endpoint-key-0123456789abcdefghijkl", stored.getEndpointKey());
        assertEquals("sha256-of-secret", stored.getSecretHash());
        assertEquals(TriggerType.TELEGRAM, stored.getType());
        verify(triggers).isTelegramConnectionInUse(BOT, draft.getId());
    }

    @Test
    void publishFailsWithAStableCodeAndRegistersNothingWhenAnotherWorkflowUsesTheBot() {
        Workflow draft = draft(BOT);
        stubPublishable(draft);
        when(triggers.isTelegramConnectionInUse(BOT, draft.getId())).thenReturn(true);

        TelegramTriggerException failure = assertThrows(TelegramTriggerException.class,
                () -> service(BASE_URL).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID));

        assertEquals("TELEGRAM_BOT_IN_USE", failure.code());
        assertTrue(telegram.calls.isEmpty());
        verify(versions, never()).insert(any());
        verify(triggers, never()).replaceCurrent(any(), any(), any());
    }

    @Test
    void failedRegistrationFailsThePublishAndClearsTheBot() {
        Workflow draft = draft(BOT);
        stubPublishable(draft);
        telegram.failRegister = true;

        TelegramTriggerException failure = assertThrows(TelegramTriggerException.class,
                () -> service(BASE_URL).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID));

        assertEquals("TELEGRAM_WEBHOOK_REGISTRATION_FAILED", failure.code());
        assertTrue(telegram.calls.getLast().startsWith("unregister " + BOT), telegram.calls::toString);
        assertFalse(failure.getMessage().contains("secret-token"));
    }

    @Test
    void withoutAnHttpsBaseUrlThePublishKeepsTodaysDisabledBehaviourAndRegistersNothing() {
        for (String base : new String[] {null, "http://weav.example.test"}) {
            telegram.calls.clear();
            Workflow draft = draft(BOT);
            stubPublishable(draft);

            service(base).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID);

            @SuppressWarnings("unchecked")
            ArgumentCaptor<List<WorkflowTrigger>> registrations = ArgumentCaptor.forClass(List.class);
            verify(triggers, org.mockito.Mockito.atLeastOnce())
                    .replaceCurrent(eq(draft.getId()), any(), registrations.capture());
            WorkflowTrigger stored = registrations.getValue().stream()
                    .filter(trigger -> trigger.getType() == TriggerType.TELEGRAM).findFirst().orElseThrow();
            assertEquals(TriggerStatus.DISABLED, stored.getStatus());
            assertEquals(Map.of("code", "DEPENDENCY_NOT_CONFIGURED"), stored.getLastError());
            assertTrue(telegram.calls.isEmpty());
        }
    }

    @Test
    void republishToAnotherBotClearsTheRetiredBotButReusingTheSameBotOnlyReplacesTheWebhook() {
        UUID previousVersion = UUID.randomUUID();
        Workflow switched = workflowWith(draftDefinition(OTHER_BOT), WorkflowStatus.PUBLISHED, previousVersion);
        stubPublishable(switched);
        stubPreviousTelegramTrigger(switched.getId(), previousVersion, BOT);

        service(BASE_URL).publish(WORKSPACE_ID, switched.getId(), ACTOR_ID);

        assertEquals(2, telegram.calls.size(), telegram.calls::toString);
        assertTrue(telegram.calls.get(0).startsWith("register " + OTHER_BOT));
        assertEquals("unregister " + BOT, telegram.calls.get(1));

        telegram.calls.clear();
        Workflow same = workflowWith(draftDefinition(BOT), WorkflowStatus.PUBLISHED, previousVersion);
        stubPublishable(same);
        stubPreviousTelegramTrigger(same.getId(), previousVersion, BOT);

        service(BASE_URL).publish(WORKSPACE_ID, same.getId(), ACTOR_ID);

        assertEquals(1, telegram.calls.size(), telegram.calls::toString);
        assertTrue(telegram.calls.getFirst().startsWith("register " + BOT));
    }

    @Test
    void republishingAPausedWorkflowRegistersNothingUntilItIsResumed() {
        UUID previousVersion = UUID.randomUUID();
        Workflow paused = workflowWith(draftDefinition(BOT), WorkflowStatus.PAUSED, previousVersion);
        stubPublishable(paused);

        service(BASE_URL).publish(WORKSPACE_ID, paused.getId(), ACTOR_ID);

        assertTrue(telegram.calls.isEmpty());
        assertEquals(TriggerStatus.DISABLED, telegramTrigger().getStatus());
        verify(triggers, never()).isTelegramConnectionInUse(any(), any());
    }

    @Test
    void pauseDeletesTheWebhookAndResumeIssuesANewSecretAndRegistersAgain() {
        UUID versionId = UUID.randomUUID();
        Workflow published = workflowWith(draftDefinition(BOT), WorkflowStatus.PUBLISHED, versionId);
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, published.getId())).thenReturn(Optional.of(published));
        WorkflowTrigger active = telegramTrigger(published.getId(), versionId, BOT, TriggerStatus.ACTIVE, null);
        when(triggers.findCurrent(published.getId(), versionId)).thenReturn(List.of(active));

        service(BASE_URL).pause(WORKSPACE_ID, published.getId(), ACTOR_ID);

        assertEquals(List.of("unregister " + BOT), telegram.calls);
        verify(triggers).setCurrentEnabled(eq(published.getId()), eq(versionId), eq(false), any(), any());

        telegram.calls.clear();
        WorkflowTrigger disabled = telegramTrigger(published.getId(), versionId, BOT, TriggerStatus.DISABLED, null);
        when(triggers.findCurrent(published.getId(), versionId)).thenReturn(List.of(disabled));

        service(BASE_URL).resume(WORKSPACE_ID, published.getId(), ACTOR_ID);

        verify(triggers).replaceSecretHash(disabled.getId(), "sha256-of-secret");
        assertEquals(List.of("register " + BOT + " " + BASE_URL + "/api/v1/webhooks/telegram/"
                + disabled.getEndpointKey() + " secret-token-0123456789"), telegram.calls);
    }

    @Test
    void resumeFailsWhenAnotherWorkflowTookTheBotAndSkipsTriggersBlockedByReadiness() {
        UUID versionId = UUID.randomUUID();
        Workflow paused = workflowWith(draftDefinition(BOT), WorkflowStatus.PAUSED, versionId);
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, paused.getId())).thenReturn(Optional.of(paused));
        WorkflowTrigger disabled = telegramTrigger(paused.getId(), versionId, BOT, TriggerStatus.DISABLED, null);
        when(triggers.findCurrent(paused.getId(), versionId)).thenReturn(List.of(disabled));
        when(triggers.isTelegramConnectionInUse(BOT, paused.getId())).thenReturn(true);

        TelegramTriggerException failure = assertThrows(TelegramTriggerException.class,
                () -> service(BASE_URL).resume(WORKSPACE_ID, paused.getId(), ACTOR_ID));
        assertEquals("TELEGRAM_BOT_IN_USE", failure.code());
        assertTrue(telegram.calls.isEmpty());

        WorkflowTrigger blocked = telegramTrigger(paused.getId(), versionId, BOT, TriggerStatus.DISABLED,
                Map.of("code", "DEPENDENCY_NOT_CONFIGURED"));
        when(triggers.findCurrent(paused.getId(), versionId)).thenReturn(List.of(blocked));
        service(null).resume(WORKSPACE_ID, paused.getId(), ACTOR_ID);
        assertTrue(telegram.calls.isEmpty());
    }

    @Test
    void resumeWithoutAPublicBaseUrlActivatesTheRestAndLeavesTelegramDisabledNotConfigured() {
        UUID versionId = UUID.randomUUID();
        Workflow paused = workflowWith(draftDefinition(BOT), WorkflowStatus.PAUSED, versionId);
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, paused.getId())).thenReturn(Optional.of(paused));
        WorkflowTrigger disabled = telegramTrigger(paused.getId(), versionId, BOT, TriggerStatus.DISABLED, null);
        when(triggers.findCurrent(paused.getId(), versionId)).thenReturn(List.of(disabled));

        Workflow resumed = service(null).resume(WORKSPACE_ID, paused.getId(), ACTOR_ID);

        assertEquals(WorkflowStatus.PUBLISHED, resumed.getStatus());
        verify(triggers).setCurrentEnabled(eq(paused.getId()), eq(versionId), eq(true), any(), any());
        verify(triggers).disableTelegramNotConfigured(disabled.getId());
        verify(triggers, never()).isTelegramConnectionInUse(any(), any());
        assertTrue(telegram.calls.isEmpty());
    }

    @Test
    void moreThanFiveTelegramTriggersAreRejectedWithAStableCode() {
        for (int count : new int[] {5, 6}) {
            Map<String, Object> definition = draftDefinition(BOT);
            @SuppressWarnings("unchecked")
            List<Map<String, Object>> nodes = (List<Map<String, Object>>) definition.get("nodes");
            nodes.clear();
            nodes.add(node("manual", "trigger.manual", Map.of()));
            for (int i = 0; i < count; i++) {
                nodes.add(node("telegram-" + i, "trigger.telegram", Map.of("connectionId", UUID.randomUUID().toString())));
            }
            Workflow draft = workflowWith(definition, WorkflowStatus.DRAFT, null);
            stubPublishable(draft);
            if (count == 5) {
                service(BASE_URL).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID);
                assertEquals(5, telegram.calls.size());
            } else {
                com.weav.workflow.application.service.WorkflowDraftValidationException failure = assertThrows(
                        com.weav.workflow.application.service.WorkflowDraftValidationException.class,
                        () -> service(BASE_URL).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID));
                assertEquals("TELEGRAM_TRIGGER_LIMIT_EXCEEDED", failure.issues().getFirst().code());
            }
        }
    }

    @Test
    void botLocksAreTakenInSortedOrderWhateverTheNodeOrder() {
        List<UUID> bots = new ArrayList<>(List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID()));
        Map<String, Object> definition = draftDefinition(BOT);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> nodes = (List<Map<String, Object>>) definition.get("nodes");
        nodes.clear();
        nodes.add(node("manual", "trigger.manual", Map.of()));
        for (UUID bot : bots) {
            nodes.add(node("t-" + bot, "trigger.telegram", Map.of("connectionId", bot.toString())));
        }
        java.util.Collections.shuffle(nodes.subList(1, nodes.size()), new java.util.Random(7));
        Workflow draft = workflowWith(definition, WorkflowStatus.DRAFT, null);
        stubPublishable(draft);

        service(BASE_URL).publish(WORKSPACE_ID, draft.getId(), ACTOR_ID);

        org.mockito.InOrder order = org.mockito.Mockito.inOrder(triggers);
        new java.util.TreeSet<>(bots).forEach(bot -> order.verify(triggers).isTelegramConnectionInUse(bot, draft.getId()));
    }

    @Test
    void afterCommitClearingSkipsABotThatAnActiveTriggerUsesByNow() {
        UUID previousVersion = UUID.randomUUID();
        Workflow switched = workflowWith(draftDefinition(OTHER_BOT), WorkflowStatus.PUBLISHED, previousVersion);
        stubPublishable(switched);
        stubPreviousTelegramTrigger(switched.getId(), previousVersion, BOT);
        when(triggers.hasActiveTelegramTrigger(BOT)).thenReturn(true);

        service(BASE_URL).publish(WORKSPACE_ID, switched.getId(), ACTOR_ID);

        assertEquals(1, telegram.calls.size(), telegram.calls::toString);
        assertTrue(telegram.calls.getFirst().startsWith("register " + OTHER_BOT));

        telegram.calls.clear();
        UUID versionId = UUID.randomUUID();
        Workflow published = workflowWith(draftDefinition(BOT), WorkflowStatus.PUBLISHED, versionId);
        when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, published.getId())).thenReturn(Optional.of(published));
        stubPreviousTelegramTrigger(published.getId(), versionId, BOT);

        service(BASE_URL).pause(WORKSPACE_ID, published.getId(), ACTOR_ID);

        assertTrue(telegram.calls.isEmpty(), "the bot is in use again, so its webhook stays");
    }

    // ---- helpers

    private WorkflowTrigger telegramTrigger() {
        @SuppressWarnings("unchecked")
            ArgumentCaptor<List<WorkflowTrigger>> registrations = ArgumentCaptor.forClass(List.class);
        verify(triggers).replaceCurrent(any(), any(), registrations.capture());
        return registrations.getValue().stream().filter(trigger -> trigger.getType() == TriggerType.TELEGRAM)
                .findFirst().orElseThrow();
    }

    private void stubPublishable(Workflow draft) {
        lenient().when(workflows.findByWorkspaceAndId(WORKSPACE_ID, draft.getId())).thenReturn(Optional.of(draft));
        lenient().when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, draft.getId()))
                .thenReturn(Optional.of(copy(draft)));
        lenient().when(versions.nextNumber(draft.getId())).thenReturn(2);
    }

    private void stubPreviousTelegramTrigger(UUID workflowId, UUID versionId, UUID bot) {
        when(triggers.findCurrent(workflowId, versionId)).thenReturn(List.of(
                telegramTrigger(workflowId, versionId, bot, TriggerStatus.ACTIVE, null)));
    }

    private WorkflowTrigger telegramTrigger(UUID workflowId, UUID versionId, UUID bot, TriggerStatus status,
                                            Map<String, Object> lastError) {
        WorkflowTrigger trigger = WorkflowTrigger.createNew(workflowId, versionId, "telegram", TriggerType.TELEGRAM,
                Map.of("connectionId", bot.toString()), status, null, lastError, Instant.now());
        trigger.provisionWebhook("old-endpoint-" + UUID.randomUUID().toString().replace("-", ""), "old-hash");
        return trigger;
    }

    private WorkflowPublicationService service(String baseUrl) {
        telegram.baseUrl = baseUrl;
        return new WorkflowPublicationService(workflows, versions, triggers,
                new WorkspaceAuthorization(workspaceAccess), workspaceConnections,
                Optional.of(connectionReferences), schedules, webhookSecrets, event -> { },
                TransactionOperations.withoutTransaction(), Optional.of(telegram));
    }

    private Workflow draft(UUID bot) {
        return workflowWith(draftDefinition(bot), WorkflowStatus.DRAFT, null);
    }

    private Workflow workflowWith(Map<String, Object> definition, WorkflowStatus status, UUID currentVersionId) {
        Instant now = Instant.parse("2026-10-04T12:00:00Z");
        return new Workflow(UUID.randomUUID(), WORKSPACE_ID, "Bot", "Description", status, "1.0",
                definition, Map.of(), currentVersionId, ACTOR_ID, now, now,
                currentVersionId == null ? null : now, null, null);
    }

    private Workflow copy(Workflow workflow) {
        return new Workflow(workflow.getId(), workflow.getWorkspaceId(), workflow.getName(), workflow.getDescription(),
                workflow.getStatus(), workflow.getSchemaVersion(), workflow.getDraftDefinition(),
                workflow.getEditorState(), workflow.getCurrentVersionId(), workflow.getCreatedBy(),
                workflow.getCreatedAt(), workflow.getUpdatedAt(), workflow.getPublishedAt(),
                workflow.getDeletedAt(), workflow.getDeletedBy());
    }

    private Map<String, Object> draftDefinition(UUID bot) {
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(
                node("manual", "trigger.manual", Map.of()),
                node("telegram", "trigger.telegram", Map.of("connectionId", bot.toString())))));
        definition.put("edges", new ArrayList<>());
        definition.put("variables", Map.of());
        return definition;
    }

    private Map<String, Object> node(String id, String type, Map<String, Object> config) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("id", id);
        node.put("type", type);
        node.put("config", config);
        return node;
    }

    private static final class RecordingTelegram implements TelegramWebhookPort {
        private final List<String> calls = new ArrayList<>();
        private String baseUrl;
        private boolean failRegister;

        @Override
        public String publicBaseUrl() {
            return com.weav.workflow.application.node.IntegrationReadiness.httpsBaseUrl(baseUrl);
        }

        @Override
        public void register(UUID workspaceId, UUID connectionId, String webhookUrl, String secretToken) {
            if (failRegister) {
                throw new TelegramTriggerException(TelegramTriggerException.REGISTRATION_FAILED,
                        "The Telegram webhook could not be registered: Telegram rejected the request.");
            }
            calls.add("register " + connectionId + " " + webhookUrl + " " + secretToken);
        }

        @Override
        public void unregister(UUID workspaceId, UUID connectionId) {
            calls.add("unregister " + connectionId);
        }
    }
}
