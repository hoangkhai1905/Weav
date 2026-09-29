package com.weav.workspace.application.notification;

import com.weav.workspace.application.port.out.NotificationOutboxPort;
import java.time.Clock;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/** Builds stable v2 envelopes and synchronously appends them to the local transaction's outbox. */
public final class WorkspaceNotificationRecorder {
    private static final String PRODUCER = "workspace-service";
    private static final int RECIPIENT_BATCH_SIZE = 100;
    private static final int MAX_NOTIFICATION_NAME_UNITS = 200;
    private static final DateTimeFormatter UTC_INSTANT = DateTimeFormatter.ISO_INSTANT;

    private final NotificationOutboxPort outbox;
    private final Clock clock;

    public WorkspaceNotificationRecorder(NotificationOutboxPort outbox, Clock clock) {
        this.outbox = Objects.requireNonNull(outbox);
        this.clock = Objects.requireNonNull(clock);
    }

    public void recordCreated(UUID workspaceId, UUID creatorUserId, String workspaceName) {
        append("workspace.created", workspaceId, creatorUserId, List.of(creatorUserId),
                new WorkspaceNotificationEvent.WorkspaceNameData(summarizeName(workspaceName)));
    }

    public void recordRenamed(
            UUID workspaceId, UUID actorUserId, String workspaceName, List<UUID> currentMemberIds) {
        List<UUID> recipients = currentMemberIds.stream()
                .filter(userId -> !userId.equals(actorUserId))
                .distinct()
                .sorted(Comparator.comparing(UUID::toString))
                .toList();
        for (int start = 0; start < recipients.size(); start += RECIPIENT_BATCH_SIZE) {
            List<UUID> batch = recipients.subList(start, Math.min(start + RECIPIENT_BATCH_SIZE, recipients.size()));
            append("workspace.renamed", workspaceId, actorUserId, batch,
                    new WorkspaceNotificationEvent.WorkspaceNameData(summarizeName(workspaceName)));
        }
    }

    public void recordMemberAdded(UUID workspaceId, UUID actorUserId, UUID subjectUserId, String workspaceName) {
        recordMembership("workspace.member_added", workspaceId, actorUserId, subjectUserId, workspaceName);
    }

    public void recordMemberRemoved(UUID workspaceId, UUID actorUserId, UUID subjectUserId, String workspaceName) {
        recordMembership("workspace.member_removed", workspaceId, actorUserId, subjectUserId, workspaceName);
    }

    public void recordMemberPermissionsUpdated(
            UUID workspaceId, UUID actorUserId, UUID subjectUserId, String workspaceName) {
        recordMembership("workspace.member_permissions_updated", workspaceId,
                actorUserId, subjectUserId, workspaceName);
    }

    public void recordMemberLeft(
            UUID workspaceId, UUID leavingUserId, UUID ownerUserId, String workspaceName) {
        recordMembership("workspace.member_left", workspaceId, leavingUserId, ownerUserId, workspaceName,
                leavingUserId);
    }

    private void recordMembership(
            String eventType, UUID workspaceId, UUID actorUserId, UUID subjectUserId, String workspaceName) {
        recordMembership(eventType, workspaceId, actorUserId, subjectUserId, workspaceName, subjectUserId);
    }

    private void recordMembership(
            String eventType,
            UUID workspaceId,
            UUID actorUserId,
            UUID recipientUserId,
            String workspaceName,
            UUID subjectUserId) {
        append(eventType, workspaceId, actorUserId, List.of(recipientUserId),
                new WorkspaceNotificationEvent.MembershipData(summarizeName(workspaceName), subjectUserId));
    }

    private void append(
            String eventType, UUID workspaceId, UUID actorUserId, List<UUID> recipients,
            WorkspaceNotificationEvent.Data data) {
        WorkspaceNotificationEvent event = new WorkspaceNotificationEvent(
                2,
                UUID.randomUUID(),
                eventType,
                UTC_INSTANT.format(clock.instant()),
                PRODUCER,
                actorUserId,
                new ArrayList<>(recipients),
                workspaceId,
                new WorkspaceNotificationEvent.Entity("WORKSPACE", workspaceId),
                data);
        outbox.append(event);
    }

    static String summarizeName(String workspaceName) {
        Objects.requireNonNull(workspaceName);
        if (workspaceName.length() <= MAX_NOTIFICATION_NAME_UNITS) {
            return workspaceName;
        }
        int prefixLength = MAX_NOTIFICATION_NAME_UNITS - 1;
        if (Character.isHighSurrogate(workspaceName.charAt(prefixLength - 1))) {
            prefixLength--;
        }
        return workspaceName.substring(0, prefixLength) + '\u2026';
    }
}
