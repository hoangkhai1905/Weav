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
