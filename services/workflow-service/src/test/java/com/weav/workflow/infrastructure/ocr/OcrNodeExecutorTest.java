package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.time.Duration;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class OcrNodeExecutorTest {

    @Test
    void buildsTypedSourceAndUsesTheContractDefaults() {
        OcrClientProperties properties = properties();
        CapturingOcrClient client = new CapturingOcrClient(properties);
        OcrNodeExecutor executor = new OcrNodeExecutor(client);

        NodeExecutor.Result result = executor.execute(context(), Map.of(
                "fileUrl", "https://approved.example/document.pdf"));

        assertEquals("ocr.extract", executor.type());
        assertEquals(Map.of(
                "source", Map.of("type", "url", "fileUrl", "https://approved.example/document.pdf"),
                "language", "vi+en",
                "detectTables", true), client.request);
        assertEquals(Map.of("schemaVersion", "1.0"), result.output());
    }

    @Test
    void rejectsAmbiguousOrInvalidSourceConfigurationBeforeCallingClient() {
        CapturingOcrClient client = new CapturingOcrClient(properties());
        OcrNodeExecutor executor = new OcrNodeExecutor(client);

        NodeExecutor.Failure bothSources = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of(
                        "artifactId", "00000000-0000-0000-0000-000000000004",
                        "fileUrl", "https://approved.example/document.pdf")));
        NodeExecutor.Failure invalidArtifact = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of("artifactId", "not-a-uuid")));

        assertEquals("CONFIGURATION_ERROR", bothSources.code());
        assertEquals("CONFIGURATION_ERROR", invalidArtifact.code());
        assertEquals(0, client.calls);
    }

    @Test
    void preservesValidatedArtifactIdAndExplicitOptions() {
        CapturingOcrClient client = new CapturingOcrClient(properties());
        OcrNodeExecutor executor = new OcrNodeExecutor(client);
        String artifactId = "00000000-0000-0000-0000-000000000004";

        executor.execute(context(), Map.of(
                "artifactId", artifactId,
                "language", "en",
                "detectTables", false));

        assertEquals(Map.of(
                "source", Map.of("type", "artifact", "artifactId", artifactId),
                "language", "en",
                "detectTables", false), client.request);
    }

    private NodeExecutor.Context context() {
        return new NodeExecutor.Context(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "ocr-node", 1, null, null);
    }

    private OcrClientProperties properties() {
        return new OcrClientProperties(false, false, false, false, false, false,
                URI.create("http://ocr.internal"), "", "", Duration.ofSeconds(5),
                Duration.ofSeconds(30), Duration.ofSeconds(60), 1_048_576);
    }

    private static final class CapturingOcrClient extends OcrClient {
        private Map<String, Object> request;
        private int calls;

        private CapturingOcrClient(OcrClientProperties properties) {
            super(properties,
                    new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader()),
                    RestClient.builder().build(), new ObjectMapper());
        }

        @Override
        public Map<String, Object> extract(NodeExecutor.Context context, Map<String, Object> value) {
            calls++;
            request = value;
            return Map.of("schemaVersion", "1.0");
        }
    }
}
