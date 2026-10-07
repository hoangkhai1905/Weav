package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** google.drive upload of a stored file ({@code file}) against a fake store and Google transport. */
class GoogleDriveFileUploadTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");
    private static ResolvedConnection resolved() {
        return
                new ResolvedConnection("GOOGLE_DRIVE", "OAUTH2", Map.of("accessToken", "synthetic-drive-token"));
    }

    private static final class Store implements WorkflowFileStore {
        UUID readWorkspace;
        String readFileId;
        byte[] bytes = "hello".getBytes(StandardCharsets.UTF_8);
        NodeExecutor.Failure failure;

        public boolean configured() {
            return true;
        }

        public FileReference store(UUID workspaceId, UUID executionId, String filename, String mimeType, byte[] data) {
            throw new UnsupportedOperationException();
        }

        public StoredFile read(UUID workspaceId, String fileId) {
            readWorkspace = workspaceId;
            readFileId = fileId;
            if (failure != null) {
                throw failure;
            }
            return new StoredFile(new FileReference(fileId, "report.pdf", "application/pdf", bytes.length), bytes);
        }

        public int purgeExpired(int limit) {
            return 0;
        }
    }

    private static final class Transport extends PinnedHttpTransport {
        boolean fiveArg;
        int cap = -1;
        Object body;

        @Override
        public HttpResponse executeGoogleApiWithBearerToken(URI uri, String method, Object query, Object body,
                                                            String accessToken) {
            fiveArg = true;
            this.body = body;
            return new HttpResponse(200, Map.of("id", "f1", "name", "x"), Map.of());
        }

        @Override
        public HttpResponse executeGoogleApiWithBearerToken(URI uri, String method, Object query, Object body,
                                                            String accessToken, int uploadMaxRequestBytes) {
            cap = uploadMaxRequestBytes;
            this.body = body;
            return new HttpResponse(200, Map.of("id", "f1", "name", "x"), Map.of());
        }
    }

    private final Store store = new Store();
    private final Transport transport = new Transport();

    private NodeExecutor.Result run(Map<String, Object> overrides) {
        WorkspaceConnectionPort workspace = new WorkspaceConnectionPort() {
            @Override
            public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
            }

            @Override
            public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
                return resolved();
            }

            @Override
            public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            }
        };
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("operation", "upload");
        config.putAll(overrides);
        return new GoogleDriveNodeExecutor(new GoogleApiClient(transport), workspace, store).execute(
                new NodeExecutor.Context(WORKSPACE_ID, UUID.randomUUID(), UUID.randomUUID(), "n", 1, "c", null),
                config);
    }

    private static Map<String, Object> ref() {
        return Map.of("fileId", "file-1", "filename", "ignored.pdf", "mimeType", "x/y", "size", 5);
    }

    @Test
    void uploadsAStoredFileOfThisWorkspaceWithItsNameAndMimeTypeAndTheLargerCap() {
        NodeExecutor.Result result = run(Map.of("file", ref()));

        assertEquals(WORKSPACE_ID, store.readWorkspace);
        assertEquals("file-1", store.readFileId);
        assertEquals("f1", result.output().get("id"));
        assertEquals(5 * 1024 * 1024 + 64 * 1024, transport.cap);
        assertFalse(transport.fiveArg);
        PinnedHttpTransport.RawBody body = assertInstanceOf(PinnedHttpTransport.RawBody.class, transport.body);
        String text = new String(body.bytes(), StandardCharsets.UTF_8);
        assertTrue(text.contains("{\"name\":\"report.pdf\",\"mimeType\":\"application/pdf\"}"), text);
        assertTrue(text.contains("\r\nContent-Type: application/pdf\r\n\r\nhello\r\n--"));
    }

    @Test
    void nameAndMimeTypeOverrideTheStoredOnes() {
        run(Map.of("file", ref(), "name", "mine.bin", "mimeType", "application/zip"));

        String text = new String(((PinnedHttpTransport.RawBody) transport.body).bytes(), StandardCharsets.UTF_8);
        assertTrue(text.contains("{\"name\":\"mine.bin\",\"mimeType\":\"application/zip\"}"), text);
    }

    @Test
    void aMissingOrUnconfiguredFileIsANonRetryableFailureBeforeAnyGoogleCall() {
        for (String code : new String[]{"FILE_NOT_FOUND", "DEPENDENCY_NOT_CONFIGURED"}) {
            store.failure = new NodeExecutor.Failure(code, "x", false);
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> run(Map.of("file", ref())));
            assertEquals(code, failure.code());
            assertFalse(failure.retryable());
        }
        assertEquals(-1, transport.cap);
        assertFalse(transport.fiveArg);
    }

    @Test
    void aFileOverFiveMebibytesIsRejectedWithoutAnUpload() {
        store.bytes = new byte[5 * 1024 * 1024 + 1];

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> run(Map.of("file", ref())));

        assertEquals("FILE_TOO_LARGE", failure.code());
        assertFalse(failure.retryable());
        assertEquals(-1, transport.cap);

        store.bytes = new byte[5 * 1024 * 1024];
        run(Map.of("file", ref()));
        assertTrue(transport.cap > 5 * 1024 * 1024);
    }

    @Test
    void contentAndFileTogetherOrNeitherAreConfigurationErrorsAndABadReferenceToo() {
        for (Map<String, Object> bad : java.util.List.<Map<String, Object>>of(
                Map.of("name", "a.txt", "content", "x", "file", ref()),
                Map.of("file", "file-1"),
                Map.of("file", Map.of("fileId", 5)),
                Map.of("file", Map.of("filename", "a"))) ) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class, () -> run(bad), bad.toString());
            assertEquals("CONFIGURATION_ERROR", failure.code());
        }
        assertEquals(null, store.readFileId);
    }

    @Test
    void uploadWithNameAndNoContentUploadsAnEmptyFileAsBefore() {
        run(Map.of("name", "empty.txt"));

        assertTrue(transport.fiveArg);
        String text = new String(((PinnedHttpTransport.RawBody) transport.body).bytes(), StandardCharsets.UTF_8);
        assertTrue(text.contains("\r\nContent-Type: text/plain\r\n\r\n\r\n--"), text);
        assertEquals(null, store.readFileId);

        run(Map.of("name", "n.txt", "content", "", "file", ref())); // blank content next to a file means unset
        assertEquals("file-1", store.readFileId);
    }

    @Test
    void contentUploadsKeepTheDefaultCapPath() {
        run(Map.of("name", "a.txt", "content", "hi"));

        assertTrue(transport.fiveArg);
        assertEquals(-1, transport.cap);
        assertEquals(null, store.readFileId);
    }
}
