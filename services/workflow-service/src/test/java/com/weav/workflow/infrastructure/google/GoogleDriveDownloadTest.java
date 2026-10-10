package com.weav.workflow.infrastructure.google;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.infrastructure.files.InMemoryFileStore;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** google.drive {@code download}: metadata, bounded content, file store, and the failure cases. */
class GoogleDriveDownloadTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("c77f6cef-78ca-4840-910d-ed8ce8c519b2");
    private static final UUID EXECUTION_ID = UUID.fromString("0f3f6c1e-6c3e-4a58-9d5b-3b1f1d2a7a11");
    private static final UUID CONNECTION_ID = UUID.fromString("988998bb-f44c-44a6-86c7-1dc568b9623f");

    private static final class Transport extends PinnedHttpTransport {
        final List<String> uris = new ArrayList<>();
        Object metaQuery;
        Object downloadQuery;
        int downloadCap = -1;
        Map<String, Object> meta = Map.of("id", "d1", "name", "invoice.pdf", "mimeType", "application/pdf", "size", "4");
        PinnedHttpTransport.HttpResponse downloadResponse =
                new HttpResponse(200, "%PDF".getBytes(StandardCharsets.UTF_8), Map.of());
        NodeExecutor.Failure downloadFailure;

        @Override
        public HttpResponse executeGoogleApiWithBearerToken(URI uri, String method, Object query, Object body,
                                                            String accessToken) {
            uris.add(method + " " + uri);
            metaQuery = query;
            return new HttpResponse(200, meta, Map.of());
        }

        @Override
        public HttpResponse executeGoogleApiDownloadWithBearerToken(URI uri, Object query, String accessToken,
                                                                    int maxResponseBytes) {
            uris.add("DOWNLOAD " + uri);
            downloadQuery = query;
            downloadCap = maxResponseBytes;
            if (downloadFailure != null) {
                throw downloadFailure;
            }
            return downloadResponse;
        }
    }

    private final InMemoryFileStore store = new InMemoryFileStore();
    private final Transport transport = new Transport();

    private NodeExecutor.Result run(Map<String, Object> overrides) {
        WorkspaceConnectionPort workspace = new WorkspaceConnectionPort() {
            @Override
            public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
            }

            @Override
            public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
                return new ResolvedConnection("GOOGLE_DRIVE", "OAUTH2", Map.of("accessToken", "synthetic-drive-token"));
            }

            @Override
            public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            }
        };
        Map<String, Object> config = new LinkedHashMap<>();
        config.put("connectionId", CONNECTION_ID.toString());
        config.put("operation", "download");
        config.put("fileId", "drive file/1");
        config.putAll(overrides);
        return new GoogleDriveNodeExecutor(new GoogleApiClient(transport), workspace, store).execute(
                new NodeExecutor.Context(WORKSPACE_ID, EXECUTION_ID, UUID.randomUUID(), "n", 1, "c", null), config);
    }

    private NodeExecutor.Failure failure(Map<String, Object> overrides) {
        return assertThrows(NodeExecutor.Failure.class, () -> run(overrides));
    }

    @Test
    @SuppressWarnings("unchecked")
    void downloadsTheFileIntoTheWorkspaceStoreAndReturnsAReference() {
        NodeExecutor.Result result = run(Map.of());

        assertEquals(List.of("GET https://www.googleapis.com/drive/v3/files/drive%20file%2F1",
                "DOWNLOAD https://www.googleapis.com/drive/v3/files/drive%20file%2F1"), transport.uris);
        assertEquals(Map.of("fields", "id,name,mimeType,size"), transport.metaQuery);
        assertEquals(Map.of("alt", "media"), transport.downloadQuery);
        assertEquals(10 * 1024 * 1024, transport.downloadCap);
        Map<String, Object> file = (Map<String, Object>) result.output().get("file");
        assertEquals(Map.of("fileId", file.get("fileId"), "filename", "invoice.pdf",
                "mimeType", "application/pdf", "size", 4L), file);
        InMemoryFileStore.StoredFile stored = store.files.get((String) file.get("fileId"));
        assertEquals("%PDF", new String(stored.bytes(), StandardCharsets.UTF_8));
        assertEquals(WORKSPACE_ID, store.lastWorkspace);
        assertEquals(EXECUTION_ID, store.lastExecution);
        assertFalse(result.output().toString().contains("synthetic-drive-token"));
    }

    @Test
    void googleNativeDocumentsFailClearlyAndNeverDownload() {
        transport.meta = Map.of("id", "d1", "name", "Plan", "mimeType", "application/vnd.google-apps.document");

        NodeExecutor.Failure failure = failure(Map.of());

        assertEquals("CONFIGURATION_ERROR", failure.code());
        assertFalse(failure.retryable());
        assertTrue(failure.getMessage().contains("Google Docs"));
        assertEquals(1, transport.uris.size());
        assertTrue(store.files.isEmpty());
    }

    @Test
    void aDeclaredOrActualSizeOverTheLimitIsANonRetryableFileTooLarge() {
        transport.meta = Map.of("id", "d1", "name", "big.bin", "mimeType", "application/pdf", "size", "10485761");
        NodeExecutor.Failure declared = failure(Map.of());
        assertEquals("FILE_TOO_LARGE", declared.code());
        assertEquals(1, transport.uris.size());

        transport.meta = Map.of("id", "d1", "name", "big.bin", "mimeType", "application/pdf");
        transport.downloadFailure = new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE", "x", false);
        NodeExecutor.Failure actual = failure(Map.of());
        assertEquals("FILE_TOO_LARGE", actual.code());
        assertFalse(actual.retryable());
        assertTrue(store.files.isEmpty());
    }

    @Test
    void anUnconfiguredStoreAndBadConfigFailBeforeAnyGoogleCall() {
        store.configured = false;
        assertEquals("DEPENDENCY_NOT_CONFIGURED", failure(Map.of()).code());
        store.configured = true;
        assertEquals("CONFIGURATION_ERROR", failure(Map.of("fileId", "  ")).code());
        assertEquals("CONFIGURATION_ERROR", failure(Map.of("fileId", 12)).code());
        assertTrue(transport.uris.isEmpty());
    }

    @Test
    void providerErrorsKeepTheirClassification() {
        transport.downloadResponse = new PinnedHttpTransport.HttpResponse(404, "nope".getBytes(StandardCharsets.UTF_8), Map.of());
        NodeExecutor.Failure notFound = failure(Map.of());
        assertEquals("HTTP_BUSINESS_REJECTED", notFound.code());
        assertFalse(notFound.retryable());

        transport.downloadResponse = new PinnedHttpTransport.HttpResponse(503, new byte[0], Map.of());
        NodeExecutor.Failure unavailable = failure(Map.of());
        assertEquals("HTTP_DEPENDENCY_UNAVAILABLE", unavailable.code());
        assertTrue(unavailable.retryable());
        assertTrue(store.files.isEmpty());
    }
}
