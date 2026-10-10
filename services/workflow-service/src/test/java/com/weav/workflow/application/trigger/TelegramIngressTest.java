package com.weav.workflow.application.trigger;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.TelegramFilePort;
import com.weav.workflow.application.port.out.WebhookSecretPort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.domain.exception.IdempotencyKeyReusedException;
import com.weav.workflow.domain.exception.WebhookNotFoundException;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.domain.valueobject.TriggerType;
import com.weav.workflow.domain.valueobject.WorkflowStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Telegram ingress shares the webhook authentication and admission path but never mixes trigger types. */
class TelegramIngressTest {
    private static final String KEY = "telegram-endpoint-key-0123456789ab";
    private static final String SECRET = "telegram_secret-token_0123456789ABCDEF_xyz";

    private final WorkflowRepository workflows = mock(WorkflowRepository.class);
    private final WorkflowTriggerPort triggers = mock(WorkflowTriggerPort.class);
    private final ExecutionAdmissionService admissions = mock(ExecutionAdmissionService.class);
    private final WebhookSecretPort secrets = spy(new Sha256Secrets());
    private final UUID workflowId = UUID.randomUUID();
    private final UUID versionId = UUID.randomUUID();
    private WebhookTriggerService service;
    private WorkflowTrigger telegramTrigger;

    @BeforeEach
    void setUp() throws Exception {
        service = new WebhookTriggerService(workflows, triggers, secrets, admissions,
                new WebhookIngressRateLimiter(1000, Duration.ofMinutes(1)),
                new WebhookEndpointRateLimiter(1000, Duration.ofMinutes(1)));
        telegramTrigger = trigger(TriggerType.TELEGRAM);
        when(triggers.findTelegramByEndpoint(KEY)).thenReturn(Optional.of(telegramTrigger));
        when(triggers.lockCurrent(workflowId, telegramTrigger.getId())).thenReturn(Optional.of(telegramTrigger));
        Instant now = Instant.now();
        Workflow published = new Workflow(workflowId, UUID.randomUUID(), "Bot", "d", WorkflowStatus.PUBLISHED, "1.0",
                Map.of("schemaVersion", "1.0", "nodes", List.of(), "edges", List.of(), "variables", Map.of()),
                Map.of(), versionId, UUID.randomUUID(), now, now, now, null, null);
        when(workflows.lockById(eq(workflowId), any())).thenReturn(Optional.of(published));
        when(admissions.automatic(any(), any(), any(), any(), any(), anyString())).thenReturn(
                new ExecutionAdmissionPort.Admission(UUID.randomUUID(), workflowId, versionId, ExecutionStatus.QUEUED));
    }

    @Test
    void textUpdateIsAdmittedWithTheNormalizedInputAndTheUpdateIdAsIdempotencyKey() {
        Map<String, Object> update = update(42, "hello", true);

        Optional<ExecutionAdmissionPort.Admission> admitted =
                service.acceptTelegram(KEY, SECRET, update, "corr", null);

        assertTrue(admitted.isPresent());
        ArgumentCaptor<Object> input = ArgumentCaptor.forClass(Object.class);
        verify(admissions).automatic(eq(telegramTrigger.getId()), input.capture(), any(), eq("corr"), any(),
                eq("telegram:42"));
        assertEquals(Map.of("updateId", 42L, "message", Map.of(
                "messageId", 7L, "date", 1700000000L, "text", "hello",
                "chat", Map.of("id", -1001L, "type", "supergroup"),
                "from", Map.of("id", 99L, "username", "ada", "firstName", "Ada"))), input.getValue());
    }

    @Test
    void onlyPresentFieldsAreCopiedAndUnknownOnesAreDropped() {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("message_id", 1);
        message.put("text", "hi");
        message.put("chat", Map.of("id", 5, "title", "dropped"));
        message.put("entities", List.of(Map.of("type", "bold")));

        TelegramUpdate parsed = TelegramUpdate.from(Map.of("update_id", 3, "message", message)).orElseThrow();

        assertEquals(Map.of("updateId", 3L, "message", Map.of(
                "messageId", 1L, "text", "hi", "chat", Map.of("id", 5L))), parsed.input());
        assertEquals("telegram:3", parsed.idempotencyKey());
    }

