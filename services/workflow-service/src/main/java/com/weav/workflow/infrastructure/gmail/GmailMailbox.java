package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkflowFileStore;
import com.weav.workflow.infrastructure.files.WorkflowFileProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/**
 * Lists then reads new Gmail messages for the polling trigger.
 *
 * <p>Position, not time alone: {@code after:} has second granularity and the list is newest first, so a burst of
 * emails inside one second cannot be told apart by time. The trigger stores the cursor time and the id of the last
 * message handled; each poll lists (at most 100 ids), reverses to oldest first, drops everything up to and including
 * that id, and takes the next slice. Assumption: Gmail's list order is stable between two calls a few minutes apart
 * (it is ordered by internal date, ties stay in a fixed order). If the stored id is no longer listed (deleted or no
 * longer matching), the slice starts at the oldest listed mail and the idempotency key dedupes any repeat.
 */
@Component
public class GmailMailbox implements GmailMailboxPort {
    private static final Logger logger = LoggerFactory.getLogger(GmailMailbox.class);

    static final String SKIPPED = "GMAIL_MESSAGE_SKIPPED";
    static final String BACKLOG_TRUNCATED = "GMAIL_BACKLOG_TRUNCATED";
    /** A first-in-slice message whose attachment keeps failing retryably is retried for this long, then admitted. */
    static final Duration RETRY_WINDOW = Duration.ofHours(1);
    static final Duration FUTURE_TOLERANCE = Duration.ofMinutes(5);

    private final GmailClient client;
    private final GmailAttachmentReader attachmentReader;
    private final WorkflowFileStore files;
    private final WorkflowFileProperties fileProperties;
    private final Clock clock;

    @Autowired
    public GmailMailbox(GmailClient client, GmailAttachmentReader attachmentReader, WorkflowFileStore files,
                        WorkflowFileProperties fileProperties) {
        this(client, attachmentReader, files, fileProperties, Clock.systemUTC());
    }

    GmailMailbox(GmailClient client, GmailAttachmentReader attachmentReader, WorkflowFileStore files,
                 WorkflowFileProperties fileProperties, Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        this.client = Objects.requireNonNull(client, "client must not be null");
        this.attachmentReader = Objects.requireNonNull(attachmentReader, "attachmentReader must not be null");
        this.files = Objects.requireNonNull(files, "files must not be null");
        this.fileProperties = Objects.requireNonNull(fileProperties, "fileProperties must not be null");
    }

    @Override
    public FetchResult fetchNew(UUID workspaceId, ResolvedConnection connection, String query, Instant after,
                                String afterMessageId, int max) {
        String q = (query == null || query.isBlank() ? "" : query.strip() + " ")
                + "after:" + Math.max(0, after.getEpochSecond() - 1);
        GmailClient.Listing listing = client.listMessageIds(q, connection);
        String notice = listing.truncated() ? BACKLOG_TRUNCATED : null;
        if (listing.truncated()) {
            logger.warn("event=gmail_backlog_truncated bound={}", GmailClient.LIST_BOUND);
        }
        List<String> ids = new ArrayList<>(listing.ids());
        Collections.reverse(ids); // oldest first
        int start = afterMessageId == null ? 0 : ids.indexOf(afterMessageId) + 1;
        List<String> slice = ids.subList(start, Math.min(ids.size(), start + max));

        List<Message> messages = new ArrayList<>();
        long budget = 2 * fileProperties.getMaxEmailBytes();
        boolean storeConfigured = files.configured();
        boolean more = false;
        long downloaded = 0;
        for (String id : slice) {
            GmailClient.MessageRead read = client.getMessage(id, connection);
            if (read.json() == null) {
                logger.warn("event=gmail_message_skipped reason={} messageId={}", read.skippedCode(), id);
                notice = SKIPPED;
                messages.add(Message.skipped(id));
                continue;
            }
            var parsed = GmailMessageParser.parse(read.json(), read.bodyOmitted());
            if (parsed.isEmpty()) {
                logger.warn("event=gmail_message_skipped reason=UNPARSEABLE messageId={}", id);
                notice = SKIPPED;
                messages.add(Message.skipped(id));
            } else if (parsed.get().internalDate().isBefore(after)) {
                messages.add(Message.skipped(id)); // from before activation or resume: not a notice, just move on
            } else {
                GmailMessageParser.Parsed message = parsed.get();
                long declared = downloadable(message.attachments(), storeConfigured);
                if (!messages.isEmpty() && downloaded + declared > budget) {
                    more = true;
                    break; // bound one poll's downloads: the rest of the slice is read on the next poll
                }
                // Once the result holds anything (even only skip markers) the cursor can move past it, so a retryable
                // failure cuts the slice there. With an empty result it fails the poll while the mail is recent (from 1 hour
                // ago to 5 minutes ahead); older or future-dated mail lists the attachment as "error" and is admitted.
                Instant now = clock.instant();
                boolean degrade = messages.isEmpty() && (message.internalDate().isBefore(now.minus(RETRY_WINDOW))
                        || message.internalDate().isAfter(now.plus(FUTURE_TOLERANCE)));
                try {
                    message.input().put("attachments", attachments(
                            workspaceId, message.id(), message.attachments(), connection, degrade, storeConfigured));
                } catch (NodeExecutor.Failure failure) {
                    if (!messages.isEmpty() && failure.retryable()) {
                        logger.warn("event=gmail_attachment_retry_next_poll code={} messageId={}", failure.code(), id);
                        more = true;
                        break;
                    }
                    throw failure;
                }
                downloaded += declared;
                messages.add(new Message(message.id(), message.internalDate(), message.input()));
            }
        }
        return new FetchResult(messages, notice, more);
    }

