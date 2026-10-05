package com.weav.workflow.application.port.out;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Reads new mail for the Gmail trigger. Implementations throw {@code NodeExecutor.Failure} with a stable code. */
public interface GmailMailboxPort {

    /**
     * The next at most {@code max} matching messages after the position {@code (after, afterMessageId)}, oldest
     * first, in Gmail's list order. The position is the cursor time plus the id of the last message handled there,
     * so a burst of emails inside one second is walked in slices without stalling or repeating. Entries that must
     * not start a run (unreadable, or older than {@code after}) are returned as {@link Message#skipped} markers so
     * the caller moves the position past them.
     */
    FetchResult fetchNew(ResolvedConnection connection, String query, Instant after, String afterMessageId, int max);

    /** {@code input} is the trigger input of the run this message starts; null for a skip marker. */
    record Message(String id, Instant internalDate, Map<String, Object> input) {
        public static Message skipped(String id) {
            return new Message(id, null, null);
        }

        public boolean isSkipMarker() {
            return input == null;
        }
    }

    /** {@code notice} is null, GMAIL_MESSAGE_SKIPPED or GMAIL_BACKLOG_TRUNCATED: shown on the trigger, poll goes on. */
    record FetchResult(List<Message> messages, String notice) {
        public static FetchResult of(List<Message> messages) {
            return new FetchResult(messages, null);
        }
    }
}
