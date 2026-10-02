package com.weav.workspace.application.notification;

import com.weav.workspace.application.port.out.NotificationOutboxPort;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.time.Clock;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Appends allowlisted connection lifecycle events to the current Workspace transaction's outbox. */
public final class ConnectionNotificationRecorder {
    private static final String PRODUCER = "workspace-service";
    private static final DateTimeFormatter UTC_INSTANT = DateTimeFormatter.ISO_INSTANT;

    private final NotificationOutboxPort outbox;
    private final WorkspaceRepository workspaces;
    private final MembershipRepository memberships;
    private final ConnectionAuthorizationPolicy authorizationPolicy;
    private final Clock clock;

    public ConnectionNotificationRecorder(
            NotificationOutboxPort outbox,
            WorkspaceRepository workspaces,
            MembershipRepository memberships,
            ConnectionAuthorizationPolicy authorizationPolicy,
            Clock clock) {
        this.outbox = Objects.requireNonNull(outbox);
        this.workspaces = Objects.requireNonNull(workspaces);
        this.memberships = Objects.requireNonNull(memberships);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
        this.clock = Objects.requireNonNull(clock);
    }

    public void recordConnected(Connection connection, UUID actorUserId) {
        Objects.requireNonNull(actorUserId, "actorUserId");
        append("connection.connected", connection, actorUserId, List.of(actorUserId));
    }

    public void recordDisabled(Connection connection, UUID actorUserId) {
        Objects.requireNonNull(actorUserId, "actorUserId");
        List<UUID> recipients = currentAuthorizedRecipients(connection).stream()
                .filter(userId -> !userId.equals(actorUserId))
                .toList();
        appendIfRecipients("connection.disabled", connection, actorUserId, recipients);
    }

    public void recordInvalid(Connection connection, UUID actorUserIdOrNull) {
        appendIfRecipients("connection.invalid", connection, actorUserIdOrNull,
                currentAuthorizedRecipients(connection));
    }

    private List<UUID> currentAuthorizedRecipients(Connection connection) {
        Objects.requireNonNull(connection);
        Optional<Workspace> workspace = workspaces.findById(connection.getWorkspaceId());
        if (workspace.isEmpty()) {
            return List.of();
        }

        LinkedHashSet<UUID> recipients = new LinkedHashSet<>();
        UUID ownerUserId = workspace.get().getCreatedBy();
        memberships.findByWorkspaceIdAndUserId(connection.getWorkspaceId(), ownerUserId)
                .filter(membership -> membership.getRole() == MembershipRole.OWNER)
                .filter(membership -> authorizationPolicy.canViewConfig(membership, connection))
                .ifPresent(membership -> recipients.add(membership.getUserId()));

        memberships.findByWorkspaceIdAndUserId(connection.getWorkspaceId(), connection.getCreatedBy())
                .filter(membership -> authorizationPolicy.canViewConfig(membership, connection))
                .ifPresent(membership -> recipients.add(membership.getUserId()));

        return recipients.stream().sorted(Comparator.comparing(UUID::toString)).toList();
    }

    private void appendIfRecipients(
            String eventType, Connection connection, UUID actorUserId, List<UUID> recipients) {
        if (!recipients.isEmpty()) {
            append(eventType, connection, actorUserId, recipients);
        }
    }

    private void append(String eventType, Connection connection, UUID actorUserId, List<UUID> recipients) {
        Objects.requireNonNull(connection);
        WorkspaceNotificationEvent event = new WorkspaceNotificationEvent(
                2,
                UUID.randomUUID(),
                eventType,
                UTC_INSTANT.format(clock.instant()),
                PRODUCER,
                actorUserId,
                new ArrayList<>(recipients),
                connection.getWorkspaceId(),
                new WorkspaceNotificationEvent.Entity("CONNECTION", connection.getId()),
                new WorkspaceNotificationEvent.ConnectionNameData(
                        WorkspaceNotificationRecorder.summarizeName(connection.getName())));
        outbox.append(event);
    }
}
