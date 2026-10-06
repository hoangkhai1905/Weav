package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.files.WorkflowFileProperties;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** email.send optional fields: parsing, header safety, attachment resolution and the unchanged plain path. */
class EmailSendFeaturesTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");

    private final CapturingClient gmail = new CapturingClient();
    private final FakeFileStore store = new FakeFileStore();
    private final StubTransport transport = new StubTransport();
    private final WorkflowFileProperties limits = new WorkflowFileProperties();

    private final Workspace workspace = new Workspace();

    @Test
    void combinedRecipientsAreCappedAtTheExistingMaximum() {
        Map<String, Object> config = config();
        config.put("to", java.util.stream.IntStream.rangeClosed(1, 6).mapToObj(i -> "t" + i + "@example.test").toList());
        config.put("cc", java.util.stream.IntStream.rangeClosed(1, 5).mapToObj(i -> "c" + i + "@example.test").toList());
        assertEquals("CONFIGURATION_ERROR", code(assertThrows(NodeExecutor.Failure.class, () -> run(config))));

        config.put("cc", java.util.stream.IntStream.rangeClosed(1, 4).mapToObj(i -> "c" + i + "@example.test").toList());
        run(config);
        assertEquals(1, gmail.messageCalls);
    }

    @Test
    void anUnavailableConnectionFailsBeforeAnyDownload() {
        workspace.forbidden = true;
        Map<String, Object> config = config();
        config.put("attachments", List.of(Map.of("url", "https://files.example.test/x"), Map.of("fileId", "f")));

        assertEquals("CONNECTION_FORBIDDEN", code(assertThrows(NodeExecutor.Failure.class, () -> run(config))));

        assertEquals(0, transport.cap);
        assertNull(store.readWorkspace);
    }

    @Test
    void eachUrlDownloadIsCappedByWhatIsLeftOfTheTotalBudget() {
        limits.setMaxFileBytes(10);
        limits.setMaxEmailBytes(15);
        transport.download = new PinnedHttpTransport.Download(200, new byte[8], null, null);
        Map<String, Object> config = config();
        config.put("attachments", List.of(Map.of("url", "https://files.example.test/a"),
                Map.of("url", "https://files.example.test/b")));
        transport.failAfter = 1;
        transport.failure = new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE", "x", false);

        assertEquals("ATTACHMENT_LIMIT_EXCEEDED", code(assertThrows(NodeExecutor.Failure.class, () -> run(config))));

        assertEquals(7, transport.cap);
    }

    private NodeExecutor.Result run(Map<String, Object> config) {
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, workspace,
                new EmailAttachmentResolver(store, transport, limits));
        return executor.execute(new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(),
                "email-node", 1, "correlation-id", null), config);
    }

    private static Map<String, Object> config() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("to", "a@example.test");
        config.put("subject", "Weekly report");
        config.put("body", "Hello");
        return config;
    }

    private static String code(NodeExecutor.Failure failure) {
        assertFalse(failure.retryable());
        return failure.code();
    }

    @Test
    void anOldConfigStillUsesTheOriginalSendPathAndOutput() {
        NodeExecutor.Result result = run(config());

        assertEquals(1, gmail.sendCalls);
        assertEquals(0, gmail.messageCalls);
        assertEquals(Map.of("messageId", "msg", "status", "SENT"), result.output());
    }

    @Test
    void newFieldsReachTheClientAndBlankOnesAreIgnored() {
        Map<String, Object> config = config();
        config.put("cc", List.of("c@example.test"));
        config.put("bcc", " b@example.test ");
        config.put("replyTo", "r@example.test");
        config.put("bodyType", "HTML");
        config.put("senderName", "Weav Bot");
        config.put("attachments", "");

        NodeExecutor.Result result = run(config);

        GmailClient.Outgoing sent = gmail.outgoing;
        assertEquals(List.of("c@example.test"), sent.cc());
        assertEquals(List.of("b@example.test"), sent.bcc());
        assertEquals(List.of("r@example.test"), sent.replyTo());
        assertEquals("Weav Bot", sent.senderName());
        assertTrue(sent.html());
        assertTrue(sent.attachments().isEmpty());
        assertFalse(result.output().containsKey("attachmentCount"));

        Map<String, Object> blanks = config();
        blanks.put("cc", "");
        blanks.put("bcc", List.of());
        blanks.put("senderName", " ");
        blanks.put("bodyType", "");
        run(blanks);
        assertEquals(2, gmail.sendCalls + gmail.messageCalls);
        assertEquals(1, gmail.sendCalls);
    }

    @Test
    void headerInjectionAndInvalidValuesAreRejectedInEveryField() {
        String bad = "x@example.test\r\nBcc: victim@example.test";
        List<Map<String, Object>> invalid = new ArrayList<>();
        for (String field : List.of("to", "cc", "bcc", "replyTo")) {
            Map<String, Object> config = config();
            config.put(field, bad);
            invalid.add(config);
            Map<String, Object> inList = config();
            inList.put(field, List.of("ok@example.test", bad));
            invalid.add(inList);
        }
        for (Map.Entry<String, Object> entry : Map.<String, Object>of(
                "subject", "Hi\r\nBcc: v@example.test", "senderName", "Bot\r\nBcc: v@example.test",
                "replyToMessageId", "abc\r\n123", "bodyType", "markdown").entrySet()) {
            Map<String, Object> config = config();
            config.put(entry.getKey(), entry.getValue());
            invalid.add(config);
        }
        Map<String, Object> longName = config();
        longName.put("senderName", "n".repeat(101));
        invalid.add(longName);
        Map<String, Object> notHex = config();
        notHex.put("replyToMessageId", "../messages");
        invalid.add(notHex);
        Map<String, Object> blankSubject = config();
        blankSubject.put("subject", " ");
        invalid.add(blankSubject);

        for (Map<String, Object> config : invalid) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> run(config));
            assertEquals("CONFIGURATION_ERROR", code(failure));
        }
        assertEquals(0, gmail.sendCalls + gmail.messageCalls);
    }

    @Test
    void blankSubjectIsAllowedOnlyWhenReplying() {
        Map<String, Object> config = config();
        config.put("subject", "");
        config.put("replyToMessageId", "18C2F0A9");

        run(config);

        assertEquals("", gmail.outgoing.subject());
        assertEquals("18C2F0A9", gmail.outgoing.replyToMessageId());
    }

    @Test
    void urlAttachmentUsesExplicitNameThenContentDispositionThenUrlSegment() {
        transport.download = new PinnedHttpTransport.Download(200, new byte[]{1, 2, 3}, "application/pdf", "from-header.pdf");
        Map<String, Object> config = config();
        config.put("attachments", List.of(
                Map.of("url", "https://files.example.test/a/report.pdf", "filename", "../Custom.pdf"),
                Map.of("url", "https://files.example.test/a/report.pdf")));

        NodeExecutor.Result result = run(config);

        List<MimeMessageBuilder.Attachment> sent = gmail.outgoing.attachments();
        assertEquals("..Custom.pdf", sent.get(0).filename()); // separators dropped, nothing else
        assertEquals("from-header.pdf", sent.get(1).filename());
        assertEquals("application/pdf", sent.get(0).mimeType());
        assertArrayEquals(new byte[]{1, 2, 3}, sent.get(0).bytes());
        assertEquals(2, result.output().get("attachmentCount"));
        assertEquals(limits.getMaxFileBytes(), transport.cap);

        transport.download = new PinnedHttpTransport.Download(200, new byte[]{9}, null, null);
        config.put("attachments", List.of(Map.of("url", "https://files.example.test/a/My%20File.txt?x=1"),
                Map.of("url", "https://files.example.test/")));
        run(config);
        assertEquals("My File.txt", gmail.outgoing.attachments().get(0).filename());
        assertEquals("attachment", gmail.outgoing.attachments().get(1).filename());
        assertEquals("application/octet-stream", gmail.outgoing.attachments().get(0).mimeType());
    }

    @Test
    void fileReferenceIsReadFromTheWorkspaceFileStore() {
        store.put("file-1", "scan.png", "image/png", new byte[]{7, 7});
        Map<String, Object> config = config();
        config.put("attachments", List.of(Map.of("fileId", "file-1", "filename", "renamed.png")));

        run(config);

        assertEquals(WORKSPACE_ID, store.readWorkspace);
        MimeMessageBuilder.Attachment attachment = gmail.outgoing.attachments().get(0);
        assertEquals("renamed.png", attachment.filename());
        assertEquals("image/png", attachment.mimeType());
    }

    @Test
    void notFoundAndUnconfiguredFileStoreFailuresPropagateAndNothingIsSent() {
        Map<String, Object> config = config();
        config.put("attachments", List.of(Map.of("fileId", "missing")));
        assertEquals("FILE_NOT_FOUND", code(assertThrows(NodeExecutor.Failure.class, () -> run(config))));

        store.configured = false;
        assertEquals("DEPENDENCY_NOT_CONFIGURED", code(assertThrows(NodeExecutor.Failure.class, () -> run(config))));
        assertEquals(0, gmail.sendCalls + gmail.messageCalls);
    }

    @Test
    void triggerGmailAttachmentListSkipsItemsWithoutAFileId() {
        store.put("file-1", "a.txt", "text/plain", new byte[]{1});
        Map<String, Object> config = config();
        config.put("attachments", List.of(
                Map.of("filename", "a.txt", "mimeType", "text/plain", "size", 1, "fileId", "file-1"),
                Map.of("filename", "huge.zip", "mimeType", "application/zip", "size", 99999999, "skipped", "TOO_LARGE")));

        NodeExecutor.Result result = run(config);

        assertEquals(1, gmail.outgoing.attachments().size());
        assertEquals(1, result.output().get("attachmentCount"));
        assertEquals(1, result.output().get("skippedAttachments"));
    }

    @Test
    void onlySkippedItemsStillSendThePlainMessageAndReportTheSkips() {
        Map<String, Object> config = config();
        config.put("attachments", List.of(Map.of("filename", "huge.zip", "skipped", "TOO_LARGE")));

        NodeExecutor.Result result = run(config);

        assertEquals(1, gmail.sendCalls);
        assertEquals(0, result.output().get("attachmentCount"));
        assertEquals(1, result.output().get("skippedAttachments"));
    }

    @Test
    void attachmentLimitsAreEnforcedWithStableCodes() {
        limits.setMaxAttachments(2);
        limits.setMaxFileBytes(10);
        limits.setMaxEmailBytes(15);
        for (String id : List.of("a", "b", "c")) {
            store.put(id, id + ".bin", "application/octet-stream", new byte[8]);
        }
        store.put("big", "big.bin", "application/octet-stream", new byte[11]);

        Map<String, Object> tooMany = config();
        tooMany.put("attachments", List.of(Map.of("fileId", "a"), Map.of("fileId", "b"), Map.of("fileId", "c")));
        assertEquals("ATTACHMENT_LIMIT_EXCEEDED", code(assertThrows(NodeExecutor.Failure.class, () -> run(tooMany))));

        Map<String, Object> total = config();
        total.put("attachments", List.of(Map.of("fileId", "a"), Map.of("fileId", "b")));
        assertEquals("ATTACHMENT_LIMIT_EXCEEDED", code(assertThrows(NodeExecutor.Failure.class, () -> run(total))));

        Map<String, Object> big = config();
        big.put("attachments", List.of(Map.of("fileId", "big")));
        assertEquals("ATTACHMENT_TOO_LARGE", code(assertThrows(NodeExecutor.Failure.class, () -> run(big))));

        transport.failure = new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE", "x", false);
        Map<String, Object> url = config();
        url.put("attachments", List.of(Map.of("url", "https://files.example.test/x")));
        assertEquals("ATTACHMENT_TOO_LARGE", code(assertThrows(NodeExecutor.Failure.class, () -> run(url))));

        Map<String, Object> notAList = config();
        notAList.put("attachments", "{{ unresolved }}");
        assertEquals("CONFIGURATION_ERROR", code(assertThrows(NodeExecutor.Failure.class, () -> run(notAList))));
        assertEquals(0, gmail.sendCalls + gmail.messageCalls);
    }

    private static final class StubTransport extends PinnedHttpTransport {
        private Download download = new Download(200, new byte[0], null, null);
        private NodeExecutor.Failure failure;
        private int cap;
        private int failAfter;

        @Override
        public Download downloadPublicFile(URI uri, int maxResponseBytes) {
            cap = maxResponseBytes;
            if (failAfter-- > 0) {
                return download;
            }
            if (failure != null) {
                throw failure;
            }
            return download;
        }
    }

    private static final class CapturingClient extends GmailClient {
        private int sendCalls;
        private int messageCalls;
        private Outgoing outgoing;

        private CapturingClient() {
            super(new PinnedHttpTransport());
        }

        @Override
        public Map<String, Object> send(List<String> recipients, String subject, String body, ResolvedConnection c) {
            sendCalls++;
            return Map.of("messageId", "msg", "status", "SENT");
        }

        @Override
        public Map<String, Object> sendMessage(Outgoing message, ResolvedConnection connection) {
            messageCalls++;
            outgoing = message;
            return new LinkedHashMap<>(Map.of("messageId", "msg", "status", "SENT"));
        }
    }

    private static final class Workspace implements WorkspaceConnectionPort {
        private boolean forbidden;

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            if (forbidden) {
                throw new com.weav.workflow.domain.exception.ForbiddenException();
            }
            return new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", "synthetic-token"),
                    UUID.randomUUID(), 1L);
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        }
    }
}
