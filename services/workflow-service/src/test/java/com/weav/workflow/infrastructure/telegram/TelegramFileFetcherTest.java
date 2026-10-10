package com.weav.workflow.infrastructure.telegram;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.trigger.TelegramUpdate;
import com.weav.workflow.infrastructure.files.InMemoryFileStore;
import com.weav.workflow.infrastructure.files.WorkflowFileProperties;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TelegramFileFetcherTest {

    private static final UUID WORKSPACE_ID = UUID.randomUUID();
    private static final UUID CONNECTION_ID = UUID.randomUUID();
    private static final String TOKEN = "123456:synthetic-bot-token";

    private final InMemoryFileStore store = new InMemoryFileStore();
    private final WorkflowFileProperties properties = new WorkflowFileProperties();
    private final FakeTransport transport = new FakeTransport();
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();
    private final Logger logger = (Logger) LoggerFactory.getLogger(TelegramFileFetcher.class);

    @BeforeEach
    void captureLogs() {
        logs.start();
        logger.addAppender(logs);
    }

    @AfterEach
    void releaseLogs() {
        logger.detachAppender(logs);
    }

    private TelegramFileFetcher fetcher() {
        WorkspaceConnectionPort connections = new WorkspaceConnectionPort() {
            @Override
            public void authorizeAttachment(UUID workspaceId, UUID connectionId, UUID userId) {
            }

            @Override
            public ResolvedConnection resolve(UUID workspaceId, UUID connectionId) {
                return new ResolvedConnection("TELEGRAM", "TOKEN", Map.of("token", TOKEN));
            }

            @Override
            public void reportAuthenticationRejected(UUID workspaceId, UUID connectionId) {
            }
        };
        return new TelegramFileFetcher(new TelegramBotApiClient(transport), connections, store, properties);
    }

    private static List<TelegramUpdate.FileCandidate> photo() {
        return List.of(new TelegramUpdate.FileCandidate("big", "photo.jpg", "image/jpeg", 9_000_000L),
                new TelegramUpdate.FileCandidate("small", "photo.jpg", "image/jpeg", 1_000L));
    }

    @Test
    void storesTheDownloadedFileInTheWorkspaceStoreAndReturnsAReference() {
        Map<String, Object> file = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID,
                List.of(new TelegramUpdate.FileCandidate("doc1", "invoice.pdf", "application/pdf", 4L)));

        assertEquals(Map.of("fileId", file.get("fileId"), "filename", "invoice.pdf",
                "mimeType", "application/pdf", "size", 4L), file);
        assertEquals("%PDF", new String(store.files.get((String) file.get("fileId")).bytes(), StandardCharsets.UTF_8));
        assertEquals(WORKSPACE_ID, store.lastWorkspace);
        assertEquals(List.of("getFile:doc1"), transport.calls);
        assertEquals(List.of("https://api.telegram.org/file/bot" + TOKEN + "/documents/file_7.pdf"), transport.downloads);
    }

    @Test
    void picksTheLargestPhotoSizeThatFitsTheLimit() {
        properties.setMaxFileBytes(5_000_000L);

        Map<String, Object> file = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID, photo());

        assertEquals(List.of("getFile:small"), transport.calls);
        assertEquals("photo.jpg", file.get("filename"));
        assertFalse(file.containsKey("skipped"));
    }

    @Test
    void whenNothingFitsTheLimitNothingIsDownloaded() {
        properties.setMaxFileBytes(500L);

        Map<String, Object> file = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID, photo());

        assertEquals(Map.of("skipped", "too_large", "filename", "photo.jpg", "mimeType", "image/jpeg",
                "size", 9_000_000L), file);
        assertTrue(transport.calls.isEmpty());
        assertTrue(store.files.isEmpty());
    }

    @Test
    void anUnconfiguredStoreIsNotStoredAndDownloadsNothing() {
        store.configured = false;

        Map<String, Object> file = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID, photo());

        assertEquals("not_stored", file.get("skipped"));
        assertTrue(transport.calls.isEmpty());
    }

    @Test
    void anActualSizeOverTheLimitOrAnOversizedDownloadIsTooLarge() {
        transport.filePath = "photos/x.jpg";
        transport.declaredSize = 6_000_000L;
        properties.setMaxFileBytes(5_000_000L);
        assertEquals("too_large", fetcher().fetch(WORKSPACE_ID, CONNECTION_ID,
                List.of(new TelegramUpdate.FileCandidate("a", "a.bin", "application/octet-stream", null)))
                .get("skipped"));
        assertTrue(transport.downloads.isEmpty());

        transport.declaredSize = null;
        transport.downloadFailure = new NodeExecutor.Failure("HTTP_RESPONSE_TOO_LARGE", "x", false);
        assertEquals("too_large", fetcher().fetch(WORKSPACE_ID, CONNECTION_ID,
                List.of(new TelegramUpdate.FileCandidate("a", "a.bin", "application/octet-stream", null)))
                .get("skipped"));
    }

    @Test
    void failuresBecomeErrorAndNeverLeakTheTokenOrTheDownloadUrl() {
        transport.downloadFailure = new NodeExecutor.Failure("HTTP_BUSINESS_REJECTED",
                "failed for https://api.telegram.org/file/bot" + TOKEN + "/x", false);

        Map<String, Object> rejected = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID, photo());
        transport.downloadFailure = null;
        transport.getFileStatus = 400;
        Map<String, Object> badFile = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID, photo());
        transport.getFileStatus = 200;
        transport.runtimeFailure = new IllegalStateException(TOKEN);
        Map<String, Object> crashed = fetcher().fetch(WORKSPACE_ID, CONNECTION_ID, photo());

        for (Map<String, Object> file : List.of(rejected, badFile, crashed)) {
            assertEquals("error", file.get("skipped"));
            assertFalse(file.toString().contains(TOKEN));
        }
        assertFalse(logs.list.isEmpty());
        assertTrue(logs.list.stream().noneMatch(event -> event.getFormattedMessage().contains(TOKEN)
                || event.getFormattedMessage().contains("api.telegram.org")));
        assertTrue(store.files.isEmpty());
    }

    @Test
    void theRealTransportOnlyDownloadsFromTheFileEndpointOfTheFixedHost() {
        PinnedHttpTransport real = new PinnedHttpTransport();
        for (String target : List.of(
                "http://api.telegram.org/file/bot1:abc/photos/a.jpg",
                "https://evil.example.test/file/bot1:abc/photos/a.jpg",
                "https://api.telegram.org@evil.example.test/file/bot1:abc/photos/a.jpg",
                "https://api.telegram.org:8443/file/bot1:abc/photos/a.jpg",
                "https://api.telegram.org/file/bot1:abc/photos/a.jpg?x=1",
                "https://api.telegram.org/file/bot1:abc/../a.jpg",
                "https://api.telegram.org/file/bot1:abc/",
                "https://api.telegram.org/bot1:abc/photos/a.jpg",
                "https://api.telegram.org/file/bot1:abc/photos//a.jpg")) {
            NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                    () -> real.downloadTelegramFile(URI.create(target), 1000), target);
            assertEquals("HTTP_REQUEST_INVALID", failure.code(), target);
            assertFalse(failure.getMessage().contains("abc"));
        }
        // getFile is a POST Bot API method now; the file endpoint is still refused there.
        assertThrows(NodeExecutor.Failure.class, () -> real.executeTelegramBotApi(
                URI.create("https://api.telegram.org/file/bot1:abc/getFile"), Map.of(), null));
    }

    private static final class FakeTransport extends PinnedHttpTransport {
        final List<String> calls = new ArrayList<>();
        final List<String> downloads = new ArrayList<>();
        String filePath = "documents/file_7.pdf";
        Long declaredSize;
        int getFileStatus = 200;
        NodeExecutor.Failure downloadFailure;
        RuntimeException runtimeFailure;

        @Override
        public HttpResponse executeTelegramBotApi(URI uri, Object body, java.time.Duration timeout) {
            String method = uri.getPath().substring(uri.getPath().lastIndexOf('/') + 1);
            calls.add(method + ":" + ((Map<?, ?>) body).get("file_id"));
            if (runtimeFailure != null) {
                throw runtimeFailure;
            }
            if (getFileStatus != 200) {
                return new HttpResponse(getFileStatus, Map.of("ok", false), Map.of());
            }
            Map<String, Object> result = new java.util.LinkedHashMap<>();
            result.put("file_path", filePath);
            if (declaredSize != null) {
                result.put("file_size", declaredSize);
            }
            return new HttpResponse(200, Map.of("ok", true, "result", result), Map.of());
        }

        @Override
        public Download downloadTelegramFile(URI uri, int maxBytes) {
            downloads.add(uri.toString());
            if (downloadFailure != null) {
                throw downloadFailure;
            }
            return new Download(200, "%PDF".getBytes(StandardCharsets.UTF_8), null, null);
        }
    }
}
