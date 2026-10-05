package com.weav.workflow.application.port.out;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Persistence boundary for the polling state of trigger.gmail registrations. */
public interface GmailTriggerPort {

    /** Active Gmail registrations whose next poll is due, most overdue first, at most {@code limit}. */
    List<Candidate> findDueGmail(Instant now, int limit);

    /** Moves the next poll instant; call inside the claim transaction that holds the trigger lock. */
    void advanceGmailPoll(UUID triggerId, Instant nextPollAt);

    /**
     * Own short transaction, no external call inside. Moves the cursor forward only (null or an older value
     * leaves it), stamps {@code lastTriggeredAt} when it moved, and sets {@code lastErrorCode} (null clears
     * the last error). Does nothing once the registration is no longer ACTIVE.
     */
    void recordGmailPoll(UUID triggerId, Instant newCursor, String lastErrorCode);

    record Candidate(UUID workflowId, UUID triggerId) {
    }
}
