package com.weav.workflow.infrastructure.files;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** R2/S3 object storage plus a {@code workflow_files} row per file. Object keys never contain the user filename. */
public final class S3WorkflowFileStore implements WorkflowFileStore {

    private static final Logger LOGGER = LoggerFactory.getLogger(S3WorkflowFileStore.class);
    private static final String DEFAULT_MIME_TYPE = "application/octet-stream";
    private static final String DEFAULT_FILENAME = "file";
    private static final Pattern MIME_TYPE = Pattern.compile("[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}");

    private final S3Client client;
    private final WorkflowFileRepository repository;
    private final WorkflowFileProperties properties;
    private final Clock clock;

    public S3WorkflowFileStore(
            S3Client client, WorkflowFileRepository repository, WorkflowFileProperties properties, Clock clock) {
        this.client = Objects.requireNonNull(client);
        this.repository = Objects.requireNonNull(repository);
        this.properties = Objects.requireNonNull(properties);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public FileReference store(UUID workspaceId, UUID executionId, String filename, String mimeType, byte[] bytes) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(bytes, "bytes must not be null");
        if (bytes.length > properties.getMaxFileBytes()) {
            throw new NodeExecutor.Failure("FILE_TOO_LARGE", "The file exceeds the supported size.", false);
        }
        UUID fileId = UUID.randomUUID();
        String objectKey = properties.getKeyPrefix() + "/" + workspaceId + "/" + fileId;
        String safeName = sanitizeFilename(filename);
        String safeMime = normalizeMimeType(mimeType);
        try {
            client.putObject(PutObjectRequest.builder()
                    .bucket(properties.getBucket())
                    .key(objectKey)
                    .contentType(DEFAULT_MIME_TYPE)
                    .contentLength((long) bytes.length)
                    .build(), RequestBody.fromBytes(bytes));
        } catch (RuntimeException exception) {
            LOGGER.warn("Workflow file upload failed: {}", exception.getClass().getSimpleName());
            throw unavailable();
        }
        Instant now = clock.instant();
        try {
            repository.insert(new WorkflowFileRepository.Row(fileId, workspaceId, objectKey, safeName, safeMime,
                    bytes.length, now.plus(properties.getRetention())), executionId, now);
        } catch (RuntimeException exception) {
            deleteObjectQuietly(objectKey);
            LOGGER.warn("Workflow file row insert failed: {}", exception.getClass().getSimpleName());
            throw unavailable();
        }
        return new FileReference(fileId.toString(), safeName, safeMime, bytes.length);
    }

    @Override
    public StoredFile read(UUID workspaceId, String fileId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        UUID id = parseId(fileId);
        WorkflowFileRepository.Row row;
        try {
            row = repository.find(id).orElse(null);
        } catch (RuntimeException exception) {
            throw unavailable();
        }
        // One failure for unknown id, other workspace and expired, so ids cannot be probed.
        if (row == null || !row.workspaceId().equals(workspaceId) || !row.expiresAt().isAfter(clock.instant())) {
            throw notFound();
        }
        byte[] bytes;
        try {
            bytes = client.getObjectAsBytes(GetObjectRequest.builder()
                    .bucket(properties.getBucket()).key(row.objectKey()).build()).asByteArrayUnsafe();
        } catch (NoSuchKeyException exception) {
            throw notFound();
        } catch (RuntimeException exception) {
            LOGGER.warn("Workflow file download failed: {}", exception.getClass().getSimpleName());
            throw unavailable();
        }
        return new StoredFile(new FileReference(row.id().toString(), row.filename(), row.mimeType(), row.sizeBytes()),
                bytes);
    }

    @Override
    public int purgeExpired(int limit) {
        // Keyset paging on (expires_at, id): rows whose object delete fails stay in the table for the next run but
        // are skipped in this one, so they cannot starve newer expired rows.
        Instant now = clock.instant();
        Instant afterExpiresAt = Instant.EPOCH.minusSeconds(1);
        UUID afterId = new UUID(0, 0);
        int removed = 0;
        int scanned = 0;
        while (removed < limit && scanned < limit * 10) {
            List<WorkflowFileRepository.Row> page = repository.findExpired(now, afterExpiresAt, afterId, limit);
            for (WorkflowFileRepository.Row row : page) {
                try {
                    client.deleteObject(DeleteObjectRequest.builder()
                            .bucket(properties.getBucket()).key(row.objectKey()).build());
                } catch (RuntimeException exception) {
                    LOGGER.warn("Expired workflow file {} object delete failed: {}", row.id(),
                            exception.getClass().getSimpleName());
                    continue;
                }
                repository.delete(row.id());
                removed++;
            }
            scanned += page.size();
            if (page.size() < limit) {
                break;
            }
            WorkflowFileRepository.Row last = page.get(page.size() - 1);
            afterExpiresAt = last.expiresAt();
            afterId = last.id();
        }
        return removed;
    }

    /** Closed by Spring at shutdown (inferred destroy method). */
    public void close() {
        client.close();
    }

    private void deleteObjectQuietly(String objectKey) {
        try {
            client.deleteObject(DeleteObjectRequest.builder()
                    .bucket(properties.getBucket()).key(objectKey).build());
        } catch (RuntimeException exception) {
            LOGGER.warn("Orphan workflow file object cleanup failed: {}", exception.getClass().getSimpleName());
        }
    }

    private static UUID parseId(String fileId) {
        try {
            return UUID.fromString(fileId);
        } catch (RuntimeException exception) {
            throw notFound();
        }
    }

    private static NodeExecutor.Failure notFound() {
        return new NodeExecutor.Failure("FILE_NOT_FOUND", "The file was not found.", false);
    }

    private static NodeExecutor.Failure unavailable() {
        return new NodeExecutor.Failure("FILE_STORE_UNAVAILABLE", "The workflow file store is unavailable.", true);
    }

    /** {@link WorkflowFileStore#safeFilename} with the fixed fallback name. */
    static String sanitizeFilename(String filename) {
        String name = WorkflowFileStore.safeFilename(filename);
        return name == null ? DEFAULT_FILENAME : name;
    }

    /** Keeps {@code type/subtype} without parameters; anything else becomes application/octet-stream. */
    static String normalizeMimeType(String mimeType) {
        if (mimeType == null) {
            return DEFAULT_MIME_TYPE;
        }
        int parameters = mimeType.indexOf(';');
        String type = (parameters < 0 ? mimeType : mimeType.substring(0, parameters)).strip().toLowerCase(Locale.ROOT);
        return MIME_TYPE.matcher(type).matches() ? type : DEFAULT_MIME_TYPE;
    }
}
