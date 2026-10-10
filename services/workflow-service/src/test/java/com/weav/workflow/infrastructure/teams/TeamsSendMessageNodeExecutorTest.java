package com.weav.workflow.infrastructure.teams;

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

class TeamsSendMessageNodeExecutorTest {
    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID CONNECTION_ID = UUID.randomUUID();
    private static final String WEBHOOK =
            "https://prod-12.westus.logic.azure.com:443/workflows/abc123/triggers/manual/paths/invoke"
                    + "?api-version=2016-06-01&sp=%2Ftriggers%2Fmanual%2Frun&sig=syntheticSecretSig";

    @SuppressWarnings("unchecked")
    @Test
    void postsAnAdaptiveCardWithAnOptionalBoldTitle() {
        FakeTeams teams = new FakeTeams(202);
        Map<String, Object> config = config("Build failed");
        config.put("title", " Alert ");
        NodeExecutor.Result result = executor(teams, new FakeWorkspace(WEBHOOK)).execute(context(), config);

        assertEquals(Map.of("sent", true), result.output());
        assertEquals(WEBHOOK, teams.uri.toString());
        Map<String, Object> body = (Map<String, Object>) teams.body;
        assertEquals("message", body.get("type"));
        Map<String, Object> attachment = ((List<Map<String, Object>>) body.get("attachments")).get(0);
        assertEquals("application/vnd.microsoft.card.adaptive", attachment.get("contentType"));
        assertTrue(attachment.containsKey("contentUrl") && attachment.get("contentUrl") == null);
        Map<String, Object> card = (Map<String, Object>) attachment.get("content");
        assertEquals("AdaptiveCard", card.get("type"));
        assertEquals("1.4", card.get("version"));
        assertEquals("http://adaptivecards.io/schemas/adaptive-card.json", card.get("$schema"));
        List<Map<String, Object>> blocks = (List<Map<String, Object>>) card.get("body");
        assertEquals(2, blocks.size());
        assertEquals("Alert", blocks.get(0).get("text"));
        assertEquals("Bolder", blocks.get(0).get("weight"));
        assertEquals(true, blocks.get(0).get("wrap"));
        assertEquals("Build failed", blocks.get(1).get("text"));
        assertEquals("TextBlock", blocks.get(1).get("type"));
        assertEquals(true, blocks.get(1).get("wrap"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void withoutATitleThereIsOnlyTheTextBlock() {
        FakeTeams teams = new FakeTeams(200);
        executor(teams, new FakeWorkspace(WEBHOOK)).execute(context(), config("hi"));
        Map<String, Object> attachment = ((List<Map<String, Object>>) ((Map<String, Object>) teams.body).get("attachments")).get(0);
        assertEquals(1, ((List<?>) ((Map<String, Object>) attachment.get("content")).get("body")).size());
    }

    @Test
    void textAndTitleLimitsAreConfigurationErrors() {
        FakeTeams teams = new FakeTeams(202);
        TeamsSendMessageNodeExecutor executor = executor(teams, new FakeWorkspace(WEBHOOK));
        executor.execute(context(), config("x".repeat(4000)));
        for (Map<String, Object> bad : List.of(config("x".repeat(4001)), config("  "), config(null),
                with(config("ok"), "title", "t".repeat(201)), with(config("ok"), "connectionId", "nope"))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), bad));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
        }
        assertEquals(1, teams.calls);
    }

    @Test
    void anyTwoHundredSeriesIsSuccessAndFailuresAreClassified() {
        for (int status : new int[] {200, 202}) {
            assertEquals(Map.of("sent", true), executor(new FakeTeams(status), new FakeWorkspace(WEBHOOK))
                    .execute(context(), config("hi")).output());
        }
        FakeWorkspace workspace = new FakeWorkspace(WEBHOOK);
        NodeExecutor.Failure rejected = assertThrows(NodeExecutor.Failure.class,
                () -> executor(new FakeTeams(401), workspace).execute(context(), config("hi")));
        assertEquals("AUTHENTICATION_REJECTED", rejected.code());
        assertEquals(1, workspace.reports);
        assertEquals("HTTP_RATE_LIMITED", failureFor(429).code());
        assertTrue(failureFor(429).retryable());
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", failureFor(502).code());
        assertTrue(failureFor(502).retryable());
        NodeExecutor.Failure bad = failureFor(400);
        assertEquals("HTTP_BUSINESS_REJECTED", bad.code());
        assertFalse(bad.retryable());
        assertEquals("HTTP_REDIRECT_REJECTED", failureFor(302).code());
    }

