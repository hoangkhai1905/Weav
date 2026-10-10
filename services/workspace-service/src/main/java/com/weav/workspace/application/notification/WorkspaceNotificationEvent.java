package com.weav.workspace.application.notification;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Immutable, allowlisted Workspace-to-Notification v2 envelope. */
public record WorkspaceNotificationEvent(
        int schemaVersion,
        UUID eventId,
        String eventType,
        String occurredAt,
        String producer,
        UUID actorUserId,
        List<UUID> recipientUserIds,
        UUID workspaceId,
        Entity entity,
        Data data) {

    public WorkspaceNotificationEvent {
        if (schemaVersion != 2) {
            throw new IllegalArgumentException("Workspace notifications require schema version 2");
        }
        Objects.requireNonNull(eventId);
        Objects.requireNonNull(eventType);
        Objects.requireNonNull(occurredAt);
        Objects.requireNonNull(producer);
        recipientUserIds = List.copyOf(recipientUserIds);
        if (recipientUserIds.isEmpty() || recipientUserIds.size() > 100
                || recipientUserIds.stream().distinct().count() != recipientUserIds.size()) {
            throw new IllegalArgumentException("Workspace notification recipients must be 1-100 unique IDs");
        }
        Objects.requireNonNull(workspaceId);
        Objects.requireNonNull(entity);
        Objects.requireNonNull(data);
        if (actorUserId == null
                && !("connection.invalid".equals(eventType)
                && "CONNECTION".equals(entity.kind())
                && data instanceof ConnectionNameData)) {
            throw new NullPointerException("actorUserId");
        }
    }

    public record Entity(String kind, UUID id) {
        public Entity {
            Objects.requireNonNull(kind);
            Objects.requireNonNull(id);
        }
    }

    public sealed interface Data permits WorkspaceNameData, MembershipData, ConnectionNameData, InvitationData {}

    public record ConnectionNameData(String connectionName) implements Data {
        public ConnectionNameData {
            Objects.requireNonNull(connectionName);
        }
    }

    public record WorkspaceNameData(String workspaceName) implements Data {
        public WorkspaceNameData {
            Objects.requireNonNull(workspaceName);
        }
    }

    public record MembershipData(String workspaceName, UUID subjectUserId) implements Data {
        public MembershipData {
            Objects.requireNonNull(workspaceName);
            Objects.requireNonNull(subjectUserId);
        }
    }

    public record InvitationData(
            String workspaceName, String inviteeEmail, String inviterName, String expiresAt) implements Data {
        public InvitationData {
            Objects.requireNonNull(workspaceName);
            Objects.requireNonNull(inviteeEmail);
            Objects.requireNonNull(inviterName);
            Objects.requireNonNull(expiresAt);
        }
    }
}
