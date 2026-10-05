package com.weav.workflow.application.port.out;

import java.time.Instant;
import java.util.List;
import java.util.Map;

/** Reads new mail for the Gmail trigger. Implementations throw {@code NodeExecutor.Failure} with a stable code. */
public interface GmailMailboxPort {

    /**
     * Matching mail from the cursor on: at most {@code max} messages, the OLDEST of the newest 100 matches, returned
     * oldest first, none older than {@code after}. The newest already-seen email is listed again; callers dedupe
     * by message id. The next poll continues with the rest.
     */
    FetchResult fetchNew(ResolvedConnection connection, String query, Instant after, int max);

    /** {@code input} is the trigger input of the run this message starts. */
    record Message(String id, Instant internalDate, Map<String, Object> input) {
    }

    /** {@code notice} is null, GMAIL_MESSAGE_SKIPPED or GMAIL_BACKLOG_TRUNCATED: shown on the trigger, poll goes on. */
    record FetchResult(List<Message> messages, String notice) {
        public static FetchResult of(List<Message> messages) {
            return new FetchResult(messages, null);
        }
    }
}
