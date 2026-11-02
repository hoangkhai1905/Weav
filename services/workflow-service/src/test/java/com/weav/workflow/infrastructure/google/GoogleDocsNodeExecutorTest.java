package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** google.docs executor against a fake Google transport (no network). */
class GoogleDocsNodeExecutorTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static final String TOKEN = "synthetic-docs-token";
    private static final String DOC_ID = "doc1234567";
    private static final String VIEW_URL = "https://docs.google.com/document/d/doc1234567/edit";

    @Test
    void createUploadsTextThatGoogleConvertsToADoc() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("id", DOC_ID, "name", "Notes", "webViewLink", VIEW_URL));

        NodeExecutor.Result result = f.docs().execute(f.context(), config("create", Map.of(
                "title", "Notes", "content", "Hello Weav")));

        assertEquals("https://www.googleapis.com/upload/drive/v3/files", f.transport.uri.toString());
        assertEquals("POST", f.transport.method);
        assertEquals(Map.of("uploadType", "multipart", "fields", "id,name,webViewLink"), f.transport.query);
        assertEquals(TOKEN, f.transport.accessToken);
        String body = rawText(f.transport.body);
        assertTrue(body.contains("\"mimeType\":\"application/vnd.google-apps.document\""), body);
        assertTrue(body.contains("\"name\":\"Notes\""), body);
        assertTrue(body.contains("Content-Type: text/plain; charset=UTF-8"), body);
        assertTrue(body.contains("Hello Weav"), body);
        assertEquals(Map.of("documentId", DOC_ID, "title", "Notes", "url", VIEW_URL), result.output());
        assertFalse(result.output().toString().contains(TOKEN));
    }

    @Test
    void createPutsTheDocInTheFolder() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("id", DOC_ID, "name", "Notes", "webViewLink", VIEW_URL));

        f.docs().execute(f.context(), config("create", Map.of("title", "Notes", "folderId", "folder123")));

        assertTrue(rawText(f.transport.body).contains("\"parents\":[\"folder123\"]"));
    }

    @Test
    void createWithoutContentMakesAnEmptyDoc() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("id", DOC_ID, "name", "Notes", "webViewLink", VIEW_URL));

        f.docs().execute(f.context(), config("create", Map.of("title", "Notes")));

        assertTrue(f.transport.called);
        assertTrue(rawText(f.transport.body).contains("Content-Type: text/plain; charset=UTF-8\r\n\r\n\r\n--weav-"));
    }

    @Test
    void createRejectsContentOverTheUtf8ByteLimit() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> f.docs().execute(
                f.context(), config("create", Map.of("title", "Notes", "content", "ệ".repeat(180_000)))));

        assertEquals("CONFIGURATION_ERROR", failure.code());
        assertFalse(f.transport.called);
    }

    @Test
    void appendInsertsTheTextOnANewParagraphAtTheEnd() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("documentId", DOC_ID));

        NodeExecutor.Result result = f.docs().execute(f.context(), config("append", Map.of(
                "documentId", DOC_ID, "content", "Line")));

        assertEquals("https://docs.googleapis.com/v1/documents/doc1234567:batchUpdate", f.transport.uri.toString());
        assertEquals(TOKEN, f.transport.accessToken);
        assertEquals(Map.of("requests", List.of(Map.of("insertText",
                Map.of("endOfSegmentLocation", Map.of(), "text", "\nLine")))), f.transport.body);
        assertEquals(Map.of("documentId", DOC_ID, "url", VIEW_URL, "appendedCharacters", 4), result.output());
        assertFalse(result.output().toString().contains(TOKEN));
    }

    @Test
    void appendKeepsUnicodeTextAsIs() {
        Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of("documentId", DOC_ID));
        String text = "Hóa đơn 🧾";

        f.docs().execute(f.context(), config("append", Map.of("documentId", DOC_ID, "content", text)));

        Map<?, ?> insert = (Map<?, ?>) ((Map<?, ?>) ((List<?>) ((Map<?, ?>) f.transport.body).get("requests")).get(0))
                .get("insertText");
        assertEquals("\n" + text, insert.get("text"));
    }

    @Test
    void rejectsBadConfigBeforeAnyRequest() {
        List<Map<String, Object>> invalid = List.of(
                config("delete", Map.of()),
                config("create", Map.of()),
                config("create", Map.of("title", "a\nb")),
                config("create", Map.of("title", "Notes", "content", 42)),
                config("append", Map.of("documentId", "../x", "content", "x")),
                config("append", Map.of("documentId", "a/bcdefghijk", "content", "x")),
                config("append", Map.of("documentId", "abcdefghij:batchUpdate?x", "content", "x")),
                config("append", Map.of("documentId", "short", "content", "x")),
                config("append", Map.of("documentId", DOC_ID, "content", " ")),
                config("append", Map.of("documentId", DOC_ID, "content", 42)),
                config("append", Map.of("documentId", DOC_ID, "content", Map.of())));
        for (Map<String, Object> config : invalid) {
            Fixture f = new Fixture("GOOGLE_DRIVE", 200, Map.of());
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> f.docs().execute(f.context(), config), config.toString());
            assertEquals("CONFIGURATION_ERROR", failure.code(), config.toString());
            assertFalse(f.transport.called, config.toString());
        }
    }

    @Test
    void rejectsAConnectionOfAnotherProvider() {
        Fixture f = new Fixture("GOOGLE_SHEETS", 200, Map.of());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> f.docs().execute(
                f.context(), config("append", Map.of("documentId", DOC_ID, "content", "x"))));

        assertEquals("CONNECTION_CONFIGURATION_INVALID", failure.code());
        assertFalse(f.transport.called);
        assertFalse(failure.safeMessage().contains(TOKEN));
    }

    @Test
    void mapsDocsStatusesLikeTheOtherGoogleNodes() {
        Map<String, Object> append = config("append", Map.of("documentId", DOC_ID, "content", "x"));

        Fixture rejected = new Fixture("GOOGLE_DRIVE", 401, Map.of());
        assertEquals("AUTHENTICATION_REJECTED", assertThrows(NodeExecutor.Failure.class,
                () -> rejected.docs().execute(rejected.context(), append)).code());
        assertEquals(1, rejected.workspace.reportCalls);

        Fixture missing = new Fixture("GOOGLE_DRIVE", 404, Map.of());
        NodeExecutor.Failure notFound = assertThrows(NodeExecutor.Failure.class,
                () -> missing.docs().execute(missing.context(), append));
        assertEquals("HTTP_BUSINESS_REJECTED", notFound.code());
        assertFalse(notFound.retryable());

        Fixture down = new Fixture("GOOGLE_DRIVE", 503, Map.of());
        NodeExecutor.Failure unavailable = assertThrows(NodeExecutor.Failure.class,
                () -> down.docs().execute(down.context(), append));
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", unavailable.code());
        assertTrue(unavailable.retryable());
    }

    private static String rawText(Object body) {
        return new String(assertInstanceOf(PinnedHttpTransport.RawBody.class, body).bytes(), StandardCharsets.UTF_8);
    }

    private static Map<String, Object> config(String operation, Map<String, Object> fields) {
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("operation", operation);
        config.putAll(fields);
        return config;
    }

    private static final class Fixture {
        private final RecordingTransport transport;
        private final FakeWorkspace workspace;

        private Fixture(String provider, int status, Object data) {
            this.transport = new RecordingTransport(new PinnedHttpTransport.HttpResponse(status, data, Map.of()));
            this.workspace = new FakeWorkspace(new ResolvedConnection(provider, "OAUTH2", Map.of("accessToken", TOKEN)));
        }

        private GoogleDocsNodeExecutor docs() {
            return new GoogleDocsNodeExecutor(new GoogleApiClient(transport), workspace);
        }

        private NodeExecutor.Context context() {
            return new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(),
                    "docs-node", 1, "correlation-id", null);
        }
    }

    private static final class RecordingTransport extends PinnedHttpTransport {
        private final HttpResponse response;
        private boolean called;
        private URI uri;
        private String method;
        private Object query;
        private Object body;
        private String accessToken;

        private RecordingTransport(HttpResponse response) {
            super();
            this.response = response;
        }

        @Override
        public HttpResponse executeGoogleApiWithBearerToken(
                URI target, String method, Object query, Object body, String accessToken) {
            this.called = true;
            this.uri = target;
            this.method = method;
            this.query = query;
            this.body = body;
            this.accessToken = accessToken;
            return response;
        }

        @Override
        public HttpResponse executeGoogleDocsWithBearerToken(URI target, Object body, String accessToken) {
            this.called = true;
            this.uri = target;
            this.method = "POST";
            this.body = body;
            this.accessToken = accessToken;
            return response;
        }
    }

    private static final class FakeWorkspace implements WorkspaceConnectionPort {
        private final ResolvedConnection resolved;
        private int reportCalls;

        private FakeWorkspace(ResolvedConnection resolved) {
            this.resolved = resolved;
        }

        @Override
        public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
        }

        @Override
        public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
            return resolved;
        }

        @Override
        public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            reportCalls++;
        }
    }
}
