package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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

    private final GmailClient client;

    public GmailMailbox(GmailClient client) {
        this.client = Objects.requireNonNull(client, "client must not be null");
    }

    @Override
    public FetchResult fetchNew(ResolvedConnection connection, String query, Instant after,
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
                messages.add(new Message(parsed.get().id(), parsed.get().internalDate(), parsed.get().input()));
            }
        }
        return new FetchResult(messages, notice);
    }
}