    @Test
    void aConnectionWithAnInvalidWebhookUrlIsRefusedBeforeAnyRequest() {
        for (String url : List.of(
                "http://prod-12.westus.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=x",
                "https://prod-12.westus.logic.azure.com.evil.test/workflows/a/triggers/manual/paths/invoke?sig=x",
                "https://evillogic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=x",
                "https://x.logic.azure.com:8443/workflows/a/triggers/manual/paths/invoke?sig=x",
                "https://x.logic.azure.com/workflows/a/triggers/manual/paths/invoke",
                "https://x.logic.azure.com/other/a/triggers/manual/paths/invoke?sig=x",
                "https://outlook.office.com/webhook/a/IncomingWebhook/b/c")) {
            FakeTeams teams = new FakeTeams(202);
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor(teams, new FakeWorkspace(url)).execute(context(), config("hi")), url);
            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertEquals(0, teams.calls);
            assertFalse(failure.safeMessage().contains("evil"));
        }
    }

    @Test
    void realTransportRefusesAnythingButWorkflowsWebhookUrls() {
        PinnedHttpTransport transport = new PinnedHttpTransport();
        for (String target : List.of(
                "http://x.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=s",
                "https://x.logic.azure.com.evil.test/workflows/a/triggers/manual/paths/invoke?sig=s",
                "https://logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=s",
                "https://x.logic.azure.com@evil.example.test/workflows/a/triggers/manual/paths/invoke?sig=s",
                "https://x.logic.azure.com:8443/workflows/a/triggers/manual/paths/invoke?sig=s",
                "https://x.logic.azure.com/workflows/a/triggers/manual/paths/invoke",
                "https://x.logic.azure.com/workflows/a/triggers/manual/paths/invoke?sig=s#f",
                "https://x.logic.azure.com/workflows/../triggers/manual/paths/invoke?sig=s",
                "https://127.0.0.1/workflows/a/triggers/manual/paths/invoke?sig=s")) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> transport.executeTeamsWebhook(URI.create(target), Map.of()), target);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), target);
            assertFalse(failure.retryable());
        }
    }

    @Test
    void theWebhookUrlAndSignatureAreNeverLogged() {
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
        root.addAppender(appender);
        try {
            for (int status : new int[] {202, 401, 429, 500, 400}) {
                try {
                    executor(new FakeTeams(status), new FakeWorkspace(WEBHOOK)).execute(context(), config("hi"));
                } catch (NodeExecutor.Failure expected) {
                    assertFalse(expected.getMessage().contains("syntheticSecretSig"));
                }
            }
        } finally {
            root.detachAppender(appender);
        }
        assertTrue(appender.list.stream().noneMatch(event ->
                event.getFormattedMessage().contains("syntheticSecretSig")));
    }

    private static NodeExecutor.Failure failureFor(int status) {
        return assertThrows(NodeExecutor.Failure.class, () -> executor(
                new FakeTeams(status), new FakeWorkspace(WEBHOOK)).execute(context(), config("hi")));
    }

    private static TeamsSendMessageNodeExecutor executor(FakeTeams teams, FakeWorkspace workspace) {
        return new TeamsSendMessageNodeExecutor(teams, workspace);
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
        return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(), "teams", 1, "corr", null);
    }

    private static final class FakeTeams extends PinnedHttpTransport {
        private final int status;
        private int calls;
        private URI uri;
        private Object body;

        private FakeTeams(int status) {
            super();
            this.status = status;
        }

        @Override
        public HttpResponse executeTeamsWebhook(URI target, Object requestBody) {
            calls++;
            uri = target;
            body = requestBody;
            return new HttpResponse(status, Map.of(), Map.of());
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
            return new ResolvedConnection("TEAMS", "TOKEN", Map.of("token", url));
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reports++;
        }
    }
}
