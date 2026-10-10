package com.weav.workflow.infrastructure.slack;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SlackSendMessageNodeExecutorTest {
    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID CONNECTION_ID = UUID.randomUUID();
    private static final String WEBHOOK = "https://hooks.slack.com/services/T0123ABC/B0456DEF/syntheticSecretToken01";

    @Test
    void postsTheTextAsSlackJson() {
        FakeSlack slack = new FakeSlack(200, "ok");
        NodeExecutor.Result result = executor(slack, new FakeWorkspace(WEBHOOK)).execute(context(), config("Build *failed*"));
        assertEquals(Map.of("sent", true), result.output());
        assertEquals(WEBHOOK, slack.uri.toString());
        assertEquals(Map.of("text", "Build *failed*"), slack.body);
    }

    @Test
    void controlCharactersAreEscapedSoUpstreamDataCannotPingOrPhish() {
        FakeSlack slack = new FakeSlack(200, "ok");
        executor(slack, new FakeWorkspace(WEBHOOK)).execute(context(), config("<!channel> a & b <https://evil.test|Login>"));
        assertEquals(Map.of("text", "&lt;!channel&gt; a &amp; b &lt;https://evil.test|Login&gt;"), slack.body);
    }

    @Test
    void textLimitsAreConfigurationErrors() {
        FakeSlack slack = new FakeSlack(200, "ok");
        SlackSendMessageNodeExecutor executor = executor(slack, new FakeWorkspace(WEBHOOK));
        executor.execute(context(), config("x".repeat(4000)));
        for (Map<String, Object> bad : List.of(config("x".repeat(4001)), config("  "), config(null),
                with(config("ok"), "connectionId", "nope"))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), bad));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
        }
        assertEquals(1, slack.calls);
    }

    @Test
    void deletedWebhookIsRejectedAndReported() {
        FakeWorkspace workspace = new FakeWorkspace(WEBHOOK);
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor(new FakeSlack(404, "no_service"), workspace).execute(context(), config("hi")));
        assertEquals("AUTHENTICATION_REJECTED", failure.code());
        assertFalse(failure.retryable());
        assertEquals(1, workspace.reports);
    }

    @Test
    void statusesAreClassifiedWithoutEchoingTheResponse() {
        NodeExecutor.Failure limited = failureFor(429);
        assertEquals("HTTP_RATE_LIMITED", limited.code());
        assertTrue(limited.retryable());
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failureFor(503).code());
        assertTrue(failureFor(503).retryable());
        for (int status : new int[] {400, 403, 410}) {
            NodeExecutor.Failure bad = failureFor(status);
            assertEquals("HTTP_BUSINESS_REJECTED", bad.code(), "status " + status);
            assertFalse(bad.retryable());
            assertFalse(bad.safeMessage().contains("secret-body"));
        }
        assertEquals("HTTP_REDIRECT_REJECTED", failureFor(302).code());
    }

    @Test
    void aConnectionWithAnInvalidWebhookUrlIsRefusedBeforeAnyRequest() {
        for (String url : List.of("https://hooks.slack.com.evil.test/services/T01/B01/x",
                "http://hooks.slack.com/services/T01/B01/x", "https://hooks.slack.com/other/T01/B01/x",
                "https://hooks.slack.com/services/T01/B01/x?x=1", "https://discord.com/api/webhooks/1/x")) {
            FakeSlack slack = new FakeSlack(200, "ok");
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(slack, new FakeWorkspace(url)).execute(context(), config("hi")), url);
            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertEquals(0, slack.calls);
            assertFalse(failure.safeMessage().contains("evil"));
        }
    }

    @Test
    void realTransportRefusesAnythingButSlackWebhookUrls() {
        PinnedHttpTransport transport = new PinnedHttpTransport();
        for (String target : List.of(
                "http://hooks.slack.com/services/T01/B01/abc",
                "https://hooks.slack.com.evil.test/services/T01/B01/abc",
                "https://hooks.slack.com@evil.example.test/services/T01/B01/abc",
                "https://hooks.slack.com:8443/services/T01/B01/abc",
                "https://hooks.slack.com/services/T01/B01/abc?x=1",
                "https://hooks.slack.com/api/chat.postMessage",
                "https://hooks.slack.com/services/T01/B01/abc/../x",
                "https://127.0.0.1/services/T01/B01/abc")) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeSlackWebhook(URI.create(target), Map.of()), target);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), target);
            assertFalse(failure.retryable());
        }
    }

    @Test
    void theWebhookUrlIsNeverLogged() {
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.addAppender(appender);
        try {
            for (int status : new int[] {200, 404, 429, 500, 400}) {
                try {
                    executor(new FakeSlack(status, "x"), new FakeWorkspace(WEBHOOK)).execute(context(), config("hi"));
                } catch (NodeExecutor.Failure expected) {
                    assertFalse(expected.getMessage().contains("syntheticSecretToken"));
                }
            }
        } finally {
            root.detachAppender(appender);
        }
        assertTrue(appender.list.stream().noneMatch(event ->
                event.getFormattedMessage().contains("syntheticSecretToken")));
    }

    private static NodeExecutor.Failure failureFor(int status) {
        return assertThrows(NodeExecutor.Failure.class, () -> executor(
                new FakeSlack(status, "secret-body"), new FakeWorkspace(WEBHOOK)).execute(context(), config("hi")));
    }

    private static SlackSendMessageNodeExecutor executor(FakeSlack slack, FakeWorkspace workspace) {
        return new SlackSendMessageNodeExecutor(slack, workspace);
    }

    private static Map<String, Object> config(String text) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("text", text);
        return config;
    }

    private static Map<String, Object> with(Map<String, Object> config, String key, Object value) {
        config.put(key, value);
        return config;
    }

    private static NodeExecutor.Context context() {
        return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(), "slack", 1, "corr", null);
    }

    private static final class FakeSlack extends PinnedHttpTransport {
        private final int status;
        private final Object data;
        private int calls;
        private URI uri;
        private Object body;

        private FakeSlack(int status, Object data) {
            super();
            this.status = status;
            this.data = data;
        }

        @Override
        public HttpResponse executeSlackWebhook(URI target, Object requestBody) {
            calls++;
            uri = target;
            body = requestBody;
            return new HttpResponse(status, data, Map.of());
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private final String url;
        private int reports;

        private FakeWorkspace(String url) {
            this.url = url;
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            return new ResolvedConnection("SLACK", "TOKEN", Map.of("token", url));
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reports++;
        }
    }
}
