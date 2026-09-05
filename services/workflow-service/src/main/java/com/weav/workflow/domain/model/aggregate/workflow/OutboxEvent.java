package com.weav.workflow.domain.model.aggregate.workflow;

import com.weav.workflow.domain.valueobject.OutboxStatus;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public class OutboxEvent {
    private final UUID id; private final String aggregateType; private final UUID aggregateId; private final String eventType;
    private final Map<String,Object> payload; private OutboxStatus status; private final Instant createdAt; private Instant publishedAt; private Integer retryCount;
    public OutboxEvent(UUID id, String aggregateType, UUID aggregateId, String eventType, Map<String,Object> payload,
                       OutboxStatus status, Instant createdAt, Instant publishedAt, Integer retryCount) {
        this.id=Objects.requireNonNull(id); this.aggregateType=Objects.requireNonNull(aggregateType); this.aggregateId=Objects.requireNonNull(aggregateId); this.eventType=Objects.requireNonNull(eventType);
        this.payload=payload==null?Map.of():Map.copyOf(payload); this.status=Objects.requireNonNull(status); this.createdAt=Objects.requireNonNull(createdAt); this.publishedAt=publishedAt; this.retryCount=retryCount==null?0:retryCount;
    }
    public static OutboxEvent pending(String aggregateType, UUID aggregateId, String eventType, Map<String,Object> payload) {
        return new OutboxEvent(UUID.randomUUID(), aggregateType, aggregateId, eventType, payload, OutboxStatus.PENDING, Instant.now(), null, 0);
    }
    public void publish(Instant at){status=OutboxStatus.PUBLISHED; publishedAt=at;} public void retry(){retryCount++; status=OutboxStatus.FAILED;}
    public UUID getId(){return id;} public String getAggregateType(){return aggregateType;} public UUID getAggregateId(){return aggregateId;} public String getEventType(){return eventType;}
    public Map<String,Object> getPayload(){return payload;} public OutboxStatus getStatus(){return status;} public Instant getCreatedAt(){return createdAt;} public Instant getPublishedAt(){return publishedAt;} public Integer getRetryCount(){return retryCount;}
}