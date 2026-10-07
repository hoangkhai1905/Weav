package com.weav.workflow.infrastructure.files;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.DockerImageName;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.CreateBucketRequest;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.ListObjectsV2Request;
import software.amazon.awssdk.services.s3.model.S3Object;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.AdditionalAnswers.delegatesTo;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

/** The S3 adapter against an adobe/s3mock container and the real workflow_files table (Flyway V12). */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class S3WorkflowFileStoreTest {

    private static final String BUCKET = "workflow-files-test";
    private static final GenericContainer<?> S3MOCK = new GenericContainer<>(DockerImageName.parse("adobe/s3mock:4.11.0"))
            .withExposedPorts(9090)
            .waitingFor(Wait.forListeningPort());

    private static S3Client s3;

    @Autowired
    private JdbcTemplate jdbc;

    private WorkflowFileProperties properties;
    private S3WorkflowFileStore store;
    private final UUID workspace = UUID.randomUUID();

    @BeforeAll
    static void startS3() {
        S3MOCK.start();
        s3 = client();
        s3.createBucket(CreateBucketRequest.builder().bucket(BUCKET).build());
    }

    @AfterAll
    static void stopS3() {
        if (s3 != null) {
            s3.close();
        }
        S3MOCK.stop();
    }

    @BeforeEach
    void newStore() {
        properties = new WorkflowFileProperties();
        properties.setBucket(BUCKET);
        properties.setMaxFileBytes(1024);
        store = new S3WorkflowFileStore(s3, new WorkflowFileRepository(jdbc, "workflow"), properties, Clock.systemUTC());
    }

    @Test
    void storesAndReadsBackAFileUnderAKeyWithoutTheFilename() {
        byte[] bytes = "%PDF binary \u0000ÿ".getBytes(StandardCharsets.ISO_8859_1);
        UUID execution = UUID.randomUUID();

        WorkflowFileStore.FileReference reference = store.store(workspace, execution, "report.pdf", "application/pdf", bytes);

        assertEquals("report.pdf", reference.filename());
        assertEquals("application/pdf", reference.mimeType());
        assertEquals(bytes.length, reference.size());
        WorkflowFileStore.StoredFile stored = store.read(workspace, reference.fileId());
        assertArrayEquals(bytes, stored.bytes());
        assertEquals(reference, stored.reference());
        String key = jdbc.queryForObject("select object_key from workflow.workflow_files where id = ?",
                String.class, UUID.fromString(reference.fileId()));
        assertEquals("workflow-files/" + workspace + "/" + reference.fileId(), key);
        assertFalse(key.contains("report"));
        assertEquals(execution, jdbc.queryForObject("select execution_id from workflow.workflow_files where id = ?",
                UUID.class, UUID.fromString(reference.fileId())));
        assertTrue(store.configured());
    }

    @Test
    void anotherWorkspaceAnUnknownIdAnExpiredFileAndAGarbageIdAllLookTheSame() {
        WorkflowFileStore.FileReference reference = store.store(workspace, null, "a.txt", "text/plain", new byte[] {1});
        WorkflowFileStore.FileReference expired = store.store(workspace, null, "b.txt", "text/plain", new byte[] {2});
        jdbc.update("update workflow.workflow_files set expires_at = now() - interval '1 minute' where id = ?",
                UUID.fromString(expired.fileId()));

        List<NodeExecutor.Failure> failures = List.of(
                assertThrows(NodeExecutor.Failure.class, () -> store.read(UUID.randomUUID(), reference.fileId())),
                assertThrows(NodeExecutor.Failure.class, () -> store.read(workspace, UUID.randomUUID().toString())),
                assertThrows(NodeExecutor.Failure.class, () -> store.read(workspace, expired.fileId())),
                assertThrows(NodeExecutor.Failure.class, () -> store.read(workspace, "not-a-uuid")),
                assertThrows(NodeExecutor.Failure.class, () -> store.read(workspace, null)));
        for (NodeExecutor.Failure failure : failures) {
            assertEquals("FILE_NOT_FOUND", failure.code());
            assertFalse(failure.retryable());
            assertEquals(failures.get(0).getMessage(), failure.getMessage());
        }
        assertEquals(1, store.read(workspace, reference.fileId()).bytes().length);
    }

    @Test
    void rejectsAFileOverTheLimitWithoutStoringAnything() {
        int before = objectCount();
        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> store.store(workspace, null, "big.bin", "application/octet-stream", new byte[1025]));

        assertEquals("FILE_TOO_LARGE", failure.code());
        assertFalse(failure.retryable());
        assertEquals(before, objectCount());
        assertEquals(1024, store.store(workspace, null, "ok.bin", null, new byte[1024]).size());
    }

    @Test
    void sanitizesTheFilenameAndFallsBackForAnInvalidMimeType() {
        assertEquals("....etcpasswd", S3WorkflowFileStore.sanitizeFilename("../../etc/passwd"));
        assertEquals("a.txt", S3WorkflowFileStore.sanitizeFilename("a\r\n\t.txt"));
        assertEquals("file", S3WorkflowFileStore.sanitizeFilename(null));
        assertEquals("file", S3WorkflowFileStore.sanitizeFilename("  /\\ "));
        assertEquals("file", S3WorkflowFileStore.sanitizeFilename(".."));
        assertEquals(255, S3WorkflowFileStore.sanitizeFilename("n".repeat(400)).length());
        // Bidi override, zero-width and line/paragraph separators are dropped.
        assertEquals("invoicexe.pdf", S3WorkflowFileStore.sanitizeFilename("invoice‮xe.pdf"));
        assertEquals("ab.txt", S3WorkflowFileStore.sanitizeFilename("a​b .txt "));
        // A surrogate pair straddling the 255 boundary is dropped whole, never split.
        assertEquals("n".repeat(254), S3WorkflowFileStore.sanitizeFilename("n".repeat(254) + "😀tail"));
        assertEquals("n".repeat(253) + "😀",
                S3WorkflowFileStore.sanitizeFilename("n".repeat(253) + "😀tail"));
        assertNull(WorkflowFileStore.safeFilename(".."));
        assertNull(WorkflowFileStore.safeFilename(null));
        assertEquals("image/png", S3WorkflowFileStore.normalizeMimeType(" Image/PNG; charset=binary"));
        for (String bad : new String[] {null, "", "png", "text/", "/plain", "a/b/c", "text/plain\r\nX: y", "te xt/plain"}) {
            assertEquals("application/octet-stream", S3WorkflowFileStore.normalizeMimeType(bad), String.valueOf(bad));
        }

        WorkflowFileStore.FileReference reference = store.store(workspace, null, "x/y\\z\n.csv", "bad type", new byte[] {1});
        assertEquals("xyz.csv", reference.filename());
        assertEquals("application/octet-stream", reference.mimeType());
    }

    @Test
    void aFailedRowInsertRemovesTheObjectItJustWrote() {
        UUID isolated = UUID.randomUUID();
        S3WorkflowFileStore broken = new S3WorkflowFileStore(s3, new WorkflowFileRepository(jdbc, "no_such_schema"),
                properties, Clock.systemUTC());

        NodeExecutor.Failure failure = assertThrows(NodeExecutor.Failure.class,
                () -> broken.store(isolated, null, "a.txt", "text/plain", new byte[] {1}));

        assertEquals("FILE_STORE_UNAVAILABLE", failure.code());
        assertTrue(failure.retryable());
        assertEquals(0, objectsUnder("workflow-files/" + isolated + "/").size());
    }

    @Test
    void purgeDeletesTheObjectThenTheRowAndKeepsTheRowWhenTheObjectDeleteFails() {
        UUID purgeWorkspace = UUID.randomUUID();
        WorkflowFileStore.FileReference gone = store.store(purgeWorkspace, null, "a", "text/plain", new byte[] {1});
        WorkflowFileStore.FileReference stuck = store.store(purgeWorkspace, null, "b", "text/plain", new byte[] {2});
        WorkflowFileStore.FileReference fresh = store.store(purgeWorkspace, null, "c", "text/plain", new byte[] {3});
        String stuckKey = "workflow-files/" + purgeWorkspace + "/" + stuck.fileId();
        jdbc.update("update workflow.workflow_files set expires_at = now() - interval '1 hour' where id in (?, ?)",
                UUID.fromString(gone.fileId()), UUID.fromString(stuck.fileId()));
        S3Client flaky = mock(S3Client.class, delegatesTo(s3));
        doThrow(new IllegalStateException("object store down")).when(flaky)
                .deleteObject(org.mockito.ArgumentMatchers.<DeleteObjectRequest>argThat(
                        request -> request != null && stuckKey.equals(request.key())));
        S3WorkflowFileStore flakyStore = new S3WorkflowFileStore(flaky, new WorkflowFileRepository(jdbc, "workflow"),
                properties, Clock.systemUTC());

        flakyStore.purgeExpired(100);

        assertEquals(0, rows(gone.fileId()));
        assertEquals(1, rows(stuck.fileId()));
        assertEquals(1, rows(fresh.fileId()));
        assertEquals(List.of(stuckKey, "workflow-files/" + purgeWorkspace + "/" + fresh.fileId()).stream().sorted().toList(),
                objectsUnder("workflow-files/" + purgeWorkspace + "/").stream().map(S3Object::key).sorted().toList());
        // The next run, with a healthy object store, retries the stuck one.
        assertTrue(store.purgeExpired(10) >= 1); // may also sweep expired files left by other tests
        assertEquals(0, rows(stuck.fileId()));
        assertEquals(1, objectsUnder("workflow-files/" + purgeWorkspace + "/").size());
    }

    @Test
    void rowsWhoseObjectDeleteKeepsFailingDoNotStarveNewerExpiredFiles() {
        UUID ws = UUID.randomUUID();
        WorkflowFileStore.FileReference stuckA = store.store(ws, null, "a", "text/plain", new byte[] {1});
        WorkflowFileStore.FileReference stuckB = store.store(ws, null, "b", "text/plain", new byte[] {2});
        WorkflowFileStore.FileReference goodA = store.store(ws, null, "c", "text/plain", new byte[] {3});
        WorkflowFileStore.FileReference goodB = store.store(ws, null, "d", "text/plain", new byte[] {4});
        jdbc.update("update workflow.workflow_files set expires_at = now() - interval '3 hour' where id in (?, ?)",
                UUID.fromString(stuckA.fileId()), UUID.fromString(stuckB.fileId()));
        jdbc.update("update workflow.workflow_files set expires_at = now() - interval '2 hour' where id in (?, ?)",
                UUID.fromString(goodA.fileId()), UUID.fromString(goodB.fileId()));
        // Expired leftovers from other tests could sit ahead of ours; drop them so the paging is deterministic.
        jdbc.update("delete from workflow.workflow_files where expires_at < now() and workspace_id <> ?", ws);
        S3Client flaky = mock(S3Client.class, delegatesTo(s3));
        doThrow(new IllegalStateException("object store down")).when(flaky).deleteObject(
                org.mockito.ArgumentMatchers.<DeleteObjectRequest>argThat(request -> request != null
                        && (request.key().endsWith(stuckA.fileId()) || request.key().endsWith(stuckB.fileId()))));
        S3WorkflowFileStore flakyStore = new S3WorkflowFileStore(flaky, new WorkflowFileRepository(jdbc, "workflow"),
                properties, Clock.systemUTC());

        assertEquals(2, flakyStore.purgeExpired(2));

        assertEquals(1, rows(stuckA.fileId()));
        assertEquals(1, rows(stuckB.fileId()));
        assertEquals(0, rows(goodA.fileId()));
        assertEquals(0, rows(goodB.fileId()));
    }

    @Test
    void withoutSettingsTheStoreIsNotConfiguredAndFileCallsFailClearly() {
        assertFalse(new WorkflowFileProperties().isConfigured());
        WorkflowFileProperties partial = new WorkflowFileProperties();
        partial.setEndpoint("http://localhost:9000");
        partial.setBucket("b");
        partial.setAccessKey("k");
        assertFalse(partial.isConfigured());
        partial.setSecretKey("s");
        assertTrue(partial.isConfigured());

        WorkflowFileStore unavailable = new UnavailableWorkflowFileStore();
        assertFalse(unavailable.configured());
        assertEquals("DEPENDENCY_NOT_CONFIGURED", assertThrows(NodeExecutor.Failure.class,
                () -> unavailable.store(workspace, null, "a", "text/plain", new byte[1])).code());
        assertEquals("DEPENDENCY_NOT_CONFIGURED", assertThrows(NodeExecutor.Failure.class,
                () -> unavailable.read(workspace, UUID.randomUUID().toString())).code());
        assertEquals(0, unavailable.purgeExpired(10));
    }

    private int rows(String fileId) {
        return jdbc.queryForObject("select count(*) from workflow.workflow_files where id = ?", Integer.class,
                UUID.fromString(fileId));
    }

    private int objectCount() {
        return objectsUnder("workflow-files/").size();
    }

    private List<S3Object> objectsUnder(String prefix) {
        return s3.listObjectsV2(ListObjectsV2Request.builder().bucket(BUCKET).prefix(prefix).build()).contents();
    }

    private static S3Client client() {
        return S3Client.builder()
                .endpointOverride(URI.create("http://" + S3MOCK.getHost() + ":" + S3MOCK.getMappedPort(9090)))
                .region(Region.US_EAST_1)
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create("test", "test")))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(true).build())
                .build();
    }
}
