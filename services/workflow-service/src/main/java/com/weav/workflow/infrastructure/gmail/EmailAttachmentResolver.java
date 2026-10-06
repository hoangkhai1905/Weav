package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import com.weav.workflow.infrastructure.files.WorkflowFileProperties;
import com.weav.workflow.infrastructure.http.PinnedHttpTransport;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Turns the email.send {@code attachments} value into bytes. An item is a file reference ({@code fileId}) read from
 * the workflow file store, or a public {@code url} downloaded through the SSRF-safe transport. Items with neither
 * (a trigger.gmail attachment that was too large or not stored) are skipped and counted, not failed.
 */
@Component
class EmailAttachmentResolver {

    private static final Pattern MEDIA_TYPE = Pattern.compile("[A-Za-z0-9!#$&^_.+-]{1,127}/[A-Za-z0-9!#$&^_.+-]{1,127}");
    private static final int MAX_URL_LENGTH = 2048;
    private static final int MAX_LISTED_ITEMS = 100;

    record Resolved(List<MimeMessageBuilder.Attachment> attachments, int skipped) {
        static final Resolved NONE = new Resolved(List.of(), 0);
    }

    private final WorkflowFileStore fileStore;
    private final PinnedHttpTransport transport;
    private final WorkflowFileProperties limits;

    EmailAttachmentResolver(WorkflowFileStore fileStore, PinnedHttpTransport transport, WorkflowFileProperties limits) {
        this.fileStore = Objects.requireNonNull(fileStore, "fileStore must not be null");
        this.transport = Objects.requireNonNull(transport, "transport must not be null");
        this.limits = Objects.requireNonNull(limits, "limits must not be null");
    }

    /** True when the configured value asks for attachments (a non-blank string or a non-empty list). */
    static boolean configured(Object value) {
        return value instanceof String text ? !text.isBlank() : value instanceof List<?> list && !list.isEmpty();
    }

    Resolved resolve(UUID workspaceId, Object value) {
        if (!configured(value)) {
            return Resolved.NONE;
        }
        if (!(value instanceof List<?> items)) {
            throw configurationFailure();
        }
        if (items.size() > MAX_LISTED_ITEMS) {
            throw limitFailure();
        }
        List<Map<?, ?>> usable = new ArrayList<>();
        int skipped = 0;
        for (Object item : items) {
            if (!(item instanceof Map<?, ?> map)) {
                throw configurationFailure();
            }
            if (map.get("fileId") instanceof String id && !id.isBlank()
                    || map.get("url") instanceof String url && !url.isBlank()) {
                usable.add(map);
            } else {
                skipped++;
            }
        }
        if (usable.size() > limits.getMaxAttachments()) {
            throw limitFailure();
        }
        long maxFile = Math.min(limits.getMaxFileBytes(), PinnedHttpTransport.MAX_CALL_BYTES);
        long total = 0;
        List<MimeMessageBuilder.Attachment> attachments = new ArrayList<>();
        for (Map<?, ?> item : usable) {
            MimeMessageBuilder.Attachment attachment = item.get("fileId") instanceof String id && !id.isBlank()
                    ? fromFile(workspaceId, id.strip(), item)
                    : fromUrl((String) item.get("url"), item, maxFile, Math.max(1, limits.getMaxEmailBytes() - total));
            if (attachment.bytes().length > maxFile) {
                throw tooLargeFailure();
            }
            total += attachment.bytes().length;
            if (total > limits.getMaxEmailBytes()) {
                throw limitFailure();
            }
            attachments.add(attachment);
        }
        return new Resolved(List.copyOf(attachments), skipped);
    }

    private MimeMessageBuilder.Attachment fromFile(UUID workspaceId, String fileId, Map<?, ?> item) {
        WorkflowFileStore.StoredFile stored = fileStore.read(workspaceId, fileId);
        WorkflowFileStore.FileReference reference = stored.reference();
        return new MimeMessageBuilder.Attachment(
                filename(item.get("filename"), reference.filename(), null),
                mediaType(reference.mimeType()), stored.bytes());
    }

    /** The download is capped by the per-file limit and by what is left of the total budget. */
    private MimeMessageBuilder.Attachment fromUrl(String rawUrl, Map<?, ?> item, long maxFile, long remaining) {
        boolean budgetLimited = remaining < maxFile;
        long cap = Math.min(maxFile, remaining);
        URI uri;
        try {
            if (rawUrl.length() > MAX_URL_LENGTH) {
                throw configurationFailure();
            }
            uri = URI.create(rawUrl.strip());
        } catch (IllegalArgumentException exception) {
            throw configurationFailure();
        }
        PinnedHttpTransport.Download download;
        try {
            download = transport.downloadPublicFile(uri, (int) cap);
        } catch (NodeExecutor.Failure failure) {
            if ("HTTP_RESPONSE_TOO_LARGE".equals(failure.code())) {
                throw budgetLimited ? limitFailure() : tooLargeFailure();
            }
            throw failure;
        }
        return new MimeMessageBuilder.Attachment(
                filename(item.get("filename"), download.filename(), uri.getPath()),
                mediaType(download.contentType()), download.bytes());
    }

    /** Explicit name, then the file's own, then the last URL path segment, then "attachment". */
    private static String filename(Object explicit, String own, String urlPath) {
        String name = explicit instanceof String text ? WorkflowFileStore.safeFilename(text) : null;
        if (name == null) {
            name = WorkflowFileStore.safeFilename(own);
        }
        if (name == null && urlPath != null) {
            name = WorkflowFileStore.safeFilename(urlPath.substring(urlPath.lastIndexOf('/') + 1));
        }
        return name == null ? "attachment" : name;
    }

    private static String mediaType(String candidate) {
        return candidate != null && MEDIA_TYPE.matcher(candidate.strip()).matches()
                ? candidate.strip() : "application/octet-stream";
    }

    private static NodeExecutor.Failure configurationFailure() {
        return new NodeExecutor.Failure("CONFIGURATION_ERROR", "The email node configuration is invalid.", false);
    }

    private static NodeExecutor.Failure limitFailure() {
        return new NodeExecutor.Failure("ATTACHMENT_LIMIT_EXCEEDED",
                "The email has too many attachments or they are too large in total.", false);
    }

    private static NodeExecutor.Failure tooLargeFailure() {
        return new NodeExecutor.Failure("ATTACHMENT_TOO_LARGE", "An attachment is larger than the allowed size.", false);
    }
}
