package com.weav.workflow.infrastructure.ocr;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.infrastructure.files.InMemoryFileStore;
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

    private final InMemoryFileStore files = new InMemoryFileStore();

    @Test
    void buildsTypedSourceAndUsesTheContractDefaults() {
        OcrClientProperties properties = properties();
        CapturingOcrClient client = new CapturingOcrClient(properties);
        OcrNodeExecutor executor = new OcrNodeExecutor(client, files);

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
        OcrNodeExecutor executor = new OcrNodeExecutor(client, files);

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
        OcrNodeExecutor executor = new OcrNodeExecutor(client, files);
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

    @Test
    void readsAFileReferenceFromTheWorkspaceStoreAndSendsItAsAnUpload() {
        CapturingOcrClient client = new CapturingOcrClient(properties());
        OcrNodeExecutor executor = new OcrNodeExecutor(client, files);
        NodeExecutor.Context context = context();
        files.put("file-1", "scan.pdf", "application/pdf", new byte[] {1, 2, 3});

        NodeExecutor.Result byObject = executor.execute(context, Map.of(
                "file", Map.of("fileId", "file-1", "filename", "ignored.txt"), "language", "en", "detectTables", false));
        executor.execute(context, Map.of("file", "file-1"));

        assertEquals(Map.of("schemaVersion", "1.0"), byObject.output());
        assertEquals(context.workspaceId(), files.lastWorkspace);
        assertEquals(2, client.fileCalls);
        assertEquals("scan.pdf", client.filename);
        assertEquals("application/pdf", client.mimeType);
        assertEquals(3, client.bytes.length);
        assertEquals("vi+en", client.language);
        assertEquals(0, client.calls);
    }

    @Test
    void fileSourceFailsClosedForBadReferencesMissingFilesAndOversizedFiles() {
        CapturingOcrClient client = new CapturingOcrClient(properties());
        OcrNodeExecutor executor = new OcrNodeExecutor(client, files);
        files.put("big", "big.pdf", "application/pdf", new byte[OcrNodeExecutor.MAX_FILE_BYTES + 1]);

        for (Object bad : new Object[] {Map.of(), Map.of("fileId", 5), " ", 42, Map.of("filename", "x.pdf")}) {
            assertEquals("CONFIGURATION_ERROR", assertThrows(NodeExecutor.Failure.class,
                    () -> executor.execute(context(), Map.of("file", bad))).code());
        }
        assertEquals("CONFIGURATION_ERROR", assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of("file", "x", "fileUrl", "https://a.example/d.pdf"))).code());
        assertEquals("CONFIGURATION_ERROR", assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of("file", "x", "language", "fr"))).code());
        assertEquals("FILE_NOT_FOUND", assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of("file", "missing"))).code());
        NodeExecutor.Failure tooLarge = assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of("file", "big")));
        assertEquals("FILE_TOO_LARGE", tooLarge.code());
        assertEquals(false, tooLarge.retryable());
        files.configured = false;
        assertEquals("DEPENDENCY_NOT_CONFIGURED", assertThrows(NodeExecutor.Failure.class,
                () -> executor.execute(context(), Map.of("file", "x"))).code());
        assertEquals(0, client.fileCalls);
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
        private int fileCalls;
        private String filename;
        private String mimeType;
        private byte[] bytes;
        private String language;

        private CapturingOcrClient(OcrClientProperties properties) {
            super(properties,
                    new WorkflowServiceJwtIssuer(properties, new DefaultResourceLoader()),
                    RestClient.builder().build(), new ObjectMapper());
        }

        @Override
        public Map<String, Object> extractFile(NodeExecutor.Context context, String filename, String mimeType,
                                               byte[] bytes, String language, boolean detectTables) {
            fileCalls++;
            this.filename = filename;
            this.mimeType = mimeType;
            this.bytes = bytes;
            this.language = language;
            return Map.of("schemaVersion", "1.0");
        }

        @Override
        public Map<String, Object> extract(NodeExecutor.Context context, Map<String, Object> value) {
            calls++;
            request = value;
            return Map.of("schemaVersion", "1.0");
        }
    }
}
