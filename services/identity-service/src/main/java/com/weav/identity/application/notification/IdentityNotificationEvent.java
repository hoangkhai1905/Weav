package com.weav.identity.application.notification;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Immutable, safe Identity-to-Notification v2 security envelope. */
public record IdentityNotificationEvent(
        int schemaVersion,
        UUID eventId,
        String eventType,
        String occurredAt,
        String producer,
        UUID actorUserId,
        List<UUID> recipientUserIds,
        UUID workspaceId,
        Entity entity,
        Map<String, Object> data) {

    public IdentityNotificationEvent {
        if (schemaVersion != 2) {
            throw new IllegalArgumentException("Identity notifications require schema version 2");
        }
        Objects.requireNonNull(eventId, "eventId must not be null");
        IdentitySecurityEventType type = IdentitySecurityEventType.fromEventType(
                Objects.requireNonNull(eventType, "eventType must not be null"));
        Objects.requireNonNull(occurredAt, "occurredAt must not be null");
        if (!"identity-service".equals(producer)) {
            throw new IllegalArgumentException("Identity notification producer is invalid");
        }
        Objects.requireNonNull(recipientUserIds, "recipientUserIds must not be null");
        recipientUserIds = List.copyOf(recipientUserIds);
        Objects.requireNonNull(entity, "entity must not be null");
        Objects.requireNonNull(data, "data must not be null");
        data = Map.copyOf(data);
        if (workspaceId != null
                || recipientUserIds.size() != 1
                || !"USER".equals(entity.kind())
                || !recipientUserIds.getFirst().equals(entity.id())
                || !data.isEmpty()
                || !Objects.equals(type.actorUserId(entity.id()), actorUserId)) {
            throw new IllegalArgumentException("Identity security notification envelope is invalid");
        }
    }

    public record Entity(String kind, UUID id) {
        public Entity {
            Objects.requireNonNull(kind, "entity kind must not be null");
            Objects.requireNonNull(id, "entity id must not be null");
        }
    }
}
