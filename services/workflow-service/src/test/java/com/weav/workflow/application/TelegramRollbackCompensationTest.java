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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Drives real {@link TransactionSynchronization} callbacks to a rollback (a failed registration call and a failed
 * commit) and checks that a still-active older trigger on the same bot gets its webhook back instead of losing it.
 */
@ExtendWith(MockitoExtension.class)
class TelegramRollbackCompensationTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000073");
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-000000000073");
    private static final UUID BOT = UUID.fromString("30000000-0000-0000-0000-000000000073");
    private static final UUID NEW_BOT = UUID.fromString("40000000-0000-0000-0000-000000000073");
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

    private final Recording telegram = new Recording();
    private final SyncTransactions transactions = new SyncTransactions();
    private final UUID previousVersion = UUID.randomUUID();
    private WorkflowTrigger older;

    @BeforeEach
    void setUp() {
        lenient().when(schedules.validate(any(), any(), any())).thenReturn(List.of());
        lenient().when(workspaceAccess.getAccess(WORKSPACE_ID, ACTOR_ID)).thenReturn(
                new WorkspaceAccessPort.Access(WORKSPACE_ID, ACTOR_ID, "MEMBER", Set.of("WORKFLOW_PUBLISH")));
        lenient().when(workflows.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        lenient().when(webhookSecrets.provision()).thenReturn(new WebhookSecretPort.IssuedKey(
                "endpoint-key-0123456789abcdefghijkl", "rotated-secret-0123456789", "sha256-rotated"));
    }

    @Test
    void failedRegistrationOnTheSameBotRestoresTheOlderTriggerWithARotatedSecret() {
        Workflow workflow = republishing(BOT);
        telegram.failCalls = Set.of(1);

        assertThrows(TelegramTriggerException.class, () -> publish(workflow));

        // call 1 = the new registration (fails), call 2 = the restore of the older, active-again trigger
        assertEquals(2, telegram.calls, telegram.events::toString);
        assertEquals(List.of(BOT + "|" + url(older) + "|rotated-secret-0123456789"), telegram.registers);
        verify(triggers).updateTelegramRegistration(older.getId(), "sha256-rotated", null);
        verify(triggers, never()).updateTelegramRegistration(older.getId(), null,
                Map.of("code", "TELEGRAM_WEBHOOK_REGISTRATION_FAILED"));
        assertTrue(telegram.unregistered.isEmpty(), "the older trigger still serves this bot");
    }

    @Test
    void failedCommitAfterASuccessfulRegistrationRestoresTheOlderTriggerToo() {
        Workflow workflow = republishing(BOT);
        transactions.failCommit = true;

        assertThrows(IllegalStateException.class, () -> publish(workflow));

        assertEquals(2, telegram.registers.size(), telegram.events::toString);
        assertEquals(BOT + "|" + url(older) + "|rotated-secret-0123456789", telegram.registers.get(1));
        verify(triggers).updateTelegramRegistration(older.getId(), "sha256-rotated", null);
        assertTrue(telegram.unregistered.isEmpty());
    }

    @Test
    void whenTheRestoreFailsTheOlderTriggerRecordsAnErrorAndNothingIsDeleted() {
        Workflow workflow = republishing(BOT);
        telegram.failCalls = Set.of(1, 2);

        assertThrows(TelegramTriggerException.class, () -> publish(workflow));

        verify(triggers).updateTelegramRegistration(older.getId(), "sha256-rotated", null);
        verify(triggers).updateTelegramRegistration(older.getId(), null,
                Map.of("code", "TELEGRAM_WEBHOOK_REGISTRATION_FAILED"));
        assertTrue(telegram.unregistered.isEmpty());
    }

    @Test
    void aBotNoOlderTriggerServesIsClearedAfterARollbackUnlessSomethingActiveUsesIt() {
        Workflow workflow = republishing(NEW_BOT);
        transactions.failCommit = true;

        assertThrows(IllegalStateException.class, () -> publish(workflow));

        // NEW_BOT has no older trigger: cleared. BOT was never touched by this publish.
        assertEquals(List.of(NEW_BOT), telegram.unregistered);
        verify(triggers, never()).updateTelegramRegistration(any(), any(), any());

        telegram.unregistered.clear();
        when(triggers.hasActiveTelegramTrigger(NEW_BOT)).thenReturn(true);
        assertThrows(IllegalStateException.class, () -> publish(republishing(NEW_BOT)));
        assertTrue(telegram.unregistered.isEmpty());
    }

    @Test
    void aSuccessfulCommitClearsOnlyTheBotThePublishNoLongerUses() {
        Workflow workflow = republishing(NEW_BOT);

        publish(workflow);

        assertEquals(1, telegram.registers.size());
        assertEquals(List.of(BOT), telegram.unregistered, "the retired bot is cleared after the commit");
        verify(triggers, never()).updateTelegramRegistration(any(), any(), any());
    }

    // ---- helpers

    private void publish(Workflow workflow) {
        service().publish(WORKSPACE_ID, workflow.getId(), ACTOR_ID);
    }

    private static String url(WorkflowTrigger trigger) {
        return BASE_URL + "/api/v1/webhooks/telegram/" + trigger.getEndpointKey();
    }

    /** A published workflow with an ACTIVE Telegram trigger on BOT whose new draft uses {@code bot}. */
    private Workflow republishing(UUID bot) {
        Instant now = Instant.parse("2026-10-05T12:00:00Z");
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", new ArrayList<>(List.of(
                node("manual", "trigger.manual", Map.of()),
                node("telegram", "trigger.telegram", Map.of("connectionId", bot.toString())))));
        definition.put("edges", new ArrayList<>());
        definition.put("variables", Map.of("revision", UUID.randomUUID().toString()));
        Workflow workflow = new Workflow(UUID.randomUUID(), WORKSPACE_ID, "Bot", "d", WorkflowStatus.PUBLISHED, "1.0",
                definition, Map.of(), previousVersion, ACTOR_ID, now, now, now, null, null);
        older = WorkflowTrigger.createNew(workflow.getId(), previousVersion, "telegram", TriggerType.TELEGRAM,
                Map.of("connectionId", BOT.toString()), TriggerStatus.ACTIVE, null, null, now);
        older.provisionWebhook("older-endpoint-0123456789abcdefghij", "older-hash");
        lenient().when(workflows.findByWorkspaceAndId(WORKSPACE_ID, workflow.getId())).thenReturn(Optional.of(workflow));
        lenient().when(workflows.lockByWorkspaceAndId(WORKSPACE_ID, workflow.getId()))
                .thenReturn(Optional.of(new Workflow(workflow.getId(), WORKSPACE_ID, "Bot", "d",
                        WorkflowStatus.PUBLISHED, "1.0", definition, Map.of(), previousVersion, ACTOR_ID, now, now,
                        now, null, null)));
        lenient().when(versions.nextNumber(workflow.getId())).thenReturn(2);
        lenient().when(triggers.findCurrent(workflow.getId(), previousVersion)).thenReturn(List.of(older));
        return workflow;
    }

    private WorkflowPublicationService service() {
        telegram.baseUrl = BASE_URL;
        return new WorkflowPublicationService(workflows, versions, triggers,
                new WorkspaceAuthorization(workspaceAccess), workspaceConnections,
                Optional.of(connectionReferences), schedules, webhookSecrets, event -> { }, transactions,
                Optional.of(telegram));
    }

    private static Map<String, Object> node(String id, String type, Map<String, Object> config) {
        Map<String, Object> node = new LinkedHashMap<>();
        node.put("id", id);
        node.put("type", type);
        node.put("config", config);
        return node;
    }

    /** A transaction that runs the registered synchronizations like Spring does, with a switchable commit failure. */
    private static final class SyncTransactions implements TransactionOperations {
        private boolean failCommit;

        @Override
        public <T> T execute(TransactionCallback<T> action) {
            TransactionSynchronizationManager.initSynchronization();
            try {
                T result;
                try {
                    TransactionStatus status = new SimpleTransactionStatus();
                    result = action.doInTransaction(status);
                } catch (RuntimeException failure) {
                    complete(TransactionSynchronization.STATUS_ROLLED_BACK);
                    throw failure;
                }
                if (failCommit) {
                    complete(TransactionSynchronization.STATUS_ROLLED_BACK);
                    throw new IllegalStateException("commit failed");
                }
                complete(TransactionSynchronization.STATUS_COMMITTED);
                return result;
            } finally {
                TransactionSynchronizationManager.clearSynchronization();
            }
        }

        private static void complete(int status) {
            for (TransactionSynchronization synchronization
                    : new ArrayList<>(TransactionSynchronizationManager.getSynchronizations())) {
                synchronization.afterCompletion(status);
            }
        }
    }

    private static final class Recording implements TelegramWebhookPort {
        private final List<String> events = new ArrayList<>();
        private final List<String> registers = new ArrayList<>();
        private final List<UUID> unregistered = new ArrayList<>();
        private Set<Integer> failCalls = Set.of();
        private String baseUrl;
        private int calls;

        @Override
        public String publicBaseUrl() {
            return baseUrl;
        }

        @Override
        public void register(UUID workspaceId, UUID connectionId, String webhookUrl, String secretToken) {
            calls++;
            events.add("register#" + calls + " " + connectionId);
            if (failCalls.contains(calls)) {
                throw new TelegramTriggerException(TelegramTriggerException.REGISTRATION_FAILED, "rejected");
            }
            registers.add(connectionId + "|" + webhookUrl + "|" + secretToken);
        }

        @Override
        public void unregister(UUID workspaceId, UUID connectionId) {
            events.add("unregister " + connectionId);
            unregistered.add(connectionId);
        }
    }
}
