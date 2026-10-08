package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ConnectionReconnectRequiredException;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.files.WorkflowFileProperties;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class GmailNodeExecutorTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static final String ACCESS_TOKEN = "synthetic-gmail-access-token";
    private static final UUID CREDENTIAL_ID = UUID.fromString("00000000-0000-0000-0000-0000000000c1");
    private static final Long CREDENTIAL_VERSION = 1_790_000_000_123L;

    @Test
    void sendsToTrimmedRecipientsAndRedactsTheTokenFromOutput() {
        FakeGmailClient gmail = new FakeGmailClient();
        gmail.result = Map.of("messageId", "msg-1", "status", "SENT", "debug", ACCESS_TOKEN);
        FakeWorkspace workspace = new FakeWorkspace();
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, workspace, resolver());

        NodeExecutor.Result result = executor.execute(context(), config(" a@example.test , b@example.test"));

        assertEquals("email.send", executor.type());
        assertEquals(List.of("a@example.test", "b@example.test"), gmail.recipients);
        assertEquals("Weekly report", gmail.subject);
        assertEquals("Hello\nteam", gmail.body);
        assertEquals(ACCESS_TOKEN, gmail.tokenSeen);
        assertEquals(CONNECTION_ID, workspace.connectionId);
        assertEquals("msg-1", result.output().get("messageId"));
        assertFalse(result.output().toString().contains(ACCESS_TOKEN));
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void acceptsRecipientListFromMappings() {
        FakeGmailClient gmail = new FakeGmailClient();
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, new FakeWorkspace(), resolver());

        Map<String, Object> config = config("unused");
        config.put("to", List.of("a@example.test", "b@example.test"));
        executor.execute(context(), config);

        assertEquals(List.of("a@example.test", "b@example.test"), gmail.recipients);
    }

    @Test
    void rejectsInvalidConfigurationBeforeResolvingCredentials() {
        FakeGmailClient gmail = new FakeGmailClient();
        FakeWorkspace workspace = new FakeWorkspace();
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, workspace, resolver());

        Map<String, Object> missingConnection = config("a@example.test");
        missingConnection.remove("connectionId");
        Map<String, Object> mappedConnection = config("a@example.test");
        mappedConnection.put("connectionId", "{{ trigger.input.connectionId }}");
        Map<String, Object> headerInjection = config("a@example.test");
        headerInjection.put("subject", "Hi\r\nBcc: victim@example.test");
        Map<String, Object> blankSubject = config("a@example.test");
        blankSubject.put("subject", " ");
        Map<String, Object> tooManyRecipients = config("unused");
        tooManyRecipients.put("to", java.util.stream.IntStream.rangeClosed(1, GmailNodeExecutor.MAX_RECIPIENTS + 1)
                .mapToObj(index -> "user" + index + "@example.test").toList());
        Map<String, Object> hugeBody = config("a@example.test");
        hugeBody.put("body", "x".repeat(GmailNodeExecutor.MAX_BODY_LENGTH + 1));

        for (Map<String, Object> invalid : List.of(
                missingConnection, mappedConnection, headerInjection, blankSubject, tooManyRecipients, hugeBody,
                config("not-an-address"), config("a@example.test\r\nBcc: x@example.test"),
                config("Name <a@example.test"), config("Name <a@example.test> junk"), config(""),
                config("a@example.test,"), config("Name <a@example.test\r\nBcc: x@example.test>"))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), invalid));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
            assertNotNull(failure.field());
        }
        assertEquals(0, workspace.resolveCalls);
        assertEquals(0, gmail.sendCalls);
    }

    @Test
    void invalidRecipientNamesTheFieldButNotTheValue() {
        GmailNodeExecutor executor = new GmailNodeExecutor(new FakeGmailClient(), new FakeWorkspace(), resolver());
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), config("secret-not-an-address")));
        assertEquals("to", failure.field());
        assertEquals("The 'to' field is not a valid email address.", failure.safeMessage());
    }

    @Test
    void acceptsMailboxFormsAndKeepsOnlyTheAddress() {
        FakeGmailClient gmail = new FakeGmailClient();
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, new FakeWorkspace(), resolver());
        executor.execute(context(), config("\"Doe, Jane\" <jane@example.test>, Bob <bob@example.test>, c@example.test"));
        assertEquals(List.of("jane@example.test", "bob@example.test", "c@example.test"), gmail.recipients);
    }

    @Test
    void authenticationRejectionIsReportedAndConnectionIsClosed() {
        FakeGmailClient gmail = new FakeGmailClient();
        gmail.failure = new NodeExecutor.Failure("AUTHENTICATION_REJECTED", "Rejected.", false);
        FakeWorkspace workspace = new FakeWorkspace();
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, workspace, resolver());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), config("a@example.test")));

        assertEquals("AUTHENTICATION_REJECTED", failure.code());
        assertEquals(1, workspace.reportCalls);
        // WS-11: the report carries the credential id/version of the resolve it used.
        assertEquals(CREDENTIAL_ID, workspace.reported.credentialId());
        assertEquals(CREDENTIAL_VERSION, workspace.reported.credentialVersion());
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void unexpectedClientErrorsAreTerminalBecauseTheEmailMayHaveBeenSent() {
        FakeGmailClient gmail = new FakeGmailClient();
        gmail.unexpected = new IllegalStateException("boom");
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, new FakeWorkspace(), resolver());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), config("a@example.test")));

        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failure.code());
        assertFalse(failure.retryable());
    }

    @Test
    void connectionNeedingReconnectFailsNonRetryableWithAStableCodeAndNeverSends() {
        FakeGmailClient gmail = new FakeGmailClient();
        FakeWorkspace workspace = new FakeWorkspace();
        workspace.reconnect = true;
        GmailNodeExecutor executor = new GmailNodeExecutor(gmail, workspace, resolver());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), config("a@example.test")));

        assertEquals("CONNECTION_RECONNECT_REQUIRED", failure.code());
        assertFalse(failure.retryable());
        assertTrue(failure.getMessage().contains("reconnect"));
        assertEquals(0, gmail.sendCalls);
    }

    @Test
    void mapsWorkspaceDenialAndUnavailabilityWithoutSending() {
        for (boolean forbidden : List.of(true, false)) {
            FakeGmailClient gmail = new FakeGmailClient();
            FakeWorkspace workspace = new FakeWorkspace();
            workspace.forbidden = forbidden;
            workspace.unavailable = !forbidden;
            GmailNodeExecutor executor = new GmailNodeExecutor(gmail, workspace, resolver());

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), config("a@example.test")));

            assertEquals(forbidden ? "CONNECTION_FORBIDDEN" : "CONNECTION_UNAVAILABLE", failure.code());
            // Resolving credentials happens before any send, so retrying cannot duplicate an email.
            assertEquals(!forbidden, failure.retryable());
            assertEquals(0, gmail.sendCalls);
        }
    }

    @Test
    void gmailExecutorReplacesTheUnavailableAdapterInTheRegistry() {
        try (AnnotationConfigApplicationContext application = new AnnotationConfigApplicationContext()) {
            application.registerBean(WorkspaceConnectionPort.class, FakeWorkspace::new);
            application.registerBean(PinnedHttpTransport.class, PinnedHttpTransport::new);
            application.registerBean(WorkflowFileStore.class, FakeFileStore::new);
            application.registerBean(WorkflowFileProperties.class, WorkflowFileProperties::new);
            application.register(NodeExecutorRegistry.class);
            application.scan("com.weav.workflow.infrastructure.gmail");
            application.refresh();

            assertSame(application.getBean(GmailNodeExecutor.class),
                    application.getBean(NodeExecutorRegistry.class).require("email.send"));
        }
    }

    private static EmailAttachmentResolver resolver() {
        return new EmailAttachmentResolver(new FakeFileStore(), new PinnedHttpTransport(), new WorkflowFileProperties());
    }

    private static Map<String, Object> config(String to) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("to", to);
        config.put("subject", "Weekly report");
        config.put("body", "Hello\nteam");
        return config;
    }

    private static NodeExecutor.Context context() {
        return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(),
                "email-node", 1, "correlation-id", null);
    }

    private static final class FakeGmailClient extends GmailClient {
        private List<String> recipients;
        private String subject;
        private String body;
        private String tokenSeen;
        private int sendCalls;
        private Map<String, Object> result = Map.of("messageId", "msg", "status", "SENT");
        private NodeExecutor.Failure failure;
        private RuntimeException unexpected;

        private FakeGmailClient() {
            super(new PinnedHttpTransport());
        }

        @Override
        public Map<String, Object> send(
                List<String> recipients, String subject, String body, ResolvedConnection connection) {
            sendCalls++;
            this.recipients = recipients;
            this.subject = subject;
            this.body = body;
            this.tokenSeen = connection.auth().get("accessToken");
            if (failure != null) {
                throw failure;
            }
            if (unexpected != null) {
                throw unexpected;
            }
            return result;
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private ResolvedConnection resolved;
        private ResolvedConnection reported;
        private boolean forbidden;
        private boolean unavailable;
        private boolean reconnect;
        private UUID connectionId;
        private int resolveCalls;
        private int reportCalls;

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            resolveCalls++;
            this.connectionId = connectionId;
            if (forbidden) {
                throw new ForbiddenException();
            }
            if (unavailable) {
                throw new WorkspaceDependencyUnavailableException();
            }
            if (reconnect) {
                throw new ConnectionReconnectRequiredException();
            }
            resolved = new ResolvedConnection("GMAIL", "OAUTH2", Map.of("accessToken", ACCESS_TOKEN),
                    CREDENTIAL_ID, CREDENTIAL_VERSION);
            return resolved;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reportCalls++;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
            reported = resolved;
            reportAuthenticationRejected(workspaceId, connectionId);
        }
    }
}
