package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AiNodeExecutorTest {
    private static final NodeExecutor.Context CONTEXT = new NodeExecutor.Context(
            UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "node", 1, null, null);

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
        new AiNodeExecutor("ai.extract", client).execute(CONTEXT,
                Map.of("text", "t", "outputSchema", Map.of("type", "object"), "instructions", "i"));
        assertEquals("extract", client.operation);
        assertEquals(Map.of("text", "t", "outputSchema", Map.of("type", "object"), "instructions", "i"), client.payload);

        new AiNodeExecutor("ai.classify", client).execute(CONTEXT,
                Map.of("content", "c", "categories", java.util.List.of("a", "b")));
        assertEquals("classify", client.operation);
        assertEquals(Map.of("text", "c", "categories", java.util.List.of("a", "b")), client.payload);

        new AiNodeExecutor("ai.summarize", client).execute(CONTEXT, Map.of("inputText", "s"));
        assertEquals("summarize", client.operation);
        assertEquals(Map.of("text", "s", "maxLength", 200), client.payload);

        NodeExecutor.Failure oversized = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.summarize", client)
                        .execute(CONTEXT, Map.of("inputText", "s", "maxLength", 6000)));
        assertEquals("CONFIGURATION_ERROR", oversized.code());
        NodeExecutor.Failure tooFewCategories = assertThrows(NodeExecutor.Failure.class,
                () -> new AiNodeExecutor("ai.classify", client)
                        .execute(CONTEXT, Map.of("content", "c", "categories", java.util.List.of("a"))));
        assertEquals("CONFIGURATION_ERROR", tooFewCategories.code());
    }

    @Test
    void generateMapsToThePromptOperation() {
        StubClient client = new StubClient();
        new AiNodeExecutor("ai.generate", client).execute(CONTEXT, Map.of("prompt", "p"));
        assertEquals("prompt", client.operation);
        assertEquals(Map.of("prompt", "p", "maxLength", 1000), client.payload);

        new AiNodeExecutor("ai.generate", client).execute(CONTEXT,
                Map.of("prompt", "p", "instructions", "short", "maxLength", 50));
        assertEquals(Map.of("prompt", "p", "instructions", "short", "maxLength", 50), client.payload);

        new AiNodeExecutor("ai.generate", client).execute(CONTEXT,
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
        new AiNodeExecutor("ai.generate", accepted).execute(CONTEXT,
                Map.of("prompt", atLimit, "instructions", "x".repeat(2_000)));
        assertEquals("prompt", accepted.operation);

        for (Map<String, Object> config : java.util.List.<Map<String, Object>>of(
                Map.of("prompt", atLimit + "x"),
                Map.of("prompt", "p", "instructions", "x".repeat(2_001)),
                Map.of("prompt", "p", "instructions", 5),
                Map.of("prompt", "p", "instructions", java.util.List.of("a")))) {
            StubClient client = new StubClient();
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> new AiNodeExecutor("ai.generate", client).execute(CONTEXT, config));
            assertEquals("CONFIGURATION_ERROR", failure.code());
            assertFalse(failure.retryable());
            assertEquals(null, client.operation, "quota must not be spent");
        }
    }

    @Test
    void outputBecomesNodeOutput() {
        StubClient client = new StubClient();
        NodeExecutor.Result result = new AiNodeExecutor("ai.summarize", client)
                .execute(CONTEXT, Map.of("inputText", "s"));
        assertEquals(Map.of("summary", "ok", "truncated", false), result.output());
        assertEquals(null, result.selectedPort());
    }

    private static AiNodeExecutor executor(String type) {
        return new AiNodeExecutor(type, new StubClient());
    }

    private static final class StubClient extends AiClient {
        private String operation;
        private Map<String, Object> payload;

        @Override
        public Map<String, Object> execute(NodeExecutor.Context context, String operation, Map<String, Object> payload) {
            this.operation = operation;
            this.payload = payload;
            return Map.of("summary", "ok", "truncated", false);
        }
    }
}
