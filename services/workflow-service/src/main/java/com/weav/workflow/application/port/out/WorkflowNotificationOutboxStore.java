package com.weav.workflow.application.port.out;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Durable notification outbox operations; external access and broker I/O happen after claims return. */
public interface WorkflowNotificationOutboxStore extends WorkflowNotificationOutboxPort {
    List<ClaimedEvent> claim(int batchSize, Duration leaseDuration);

    boolean renewClaim(UUID eventId, UUID claimToken, Duration leaseDuration);

    boolean markPublished(UUID eventId, UUID claimToken, Instant at);

    boolean markSkipped(UUID eventId, UUID claimToken, String reasonCode, Instant at);

    boolean scheduleRetry(UUID eventId, UUID claimToken, String reasonCode, Instant nextAttemptAt, Instant at);

    record ClaimedEvent(UUID eventId, String eventType, UUID workspaceId, UUID candidateUserId,
                        boolean requiresMonitorAccess, String payload, UUID claimToken, int retryCount) {
    }
}
