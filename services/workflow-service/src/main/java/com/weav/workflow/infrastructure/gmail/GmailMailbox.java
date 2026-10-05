package com.weav.workflow.infrastructure.gmail;

import com.weav.workflow.application.port.out.GmailMailboxPort;
import com.weav.workflow.application.port.out.ResolvedConnection;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/** Lists then reads new Gmail messages for the polling trigger. */
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
    public FetchResult fetchNew(ResolvedConnection connection, String query, Instant after, int max) {
        // after: floors to the second, so ask from one second earlier and drop anything older than the cursor
        // below; an email with exactly the cursor time is listed again and deduped by its idempotency key.
        String q = (query == null || query.isBlank() ? "" : query.strip() + " ")
                + "after:" + Math.max(0, after.getEpochSecond() - 1);
        GmailClient.Listing listing = client.listMessageIds(q, connection);
        // The list is newest first; take the OLDEST max so the cursor never jumps over unread mail.
        List<String> ids = listing.ids();
        List<String> oldest = ids.subList(Math.max(0, ids.size() - max), ids.size());
        List<Message> messages = new ArrayList<>();
        String notice = listing.truncated() ? BACKLOG_TRUNCATED : null;
        if (listing.truncated()) {
            logger.warn("event=gmail_backlog_truncated bound={}", GmailClient.LIST_BOUND);
        }
        for (String id : oldest) {
            GmailClient.MessageRead read = client.getMessage(id, connection);
            if (read.json() == null) {
                logger.warn("event=gmail_message_skipped reason={} messageId={}", read.skippedCode(), id);
                notice = SKIPPED;
                continue;
            }
            var parsed = GmailMessageParser.parse(read.json(), read.bodyOmitted());
            if (parsed.isEmpty()) {
                logger.warn("event=gmail_message_skipped reason=UNPARSEABLE messageId={}", id);
                notice = SKIPPED;
            } else if (!parsed.get().internalDate().isBefore(after)) {
                messages.add(new Message(parsed.get().id(), parsed.get().internalDate(), parsed.get().input()));
            }
        }
        messages.sort(Comparator.comparing(Message::internalDate).thenComparing(Message::id));
        return new FetchResult(messages, notice);
    }
}
