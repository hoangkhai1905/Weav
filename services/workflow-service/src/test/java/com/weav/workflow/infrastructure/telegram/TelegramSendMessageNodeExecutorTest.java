package com.weav.workflow.infrastructure.telegram;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TelegramSendMessageNodeExecutorTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static final String TOKEN = "123456:synthetic-bot-token";

    @Test
    void sendsTheMessageThroughTheFixedBotApiPathAndReturnsOnlyIds() {
        FakeTelegram telegram = new FakeTelegram(200, Map.of("ok", true, "result", Map.of(
                "message_id", 77, "date", 1, "text", "hi", "chat", Map.of("id", -1001234567890L, "type", "group"))));
        FakeWorkspace workspace = new FakeWorkspace();
        TelegramSendMessageNodeExecutor executor = executor(telegram, workspace);

        NodeExecutor.Result result = executor.execute(context(), config());

        assertEquals("telegram.send_message", executor.type());
        assertEquals(Map.of("messageId", 77L, "chatId", -1001234567890L), result.output());
        assertEquals("https://api.telegram.org/bot" + TOKEN + "/sendMessage", telegram.uri.toString());
        assertEquals(Map.of("chat_id", "555", "text", "hello"), telegram.body);
        assertEquals(WORKSPACE_ID, workspace.workspaceId);
        assertEquals(CONNECTION_ID, workspace.connectionId);
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void numericChatIdFromAMappingIsSentAsText() {
        FakeTelegram telegram = new FakeTelegram(200, Map.of("ok", true, "result", Map.of("message_id", 1)));
        Map<String, Object> config = config();
        config.put("chatId", 987654321L);

        Map<String, Object> output = executor(telegram, new FakeWorkspace()).execute(context(), config).output();

        assertEquals("987654321", ((Map<?, ?>) telegram.body).get("chat_id"));
        assertEquals(Map.of("messageId", 1L), output);
    }

    @Test
    void rejectedTokenIsNonRetryableAndReportedToWorkspaceWithoutLeakingTheToken() {
        FakeTelegram telegram = new FakeTelegram(401, Map.of("ok", false, "error_code", 401,
                "description", "Unauthorized"));
        FakeWorkspace workspace = new FakeWorkspace();

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor(telegram, workspace).execute(context(), config()));

        assertEquals("AUTHENTICATION_REJECTED", failure.code());
        assertFalse(failure.retryable());
        assertEquals(1, workspace.reportCalls);
        assertFalse(failure.getMessage().contains(TOKEN));
        assertThrows(IllegalStateException.class, workspace.resolved::auth);
    }

    @Test
    void badRequestForbiddenAndNotFoundAreNonRetryableAndKeepTelegramsReason() {
        for (int status : new int[] {400, 403, 404}) {
            FakeTelegram telegram = new FakeTelegram(status, Map.of("ok", false, "error_code", status,
                    "description", "Bad Request: chat not found"));
            FakeWorkspace workspace = new FakeWorkspace();

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(telegram, workspace).execute(context(), config()));

            assertEquals("HTTP_BUSINESS_REJECTED", failure.code(), String.valueOf(status));
            assertFalse(failure.retryable());
            assertTrue(failure.getMessage().contains("chat not found"));
            assertFalse(failure.getMessage().contains(TOKEN));
            assertEquals(0, workspace.reportCalls);
        }
    }

    @Test
    void rateLimitIsRetryableAndSafeToRepeatBecauseNothingWasSent() {
        FakeTelegram telegram = new FakeTelegram(429, Map.of("ok", false, "error_code", 429,
                "parameters", Map.of("retry_after", 3)));

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor(telegram, new FakeWorkspace()).execute(context(), config()));

        assertEquals("HTTP_RATE_LIMITED", failure.code());
        assertTrue(failure.retryable());
        assertTrue(failure.requestNotSent());
    }

    @Test
    void serverErrorsAndTransportFailuresAreRetryable() {
        FakeTelegram serverError = new FakeTelegram(502, Map.of("ok", false));
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor(serverError, new FakeWorkspace()).execute(context(), config()));
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failure.code());
        assertTrue(failure.retryable());

        FakeTelegram timeout = new FakeTelegram(0, null);
        timeout.failure = new NodeExecutor.Failure("HTTP_TIMEOUT", "The HTTP request timed out.", true);
        NodeExecutor.Failure timedOut = assertThrows(NodeExecutor.Failure.class,
                () -> executor(timeout, new FakeWorkspace()).execute(context(), config()));
        assertEquals("HTTP_TIMEOUT", timedOut.code());
        assertTrue(timedOut.retryable());

        FakeTelegram broken = new FakeTelegram(0, null);
        broken.runtimeFailure = new IllegalStateException(TOKEN);
        NodeExecutor.Failure unexpected = assertThrows(NodeExecutor.Failure.class,
                () -> executor(broken, new FakeWorkspace()).execute(context(), config()));
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", unexpected.code());
        assertFalse(unexpected.getMessage().contains(TOKEN));
    }

    @Test
    void successWithoutOkOrMessageIdIsAnInvalidResponse() {
        for (Object body : List.of(Map.of("ok", false), Map.of("ok", true, "result", Map.of()), "plain text")) {
            FakeTelegram telegram = new FakeTelegram(200, body);
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(telegram, new FakeWorkspace()).execute(context(), config()));
            assertEquals("HTTP_INVALID_RESPONSE", failure.code());
        }
    }

    @Test
    void invalidConfigurationAndConnectionsFailBeforeAnyTelegramCall() {
        FakeTelegram telegram = new FakeTelegram(200, Map.of("ok", true, "result", Map.of("message_id", 1)));
        FakeWorkspace workspace = new FakeWorkspace();
        TelegramSendMessageNodeExecutor executor = executor(telegram, workspace);
        for (Map<String, Object> broken : List.of(
                without("connectionId"), without("chatId"), without("text"),
                with("connectionId", "{{ trigger.input.id }}"), with("chatId", "  "), with("chatId", 1.5d),
                with("text", ""), with("text", "x".repeat(4097)))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), broken));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
        }
        assertEquals(0, workspace.resolveCalls);
        assertFalse(telegram.called);
    }

    @Test
    void wrongProviderOrTokenShapeIsAConnectionConfigurationFailureWithoutACall() {
        for (ResolvedConnection resolved : List.of(
                new ResolvedConnection("HTTP", "TOKEN", Map.of("token", TOKEN)),
                new ResolvedConnection("TELEGRAM", "TOKEN", Map.of("token", "not a token")),
                new ResolvedConnection("TELEGRAM", "TOKEN", Map.of("token", TOKEN, "extra", "x")))) {
            FakeTelegram telegram = new FakeTelegram(200, Map.of("ok", true, "result", Map.of("message_id", 1)));
            FakeWorkspace workspace = new FakeWorkspace();
            workspace.resolved = resolved;

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(telegram, workspace).execute(context(), config()));

            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertFalse(failure.retryable());
            assertFalse(telegram.called);
        }
    }

    @Test
    void workspaceDenialAndOutageMapToSafeFailures() {
        for (boolean denied : new boolean[] {true, false}) {
            FakeWorkspace workspace = new FakeWorkspace();
            workspace.failure = denied ? new ForbiddenException() : new WorkspaceDependencyUnavailableException();
            FakeTelegram telegram = new FakeTelegram(200, Map.of());

            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(telegram, workspace).execute(context(), config()));

            assertEquals(denied ? "CONNECTION_FORBIDDEN" : "CONNECTION_UNAVAILABLE", failure.code());
            assertEquals(!denied, failure.retryable());
            assertFalse(telegram.called);
        }
    }

    @Test
    void realTransportRefusesAnythingButTheBotApiOnTheFixedHost() {
        PinnedHttpTransport transport = new PinnedHttpTransport();
        for (String target : List.of(
                "http://api.telegram.org/bot1:abc/sendMessage",
                "https://evil.example.test/bot1:abc/sendMessage",
                "https://api.telegram.org@evil.example.test/bot1:abc/sendMessage",
                "https://api.telegram.org:8443/bot1:abc/sendMessage",
                "https://api.telegram.org/file/bot1:abc/sendMessage",
                "https://api.telegram.org/bot1:abc/sendMessage?x=1",
                "https://api.telegram.org/bot1:abc/../sendMessage")) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeTelegramBotApi(URI.create(target), Map.of()), target);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), target);
            assertFalse(failure.retryable());
        }
    }

    private static TelegramSendMessageNodeExecutor executor(FakeTelegram telegram, FakeWorkspace workspace) {
        return new TelegramSendMessageNodeExecutor(new TelegramBotApiClient(telegram), workspace);
    }

    private static Map<String, Object> config() {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("chatId", "555");
        config.put("text", "hello");
        return config;
    }

    private static Map<String, Object> without(String key) {
        Map<String, Object> config = config();
        config.remove(key);
        return config;
    }

    private static Map<String, Object> with(String key, Object value) {
        Map<String, Object> config = config();
        config.put(key, value);
        return config;
    }

    private static NodeExecutor.Context context() {
        return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(),
                "telegram-node", 1, "correlation-id", null);
    }

    private static final class FakeTelegram extends PinnedHttpTransport {
        private final int status;
        private final Object data;
        private boolean called;
        private URI uri;
        private Object body;
        private NodeExecutor.Failure failure;
        private RuntimeException runtimeFailure;

        private FakeTelegram(int status, Object data) {
            super();
            this.status = status;
            this.data = data;
        }

        @Override
        public HttpResponse executeTelegramBotApi(URI target, Object requestBody) {
            called = true;
            uri = target;
            body = requestBody;
            if (failure != null) {
                throw failure;
            }
            if (runtimeFailure != null) {
                throw runtimeFailure;
            }
            return new HttpResponse(status, data, Map.of());
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private ResolvedConnection resolved = new ResolvedConnection("TELEGRAM", "TOKEN", Map.of("token", TOKEN));
        private RuntimeException failure;
        private UUID workspaceId;
        private UUID connectionId;
        private int resolveCalls;
        private int reportCalls;

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            resolveCalls++;
            this.workspaceId = workspaceId;
            this.connectionId = connectionId;
            if (failure != null) {
                throw failure;
            }
            return resolved;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reportCalls++;
        }
    }
}