    /**
     * The {@code attachments} of one run's input: metadata plus {@code fileId} once stored, never file bytes.
     * Otherwise {@code skipped} is "limit" (beyond the per-email count), "too_large", "not_stored" (the file store
     * is not configured) or "error" (this attachment is permanently unreadable). Only messages that start a run get
     * here, so skip markers download nothing. A credential failure is always thrown. A retryable failure (Gmail or
     * store outage, rate limit) is thrown unless {@code degrade}, when the attachment is listed as "error"; the caller
     * decides, so no mail is lost while the failure is recent. Files already stored for a retried message are orphans
     * that the store's retention purges.
     */
    private List<Map<String, Object>> attachments(UUID workspaceId, String messageId,
                                                  List<GmailMessageParser.AttachmentPart> parts,
                                                  ResolvedConnection connection, boolean degrade,
                                                  boolean storeConfigured) {
        long maxBytes = fileProperties.getMaxFileBytes();
        boolean canStore = !parts.isEmpty() && storeConfigured;
        List<Map<String, Object>> list = new ArrayList<>();
        for (int i = 0; i < parts.size(); i++) {
            GmailMessageParser.AttachmentPart part = parts.get(i);
            Map<String, Object> item = part.metadata();
            String skipped = null;
            if (i >= fileProperties.getMaxAttachments()) {
                skipped = "limit";
            } else if (part.size() > maxBytes) {
                skipped = "too_large";
            } else if (!canStore) {
                skipped = "not_stored";
            } else {
                try {
                    byte[] bytes = part.attachmentId() != null
                            ? attachmentReader.read(messageId, part.attachmentId(), maxBytes, connection)
                            : part.inlineData() != null ? GmailAttachmentReader.decode(part.inlineData()) : null;
                    if (bytes == null) {
                        skipped = "error";
                    } else {
                        WorkflowFileStore.FileReference stored = files.store(
                                workspaceId, null, part.filename(), part.mimeType(), bytes);
                        item.put("size", stored.size());
                        item.put("fileId", stored.fileId());
                    }
                } catch (NodeExecutor.Failure failure) {
                    skipped = skipReason(failure, degrade);
                    logger.warn("event=gmail_attachment_skipped reason={} messageId={}", skipped, messageId);
                }
            }
            if (skipped != null) {
                item.put("skipped", skipped);
            }
            list.add(item);
        }
        return list;
    }

    private static String skipReason(NodeExecutor.Failure failure, boolean degrade) {
        if (failure.retryable() && !degrade || "AUTHENTICATION_REJECTED".equals(failure.code())
                || "CONNECTION_RECONNECT_REQUIRED".equals(failure.code())) {
            throw failure;
        }
        return switch (failure.code()) {
            case "FILE_TOO_LARGE", "HTTP_RESPONSE_TOO_LARGE" -> "too_large";
            case "DEPENDENCY_NOT_CONFIGURED" -> "not_stored";
            default -> "error";
        };
    }

    /** Declared bytes this message will download: its stored-eligible attachments (count and size limits applied). */
    private long downloadable(List<GmailMessageParser.AttachmentPart> parts, boolean storeConfigured) {
        long total = 0;
        for (int i = 0; i < Math.min(parts.size(), fileProperties.getMaxAttachments()); i++) {
            if (parts.get(i).size() <= fileProperties.getMaxFileBytes() && storeConfigured) {
                total += parts.get(i).size();
            }
        }
        return total;
    }
}
