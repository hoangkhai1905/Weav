package com.weav.workflow.infrastructure.discord;

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

class DiscordSendMessageNodeExecutorTest {
    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID CONNECTION_ID = UUID.randomUUID();
    private static final String WEBHOOK = "https://discord.com/api/webhooks/123456789/synthetic-webhook-token_AB";

    @Test
    void postsContentWithMentionsDisabledAndTheOptionalUsername() {
        FakeDiscord discord = new FakeDiscord(204, Map.of());
        Map<String, Object> config = config("Build failed @everyone <@&123> @here");
        config.put("username", " Weav ");

        NodeExecutor.Result result = executor(discord, new FakeWorkspace(WEBHOOK)).execute(context(), config);

        assertEquals(Map.of("sent", true), result.output());
        assertEquals(WEBHOOK, discord.uri.toString());
        Map<String, Object> expected = new LinkedHashMap<>();
        expected.put("content", "Build failed @everyone <@&123> @here");
        expected.put("username", "Weav");
        expected.put("allowed_mentions", Map.of("parse", List.of()));
        assertEquals(expected, discord.body);
    }

    @Test
    void usernameIsOmittedWhenBlank() {
        FakeDiscord discord = new FakeDiscord(204, Map.of());
        Map<String, Object> config = config("hi");
        config.put("username", "  ");
        executor(discord, new FakeWorkspace(WEBHOOK)).execute(context(), config);
        assertFalse(((Map<?, ?>) discord.body).containsKey("username"));
    }

    @Test
    void contentAndUsernameLimitsAreConfigurationErrors() {
        FakeDiscord discord = new FakeDiscord(204, Map.of());
        DiscordSendMessageNodeExecutor executor = executor(discord, new FakeWorkspace(WEBHOOK));
        executor.execute(context(), config("x".repeat(2000)));
        for (Map<String, Object> bad : List.of(config("x".repeat(2001)), config("   "), config(null),
                with(config("ok"), "username", "u".repeat(81)), with(config("ok"), "connectionId", "nope"))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), bad));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
        }
        assertEquals(1, discord.calls, "only the valid 2000-character message was sent");
    }

    @Test
    void unauthorizedOrDeletedWebhookIsRejectedAndReported() {
        for (int status : new int[] {401, 404}) {
            FakeWorkspace workspace = new FakeWorkspace(WEBHOOK);
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(new FakeDiscord(status, Map.of("message", "Unknown Webhook")), workspace)
                            .execute(context(), config("hi")));
            assertEquals("AUTHENTICATION_REJECTED", failure.code());
            assertFalse(failure.retryable());
            assertEquals(1, workspace.reports, "status " + status);
        }
    }

    @Test
    void rateLimitIsRetryableAndNamesRetryAfter() {
        FakeDiscord discord = new FakeDiscord(429, Map.of("retry_after", 1.5));
        discord.headers = Map.of("Retry-After", "2.3");
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor(discord, new FakeWorkspace(WEBHOOK)).execute(context(), config("hi")));
        assertEquals("HTTP_RATE_LIMITED", failure.code());
        assertTrue(failure.retryable());
        assertTrue(failure.requestNotSent());
        assertTrue(failure.safeMessage().contains("3 s"), failure.safeMessage());
    }

    @Test
    void otherStatusesAreClassifiedWithoutEchoingTheResponse() {
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failureFor(503).code());
        assertTrue(failureFor(503).retryable());
        NodeExecutor.Failure bad = failureFor(400);
        assertEquals("HTTP_BUSINESS_REJECTED", bad.code());
        assertFalse(bad.retryable());
        assertFalse(bad.safeMessage().contains("secret-body"));
        assertEquals("HTTP_BUSINESS_REJECTED", failureFor(403).code());
        assertEquals("HTTP_REDIRECT_REJECTED", failureFor(302).code());
    }

    @Test
    void aConnectionWithAnInvalidWebhookUrlIsRefusedBeforeAnyRequest() {
        for (String url : List.of("https://discord.com.evil.test/api/webhooks/1/x", "http://discord.com/api/webhooks/1/x",
                "https://discord.com/api/webhooks/abc/x", "https://discord.com/other/1/x",
                "https://discord.com/api/webhooks/1/x?wait=true")) {
            FakeDiscord discord = new FakeDiscord(204, Map.of());
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(discord, new FakeWorkspace(url)).execute(context(), config("hi")), url);
            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertEquals(0, discord.calls);
            assertFalse(failure.safeMessage().contains("evil"));
        }
    }

    @Test
    void realTransportRefusesAnythingButDiscordWebhookUrls() {
        PinnedHttpTransport transport = new PinnedHttpTransport();
        for (String target : List.of(
                "http://discord.com/api/webhooks/1/abc",
                "https://discord.com.evil.test/api/webhooks/1/abc",
                "https://discord.com@evil.example.test/api/webhooks/1/abc",
                "https://discord.com:8443/api/webhooks/1/abc",
                "https://discord.com/api/webhooks/1/abc?wait=true",
                "https://discord.com/api/v10/users/@me",
                "https://discord.com/api/webhooks/1/abc/../x",
                "https://127.0.0.1/api/webhooks/1/abc")) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeDiscordWebhook(URI.create(target), Map.of()), target);
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
            for (int status : new int[] {204, 401, 429, 500, 400}) {
                try {
                    executor(new FakeDiscord(status, Map.of()), new FakeWorkspace(WEBHOOK)).execute(context(), config("hi"));
                } catch (NodeExecutor.Failure expected) {
                    assertFalse(expected.getMessage().contains("synthetic-webhook-token"));
                }
            }
        } finally {
            root.detachAppender(appender);
        }
        assertTrue(appender.list.stream().noneMatch(event ->
                event.getFormattedMessage().contains("synthetic-webhook-token")));
    }

    private static NodeExecutor.Failure failureFor(int status) {
        return assertThrows(NodeExecutor.Failure.class, () -> executor(
                new FakeDiscord(status, Map.of("message", "secret-body")), new FakeWorkspace(WEBHOOK))
                .execute(context(), config("hi")));
    }

    private static DiscordSendMessageNodeExecutor executor(FakeDiscord discord, FakeWorkspace workspace) {
        return new DiscordSendMessageNodeExecutor(discord, workspace);
    }

    private static Map<String, Object> config(String content) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("content", content);
        return config;
    }

    private static Map<String, Object> with(Map<String, Object> config, String key, Object value) {
        config.put(key, value);
        return config;
    }

    private static NodeExecutor.Context context() {
        return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(), "discord", 1, "corr", null);
    }

    private static final class FakeDiscord extends PinnedHttpTransport {
        private final int status;
        private final Object data;
        private Map<String, String> headers = Map.of();
        private int calls;
        private URI uri;
        private Object body;

        private FakeDiscord(int status, Object data) {
            super();
            this.status = status;
            this.data = data;
        }

        @Override
        public HttpResponse executeDiscordWebhook(URI target, Object requestBody) {
            calls++;
            uri = target;
            body = requestBody;
            return new HttpResponse(status, data, headers);
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
            return new ResolvedConnection("DISCORD", "TOKEN", Map.of("token", url));
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reports++;
        }
    }
}