    @Test
    void updatesWithoutATextMessageAreAcknowledgedWithoutAnExecution() {
        List<Object> ignorable = List.of(
                Map.of("update_id", 1, "edited_message", Map.of("text", "x")),
                Map.of("update_id", 2, "message", Map.of("photo", List.of())),
                Map.of("update_id", 3, "message", Map.of("text", "   ")),
                Map.of("message", Map.of("text", "no update id")),
                Map.of("update_id", "7", "message", Map.of("text", "string id")),
                Map.of("update_id", -1, "message", Map.of("text", "negative")),
                List.of(), "text", 5);
        for (Object update : ignorable) {
            assertTrue(service.acceptTelegram(KEY, SECRET, update, null, null).isEmpty(), String.valueOf(update));
        }
        assertTrue(service.acceptTelegram(KEY, SECRET, null, null, null).isEmpty());
        verify(admissions, never()).automatic(any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void redeliveriesAreAcknowledgedAndNeverRunTwice() {
        UUID executionId = UUID.randomUUID();
        ExecutionAdmissionPort.Admission first = new ExecutionAdmissionPort.Admission(
                executionId, workflowId, versionId, ExecutionStatus.QUEUED);
        when(admissions.automatic(any(), any(), any(), any(), any(), eq("telegram:42"))).thenReturn(first);

        Optional<ExecutionAdmissionPort.Admission> one = service.acceptTelegram(KEY, SECRET, update(42, "hi", false), null, null);
        Optional<ExecutionAdmissionPort.Admission> again = service.acceptTelegram(KEY, SECRET, update(42, "hi", false), null, null);

        assertEquals(first, one.orElseThrow());
        assertEquals(first, again.orElseThrow());

        when(admissions.automatic(any(), any(), any(), any(), any(), eq("telegram:43")))
                .thenThrow(new IdempotencyKeyReusedException());
        assertTrue(service.acceptTelegram(KEY, SECRET, update(43, "different body", false), null, null).isEmpty());
    }

    @Test
    void missingWrongShortAndOverlongSecretsAreIndistinguishableFromAnUnknownKey() {
        List<String> bad = new java.util.ArrayList<>();
        bad.add(null);
        bad.add("");
        bad.add("wrong-secret");
        bad.add(SECRET.substring(0, SECRET.length() - 1));
        bad.add(SECRET + "x");
        bad.add("a".repeat(256));
        bad.add("a".repeat(5000));
        for (String supplied : bad) {
            assertThrows(WebhookNotFoundException.class,
                    () -> service.acceptTelegram(KEY, supplied, update(1, "hi", false), null, null));
        }
        assertThrows(WebhookNotFoundException.class,
                () -> service.acceptTelegram("unknown-key", SECRET, update(1, "hi", false), null, null));
        assertThrows(WebhookNotFoundException.class,
                () -> service.acceptTelegram(null, SECRET, update(1, "hi", false), null, null));
        verify(admissions, never()).automatic(any(), any(), any(), any(), any(), anyString());
        // The comparison runs for unknown keys as well (against the dummy hash), so timing does not reveal them.
        verify(secrets, org.mockito.Mockito.times(2)).matches(SECRET, WebhookSecretPort.UNKNOWN_HASH);
    }

    @Test
    void wrongCredentialsAreRejectedBeforeTheUpdateIsLookedAt() {
        assertThrows(WebhookNotFoundException.class,
                () -> service.acceptTelegram(KEY, "wrong", Map.of("not", "an update"), null, null));
    }

    @Test
    void webhookAndTelegramRoutesNeverAcceptEachOthersTriggers() throws Exception {
        WorkflowTrigger webhook = trigger(TriggerType.WEBHOOK);
        when(triggers.findWebhookByEndpoint("webhook-key")).thenReturn(Optional.of(webhook));
        when(triggers.lockCurrent(workflowId, webhook.getId())).thenReturn(Optional.of(webhook));
        // The Telegram route looks only at TELEGRAM triggers, so a webhook key is simply unknown there.
        assertThrows(WebhookNotFoundException.class,
                () -> service.acceptTelegram("webhook-key", SECRET, update(1, "hi", false), null, null));
        // The webhook route never sees TELEGRAM triggers (findWebhookByEndpoint is typed in the adapter) ...
        assertThrows(WebhookNotFoundException.class,
                () -> service.accept(KEY, SECRET, Map.of(), null, null, null));
        // ... and even a mis-typed candidate is refused under the lock.
        when(triggers.findWebhookByEndpoint(KEY)).thenReturn(Optional.of(telegramTrigger));
        assertThrows(WebhookNotFoundException.class,
                () -> service.accept(KEY, SECRET, Map.of(), null, null, null));
        when(triggers.findTelegramByEndpoint("webhook-key")).thenReturn(Optional.of(webhook));
        assertThrows(WebhookNotFoundException.class,
                () -> service.acceptTelegram("webhook-key", SECRET, update(1, "hi", false), null, null));
        verify(admissions, never()).automatic(any(), any(), any(), any(), any(), anyString());
    }

    @Test
    void parsesCaptionsDocumentsAndPhotoSizesAndIgnoresMessagesWithNothingToRun() {
        TelegramUpdate caption = TelegramUpdate.from(Map.of("update_id", 5, "message",
                Map.of("caption", "scan", "photo", List.of(
                        Map.of("file_id", "s", "width", 90, "height", 90, "file_size", 100),
                        Map.of("file_id", "l", "width", 1280, "height", 960, "file_size", 90000),
                        Map.of("file_id", "m", "width", 320, "height", 240, "file_size", 5000))))).orElseThrow();
        assertEquals(Map.of("updateId", 5L, "message", Map.of("caption", "scan")), caption.input());
        assertEquals(List.of("l", "m", "s"), caption.files().stream().map(TelegramUpdate.FileCandidate::telegramFileId).toList());
        assertEquals(new TelegramUpdate.FileCandidate("l", "photo.jpg", "image/jpeg", 90000L), caption.files().get(0));

        TelegramUpdate document = TelegramUpdate.from(Map.of("update_id", 6, "message", Map.of("document",
                Map.of("file_id", "d", "file_name", "a/b\\invoice.pdf", "mime_type", "application/pdf",
                        "file_size", 12)))).orElseThrow();
        assertEquals(List.of(new TelegramUpdate.FileCandidate("d", "abinvoice.pdf", "application/pdf", 12L)),
                document.files());
        assertEquals(Map.of("updateId", 6L, "message", Map.of()), document.input());

        TelegramUpdate bare = TelegramUpdate.from(Map.of("update_id", 7, "message",
                Map.of("document", Map.of("file_id", "d")))).orElseThrow();
        assertEquals(new TelegramUpdate.FileCandidate("d", "document", "application/octet-stream", null),
                bare.files().get(0));

        assertTrue(TelegramUpdate.from(Map.of("update_id", 8, "message", Map.of("document", Map.of("file_name", "x")))).isEmpty());
        assertTrue(TelegramUpdate.from(Map.of("update_id", 9, "message", Map.of("caption", " "))).isEmpty());
    }

    @Test
    void aPhotoIsDownloadedAfterAuthenticationAndAddedToTheInputAsFile() throws Exception {
        UUID connectionId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        WorkflowTrigger bot = botTrigger(connectionId);
        stubBot(bot, workspaceId);
        List<Object[]> fetched = new java.util.ArrayList<>();
        TelegramFilePort port = (workspace, connection, candidates) -> {
            fetched.add(new Object[]{workspace, connection, candidates});
            return Map.of("fileId", "stored-1", "filename", "photo.jpg", "mimeType", "image/jpeg", "size", 90000L);
        };
        WebhookTriggerService withFiles = serviceWith(Optional.of(port));
        Map<String, Object> update = Map.of("update_id", 11, "message", Map.of("message_id", 3, "caption", "receipt",
                "photo", List.of(Map.of("file_id", "l", "width", 800, "height", 600, "file_size", 90000))));

        assertTrue(withFiles.acceptTelegram(KEY, SECRET, update, "corr", null).isPresent());

        assertEquals(1, fetched.size());
        assertEquals(workspaceId, fetched.get(0)[0]);
        assertEquals(connectionId, fetched.get(0)[1]);
        ArgumentCaptor<Object> input = ArgumentCaptor.forClass(Object.class);
        verify(admissions).automatic(eq(bot.getId()), input.capture(), any(), eq("corr"), any(), eq("telegram:11"));
        assertEquals(Map.of("updateId", 11L,
                "message", Map.of("messageId", 3L, "caption", "receipt"),
                "file", Map.of("fileId", "stored-1", "filename", "photo.jpg", "mimeType", "image/jpeg", "size", 90000L)),
                input.getValue());

        assertThrows(WebhookNotFoundException.class, () -> withFiles.acceptTelegram(KEY, "wrong", update, null, null));
        assertEquals(1, fetched.size(), "an unauthenticated caller never starts a download");
    }

    @Test
    void aFileThatCannotBeFetchedNeverLosesTheRun() throws Exception {
        UUID connectionId = UUID.randomUUID();
        WorkflowTrigger bot = botTrigger(connectionId);
        stubBot(bot, UUID.randomUUID());
        Map<String, Object> update = Map.of("update_id", 12, "message", Map.of("text", "see attached",
                "document", Map.of("file_id", "d", "file_name", "a.pdf", "mime_type", "application/pdf", "file_size", 7)));

        TelegramFilePort crashing = (workspace, connection, candidates) -> {
            throw new IllegalStateException("boom " + candidates);
        };
        assertTrue(serviceWith(Optional.of(crashing)).acceptTelegram(KEY, SECRET, update, null, null).isPresent());
        assertTrue(serviceWith(Optional.empty()).acceptTelegram(KEY, SECRET, update, null, null).isPresent());

        ArgumentCaptor<Object> input = ArgumentCaptor.forClass(Object.class);
        verify(admissions, org.mockito.Mockito.times(2)).automatic(eq(bot.getId()), input.capture(), any(), any(), any(),
                eq("telegram:12"));
        Map<String, Object> skipped = Map.of("filename", "a.pdf", "mimeType", "application/pdf", "size", 7L);
        for (int i = 0; i < 2; i++) {
            Map<?, ?> file = (Map<?, ?>) ((Map<?, ?>) input.getAllValues().get(i)).get("file");
            assertEquals(i == 0 ? "error" : "not_stored", file.get("skipped"));
            skipped.forEach((key, value) -> assertEquals(value, file.get(key)));
            assertFalse(file.toString().contains("boom"));
        }
    }

    private WebhookTriggerService serviceWith(Optional<TelegramFilePort> port) {
        return new WebhookTriggerService(workflows, triggers, secrets, admissions,
                new WebhookIngressRateLimiter(1000, Duration.ofMinutes(1)),
                new WebhookEndpointRateLimiter(1000, Duration.ofMinutes(1)), port,
                org.springframework.transaction.support.TransactionOperations.withoutTransaction());
    }

    private WorkflowTrigger botTrigger(UUID connectionId) throws Exception {
        WorkflowTrigger bot = WorkflowTrigger.createNew(workflowId, versionId, "node", TriggerType.TELEGRAM,
                Map.of("connectionId", connectionId.toString()), TriggerStatus.ACTIVE, null, null, Instant.now());
        bot.provisionWebhook(KEY, sha256(SECRET));
        return bot;
    }

    private void stubBot(WorkflowTrigger bot, UUID workspaceId) {
        when(triggers.findTelegramByEndpoint(KEY)).thenReturn(Optional.of(bot));
        when(triggers.lockCurrent(workflowId, bot.getId())).thenReturn(Optional.of(bot));
        Instant now = Instant.now();
        Workflow published = new Workflow(workflowId, workspaceId, "Bot", "d", WorkflowStatus.PUBLISHED, "1.0",
                Map.of("schemaVersion", "1.0", "nodes", List.of(), "edges", List.of(), "variables", Map.of()),
                Map.of(), versionId, UUID.randomUUID(), now, now, now, null, null);
        when(workflows.findById(workflowId)).thenReturn(Optional.of(published));
        when(workflows.lockById(eq(workflowId), any())).thenReturn(Optional.of(published));
    }

    private WorkflowTrigger trigger(TriggerType type) throws Exception {
        WorkflowTrigger trigger = WorkflowTrigger.createNew(workflowId, versionId, "node", type,
                Map.of(), TriggerStatus.ACTIVE, null, null, Instant.now());
        trigger.provisionWebhook(type == TriggerType.TELEGRAM ? KEY : "webhook-key", sha256(SECRET));
        return trigger;
    }

    /** Same scheme as the production adapter (SHA-256, constant-time compare, dummy for malformed hashes). */
    private static final class Sha256Secrets implements WebhookSecretPort {
        @Override
        public IssuedKey provision() {
            throw new UnsupportedOperationException();
        }

        @Override
        public boolean matches(String supplied, String storedHash) {
            try {
                byte[] actual = java.security.MessageDigest.getInstance("SHA-256").digest(
                        (supplied != null && supplied.length() <= 128 ? supplied : "")
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8));
                byte[] expected = storedHash != null && storedHash.length() == 64
                        ? java.util.HexFormat.of().parseHex(storedHash) : new byte[32];
                return java.security.MessageDigest.isEqual(actual, expected);
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        }
    }

    private static String sha256(String value) throws Exception {
        return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                .digest(value.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    private static Map<String, Object> update(int id, String text, boolean full) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("message_id", 7);
        message.put("date", 1700000000);
        message.put("text", text);
        if (full) {
            message.put("chat", Map.of("id", -1001, "type", "supergroup", "title", "ignored"));
            message.put("from", Map.of("id", 99, "is_bot", false, "first_name", "Ada", "username", "ada",
                    "language_code", "en"));
        }
        return Map.of("update_id", id, "message", message);
    }
}
