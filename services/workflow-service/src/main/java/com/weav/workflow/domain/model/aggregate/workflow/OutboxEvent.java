package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.valueobject.OutboxStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Durable delivery intent; publisher leases do not consume node-attempt budget. */
public class OutboxEvent {
    private final UUID id;
    private final String aggregateType;
    private final UUID aggregateId;
    private final String eventType;
    private final Map<String, Object> payload;
    private OutboxStatus status;
    private final Instant createdAt;
    private Instant publishedAt;
    private Integer retryCount;
    private UUID publisherLeaseToken;
    private Instant publisherLeaseUntil;
    private Instant nextAttemptAt;

    public OutboxEvent(UUID id, String aggregateType, UUID aggregateId, String eventType,
                       Map<String, Object> payload, OutboxStatus status, Instant createdAt,
                       Instant publishedAt, Integer retryCount) {
        this(id, aggregateType, aggregateId, eventType, payload, status, createdAt, publishedAt,
                retryCount, null, null, createdAt);
    }

    public OutboxEvent(UUID id, String aggregateType, UUID aggregateId, String eventType,
                       Map<String, Object> payload, OutboxStatus status, Instant createdAt,
                       Instant publishedAt, Integer retryCount, UUID publisherLeaseToken,
                       Instant publisherLeaseUntil, Instant nextAttemptAt) {
        this.id = Objects.requireNonNull(id);
        this.aggregateType = Objects.requireNonNull(aggregateType);
        this.aggregateId = Objects.requireNonNull(aggregateId);
        this.eventType = Objects.requireNonNull(eventType);
        this.payload = JsonValues.freezeMap(payload);
        this.status = Objects.requireNonNull(status);
        this.createdAt = Objects.requireNonNull(createdAt);
        this.publishedAt = publishedAt;
        this.retryCount = retryCount == null ? 0 : Math.max(0, retryCount);
        this.publisherLeaseToken = publisherLeaseToken;
        this.publisherLeaseUntil = publisherLeaseUntil;
        this.nextAttemptAt = nextAttemptAt == null ? createdAt : nextAttemptAt;
    }

    public static OutboxEvent pending(String aggregateType, UUID aggregateId, String eventType,
                                      Map<String, Object> payload) {
        Instant now = Instant.now();
        return new OutboxEvent(UUID.randomUUID(), aggregateType, aggregateId, eventType, payload,
                OutboxStatus.PENDING, now, null, 0, null, null, now);
    }

    public OutboxEvent claim(UUID leaseToken, Instant leaseUntil) {
        if (status != OutboxStatus.PENDING) {
            throw new IllegalStateException("Only pending outbox events can be claimed");
        }
        publisherLeaseToken = Objects.requireNonNull(leaseToken);
        publisherLeaseUntil = Objects.requireNonNull(leaseUntil);
        return this;
    }

    public void publish(Instant at) {
        status = OutboxStatus.PUBLISHED;
        publishedAt = Objects.requireNonNull(at);
        publisherLeaseToken = null;
        publisherLeaseUntil = null;
    }

    public void scheduleRetry(Instant nextAttemptAt) {
        if (status != OutboxStatus.PENDING) {
            throw new IllegalStateException("Only pending outbox events can be retried");
        }
        if (retryCount < Integer.MAX_VALUE) {
            retryCount++;
        }
        publisherLeaseToken = null;
        publisherLeaseUntil = null;
        this.nextAttemptAt = Objects.requireNonNull(nextAttemptAt);
    }

    /** Retains the legacy transition method while keeping delivery intent retryable. */
    public void retry() {
        scheduleRetry(Instant.now());
    }

    public UUID getId() { return id; }
    public String getAggregateType() { return aggregateType; }
    public UUID getAggregateId() { return aggregateId; }
    public String getEventType() { return eventType; }
    public Map<String, Object> getPayload() { return payload; }
    public OutboxStatus getStatus() { return status; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getPublishedAt() { return publishedAt; }
    public Integer getRetryCount() { return retryCount; }
    public UUID getPublisherLeaseToken() { return publisherLeaseToken; }
    public Instant getPublisherLeaseUntil() { return publisherLeaseUntil; }
    public Instant getNextAttemptAt() { return nextAttemptAt; }
}
