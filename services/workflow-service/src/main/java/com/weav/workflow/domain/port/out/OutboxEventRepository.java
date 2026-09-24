package com.weav.workflow.domain.port.out;

import com.weav.workflow.domain.model.aggregate.workflow.OutboxEvent;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface OutboxEventRepository {
    OutboxEvent save(OutboxEvent event);

    List<OutboxEvent> findPending(int limit);

    List<OutboxEvent> claimPending(UUID leaseToken, Instant now, Instant leaseUntil, int limit);

    boolean markPublished(UUID eventId, UUID leaseToken, Instant publishedAt);

    boolean scheduleRetry(UUID eventId, UUID leaseToken, Instant attemptedAt, Instant nextAttemptAt);
}
