package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface OutboxEventRepository {
    OutboxEvent save(OutboxEvent event);

    List<OutboxEvent> findPending(int limit);

    List<OutboxEvent> claimPending(UUID leaseToken, Instant now, Instant leaseUntil, int limit);

    /**
     * When the earliest still-pending event becomes claimable (retry time or lease expiry); empty when none is
     * pending. One cheap partial-index read, used to size the idle sleep.
     */
    Optional<Instant> findEarliestPendingDue();

    boolean markPublished(UUID eventId, UUID leaseToken, Instant publishedAt);

    boolean scheduleRetry(UUID eventId, UUID leaseToken, Instant attemptedAt, Instant nextAttemptAt);
}
