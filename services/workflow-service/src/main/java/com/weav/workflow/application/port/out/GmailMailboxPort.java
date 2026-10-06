package com.weav.workflow.application.port.out;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Reads new mail for the Gmail trigger. Implementations throw {@code NodeExecutor.Failure} with a stable code. */
public interface GmailMailboxPort {

    /**
     * The next at most {@code max} matching messages after the position {@code (after, afterMessageId)}, oldest
     * first, in Gmail's list order. The position is the cursor time plus the id of the last message handled there,
     * so a burst of emails inside one second is walked in slices without stalling or repeating. Entries that must
     * not start a run (unreadable, or older than {@code after}) are returned as {@link Message#skipped} markers so
     * the caller moves the position past them. {@code workspaceId} owns the attachment files stored while reading
     * (a message that starts a run has its attachments stored with no execution id yet; skip markers store none).
     */
    FetchResult fetchNew(UUID workspaceId, ResolvedConnection connection, String query, Instant after, String afterMessageId, int max);

    /** {@code input} is the trigger input of the run this message starts; null for a skip marker. */
    record Message(String id, Instant internalDate, Map<String, Object> input) {
        public static Message skipped(String id) {
            return new Message(id, null, null);
        }

        public boolean isSkipMarker() {
            return input == null;
        }
    }

    /** {@code notice} is null, GMAIL_MESSAGE_SKIPPED or GMAIL_BACKLOG_TRUNCATED: shown on the trigger, poll goes on.
     * {@code more}: the slice was cut early (download budget, or a retryable failure on a later message), so the
     * caller polls again on the next tick like after a full slice. */
    record FetchResult(List<Message> messages, String notice, boolean more) {
        public FetchResult(List<Message> messages, String notice) {
            this(messages, notice, false);
        }

        public static FetchResult of(List<Message> messages) {
            return new FetchResult(messages, null);
        }
    }
}
