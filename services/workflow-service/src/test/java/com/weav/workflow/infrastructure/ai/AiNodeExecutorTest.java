package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.domain.exception.ForbiddenException;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AiNodeExecutorTest {
    private static final NodeExecutor.Context CONTEXT = new NodeExecutor.Context(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "node", 1, null, null);

    /** A port that fails the test if an executor without a connection touches Workspace. */
    static final WorkspaceConnectionPort UNUSED_PORT = new FakePort(null);
    private static final String KEY = "sk-test-secret-key";
    private static final UUID CONNECTION_ID = UUID.fromString("11111111-1111-4111-8111-111111111111");
    private static final java.util.List<String> TYPES =
            java.util.List.of("ai.extract", "ai.classify", "ai.summarize", "ai.generate");

    private static Map<String, Object> baseConfig(String type) {
        return switch (type) {
            case "ai.extract" -> Map.of("text", "t", "outputSchema", Map.of("type", "object"));
            case "ai.classify" -> Map.of("content", "c", "categories", java.util.List.of("a", "b"));
            case "ai.generate" -> Map.of("prompt", "p");
            default -> Map.of("inputText", "s");
        };
    }

    private static Map<String, Object> withConnection(String type, Object... extra) {
        Map<String, Object> config = new java.util.LinkedHashMap<>(baseConfig(type));
        config.put("connectionId", CONNECTION_ID.toString());
        for (int i = 0; i < extra.length; i += 2) {
            config.put((String) extra[i], extra[i + 1]);
        }
        return config;
    }

    @Test
    void withoutConnectionBodyIsUnchanged() {
        for (String type : TYPES) {
            StubClient client = new StubClient();
            new AiNodeExecutor(type, client, UNUSED_PORT).execute(CONTEXT, baseConfig(type));
            assertFalse(client.payload.containsKey("llm"), type);
        }
        StubClient client = new StubClient();
        new AiNodeExecutor("ai.summarize", client, UNUSED_PORT).execute(CONTEXT, Map.of("inputText", "s"));
        assertEquals(Map.of("text", "s", "maxLength", 200), client.payload);
    }

    @Test
    void withConnectionSendsLlmAndClosesTheConnection() {
        for (String type : TYPES) {
            for (String provider : java.util.List.of("OPENAI", "ANTHROPIC", "GEMINI")) {
                StubClient client = new StubClient();
                FakePort port = new FakePort(new ResolvedConnection(provider, "TOKEN", Map.of("token", KEY)));
                new AiNodeExecutor(type, client, port).execute(CONTEXT, withConnection(type, "model", "gpt-x"));
                assertEquals(Map.of("provider", provider, "apiKey", KEY, "model", "gpt-x"), client.payload.get("llm"));
                assertEquals(CONTEXT.workspaceId(), port.workspaceId);
                assertEquals(CONNECTION_ID, port.connectionId);
                assertTrue(port.closed(), "connection must be closed");
            }
        }
    }

    @Test
    void connectionWithoutModelSendsNoModel() {
        StubClient client = new StubClient();
        FakePort port = new FakePort(new ResolvedConnection("OPENAI", "TOKEN", Map.of("token", KEY)));
        new AiNodeExecutor("ai.summarize", client, port).execute(CONTEXT, withConnection("ai.summarize"));
        assertEquals(Map.of("provider", "OPENAI", "apiKey", KEY), client.payload.get("llm"));
    }

    @Test
    void rejectsAConnectionThatIsNotAnAiKey() {
        java.util.List<ResolvedConnection> wrong = java.util.List.of(
                new ResolvedConnection("DISCORD", "TOKEN", Map.of("token", KEY)),
                new ResolvedConnection("OPENAI", "API_KEY", Map.of("apiKey", KEY)),
                new ResolvedConnection("OPENAI", "OAUTH2", Map.of("accessToken", KEY)));
        for (ResolvedConnection connection : wrong) {
            StubClient client = new StubClient();
            FakePort port = new FakePort(connection);
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> new AiNodeExecutor("ai.summarize", client, port)
                            .execute(CONTEXT, withConnection("ai.summarize")));
            assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
            assertFalse(failure.retryable());
            assertNull(client.operation, "AI must not be called");
            assertTrue(port.closed());
            assertFalse(failure.safeMessage().contains(KEY));
        }
    }

    @Test
    void invalidModelAndConnectionConfigAreRejectedBeforeAnyResolve() {
        java.util.List<Map<String, Object>> bad = java.util.List.of(
                withConnection("ai.summarize", "model", "a b"),
                withConnection("ai.summarize", "model", ""),
                withConnection("ai.summarize", "model", "x".repeat(101)),
                withConnection("ai.summarize", "model", 5),
                withConnection("ai.summarize", "connectionId", "not-a-uuid"),
                withConnection("ai.summarize", "connectionId", 5),
                Map.of("inputText", "s", "model", "gpt-x"));
        for (Map<String, Object> config : bad) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> new AiNodeExecutor("ai.summarize", new StubClient(), UNUSED_PORT).execute(CONTEXT, config),
                    config.toString());
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
        }
    }

    @Test
    void acceptsModelNamesWithProviderPunctuation() {
        for (String model : java.util.List.of("gpt-4o-mini", "claude-3-5-sonnet-20241022", "gemini-1.5-pro",
                "models/gemini-pro", "llama3.1:8b", "x".repeat(100))) {
            StubClient client = new StubClient();
            FakePort port = new FakePort(new ResolvedConnection("GEMINI", "TOKEN", Map.of("token", KEY)));
            new AiNodeExecutor("ai.summarize", client, port)
                    .execute(CONTEXT, withConnection("ai.summarize", "model", model));
            assertEquals(model, ((Map<?, ?>) client.payload.get("llm")).get("model"));
        }
    }

    @Test
    void workspaceFailuresMapLikeOtherConnectionNodes() {
        FakePort forbidden = new FakePort(null);
        forbidden.error = new ForbiddenException("no");
        NodeExecutor.Failure denied = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.summarize", new StubClient(), forbidden)
                        .execute(CONTEXT, withConnection("ai.summarize")));
        assertEquals("CONNECTION_FORBIDDEN", denied.code());
        assertFalse(denied.retryable());

        FakePort down = new FakePort(null);
        down.error = new IllegalStateException("down");
        NodeExecutor.Failure unavailable = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.summarize", new StubClient(), down)
                        .execute(CONTEXT, withConnection("ai.summarize")));
        assertEquals("CONNECTION_UNAVAILABLE", unavailable.code());
        assertTrue(unavailable.retryable());
    }

    @Test
    void providerAuthRejectionIsReportedToWorkspaceAndTheConnectionIsClosed() {
        StubClient client = new StubClient();
        client.failure = new NodeExecutor.Failure("CONNECTION_AUTHENTICATION_REJECTED", "rejected", false);
        FakePort port = new FakePort(new ResolvedConnection("OPENAI", "TOKEN", Map.of("token", KEY)));
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.summarize", client, port).execute(CONTEXT, withConnection("ai.summarize")));
        assertEquals("CONNECTION_AUTHENTICATION_REJECTED", failure.code());
        assertEquals(1, port.reports);
        assertTrue(port.closed());

        // Any other failure is not an auth report.
        StubClient other = new StubClient();
        other.failure = new NodeExecutor.Failure("AI_TIMEOUT", "slow", true);
        FakePort quiet = new FakePort(new ResolvedConnection("OPENAI", "TOKEN", Map.of("token", KEY)));
        assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.summarize", other, quiet).execute(CONTEXT, withConnection("ai.summarize")));
        assertEquals(0, quiet.reports);
        assertTrue(quiet.closed());
    }

    @Test
    void extractRequiresOutputSchema() {
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> executor("ai.extract").execute(CONTEXT,
                        Map.of("text", "t", "schemaDescription", "legacy")));
        assertEquals("CONFIGURATION_ERROR", failure.code());
        assertFalse(failure.retryable());
        assertEquals("Add an output schema to this extract node.", failure.safeMessage());
    }

    @Test
    void mapsConfigToAiPayloads() {
        StubClient client = new StubClient();
        new AiNodeExecutor("ai.extract", client, UNUSED_PORT).execute(CONTEXT,
                Map.of("text", "t", "outputSchema", Map.of("type", "object"), "instructions", "i"));
        assertEquals("extract", client.operation);
        assertEquals(Map.of("text", "t", "outputSchema", Map.of("type", "object"), "instructions", "i"), client.payload);

        new AiNodeExecutor("ai.classify", client, UNUSED_PORT).execute(CONTEXT,
                Map.of("content", "c", "categories", java.util.List.of("a", "b")));
        assertEquals("classify", client.operation);
        assertEquals(Map.of("text", "c", "categories", java.util.List.of("a", "b")), client.payload);

        new AiNodeExecutor("ai.summarize", client, UNUSED_PORT).execute(CONTEXT, Map.of("inputText", "s"));
        assertEquals("summarize", client.operation);
        assertEquals(Map.of("text", "s", "maxLength", 200), client.payload);

        NodeExecutor.Failure oversized = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.summarize", client, UNUSED_PORT)
                        .execute(CONTEXT, Map.of("inputText", "s", "maxLength", 6000)));
        assertEquals("CONFIGURATION_ERROR", oversized.code());
        NodeExecutor.Failure tooFewCategories = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.classify", client, UNUSED_PORT)
                        .execute(CONTEXT, Map.of("content", "c", "categories", java.util.List.of("a"))));
        assertEquals("CONFIGURATION_ERROR", tooFewCategories.code());
    }

    @Test
    void generateMapsToThePromptOperation() {
        StubClient client = new StubClient();
        new AiNodeExecutor("ai.generate", client, UNUSED_PORT).execute(CONTEXT, Map.of("prompt", "p"));
        assertEquals("prompt", client.operation);
        assertEquals(Map.of("prompt", "p", "maxLength", 1000), client.payload);

        new AiNodeExecutor("ai.generate", client, UNUSED_PORT).execute(CONTEXT,
                Map.of("prompt", "p", "instructions", "short", "maxLength", 50));
        assertEquals(Map.of("prompt", "p", "instructions", "short", "maxLength", 50), client.payload);

        new AiNodeExecutor("ai.generate", client, UNUSED_PORT).execute(CONTEXT,
                Map.of("prompt", "p", "instructions", "  ", "maxLength", 5000));
        assertEquals(Map.of("prompt", "p", "maxLength", 5000), client.payload);
    }

    @Test
    void generateRejectsBlankPromptAndOutOfRangeMaxLength() {
        for (Map<String, Object> config : java.util.List.<Map<String, Object>>of(
                Map.of(), Map.of("prompt", "  "), Map.of("prompt", 5),
                Map.of("prompt", "p", "maxLength", 0), Map.of("prompt", "p", "maxLength", 5001),
                Map.of("prompt", "p", "maxLength", 1.5), Map.of("prompt", "p", "maxLength", "10"))) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> executor("ai.generate").execute(CONTEXT, config), config.toString());
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
        }
    }

    @Test
    void generateRejectsOversizedOrNonTextInputBeforeCallingAi() {
        String atLimit = "𝒳".repeat(50_000); // 50,000 code points, 100,000 chars
        StubClient accepted = new StubClient();
        new AiNodeExecutor("ai.generate", accepted, UNUSED_PORT).execute(CONTEXT,
                Map.of("prompt", atLimit, "instructions", "x".repeat(2_000)));
        assertEquals("prompt", accepted.operation);

        for (Map<String, Object> config : java.util.List.<Map<String, Object>>of(
                Map.of("prompt", atLimit + "x"),
                Map.of("prompt", "p", "instructions", "x".repeat(2_001)),
                Map.of("prompt", "p", "instructions", 5),
                Map.of("prompt", "p", "instructions", java.util.List.of("a")))) {
            StubClient client = new StubClient();
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> new AiNodeExecutor("ai.generate", client, UNUSED_PORT).execute(CONTEXT, config));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
            assertEquals(null, client.operation, "quota must not be spent");
        }
    }

    @Test
    void outputBecomesNodeOutput() {
        StubClient client = new StubClient();
        NodeExecutor.Result result = new AiNodeExecutor("ai.summarize", client, UNUSED_PORT)
                .execute(CONTEXT, Map.of("inputText", "s"));
        assertEquals(Map.of("summary", "ok", "truncated", false), result.output());
        assertEquals(null, result.selectedPort());
    }

    private static AiNodeExecutor executor(String type) {
        return new AiNodeExecutor(type, new StubClient(), UNUSED_PORT);
    }

    private static final class StubClient extends AiClient {
        private String operation;
        private Map<String, Object> payload;
        private NodeExecutor.Failure failure;

        @Override
        public Map<String, Object> execute(NodeExecutor.Context context, String operation, Map<String, Object> payload) {
            this.operation = operation;
            this.payload = payload;
            if (failure != null) {
                throw failure;
            }
            return Map.of("summary", "ok", "truncated", false);
        }
    }

    /** Hands out one connection (or throws {@code error}); a null connection means "must not be called". */
    static final class FakePort implements WorkspaceConnectionPort {
        private final ResolvedConnection connection;
        RuntimeException error;
        UUID workspaceId;
        UUID connectionId;
        int reports;

        FakePort(ResolvedConnection connection) {
            this.connection = connection;
        }

        boolean closed() {
            try {
                connection.auth();
                return false;
            } catch (IllegalStateException closed) {
                return true;
            }
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            if (error != null) {
                throw error;
            }
            if (connection == null) {
                throw new AssertionError("Workspace must not be called without a connection");
            }
            this.workspaceId = workspaceId;
            this.connectionId = connectionId;
            return connection;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reports++;
        }
    }
}
