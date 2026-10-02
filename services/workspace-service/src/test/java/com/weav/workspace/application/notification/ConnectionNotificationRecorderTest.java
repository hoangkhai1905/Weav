package com.weav.workspace.application.notification;

import com.weav.workspace.application.port.out.NotificationOutboxPort;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ConnectionNotificationRecorderTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OWNER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CREATOR_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final String OCCURRED_AT = "2026-01-02T03:04:05Z";

    private final RecordingOutbox outbox = new RecordingOutbox();
    private final WorkspaceRepository workspaces = mock(WorkspaceRepository.class);
    private final MembershipRepository memberships = mock(MembershipRepository.class);
    private final Map<UUID, Membership> currentMemberships = new HashMap<>();
    private ConnectionNotificationRecorder recorder;

    @BeforeEach
    void setUp() {
        Workspace workspace = new Workspace(
                WORKSPACE_ID,
                "Workspace name",
                OWNER_ID,
                Instant.parse(OCCURRED_AT),
                Instant.parse(OCCURRED_AT));
        when(workspaces.findById(WORKSPACE_ID)).thenReturn(Optional.of(workspace));
        when(memberships.findByWorkspaceIdAndUserId(eq(WORKSPACE_ID), any(UUID.class)))
                .thenAnswer(invocation -> Optional.ofNullable(currentMemberships.get(invocation.getArgument(1))));
        recorder = new ConnectionNotificationRecorder(
                outbox,
                workspaces,
                memberships,
                new ConnectionAuthorizationPolicy(),
                Clock.fixed(Instant.parse(OCCURRED_AT), ZoneOffset.UTC));
    }

    @Test
    void connectedRecordsExactEnvelopeAndSurrogateSafeNameSummary() {
        currentMemberships.put(CREATOR_ID, Membership.member(WORKSPACE_ID, CREATOR_ID));
        String longName = "x".repeat(198) + "😀" + "tail";

        recorder.recordConnected(connection(CREATOR_ID, longName), CREATOR_ID);

        WorkspaceNotificationEvent event = onlyEvent();
        assertThat(event.schemaVersion()).isEqualTo(2);
        assertThat(event.eventId()).isNotNull();
        assertThat(event.eventType()).isEqualTo("connection.connected");
        assertThat(event.occurredAt()).isEqualTo(OCCURRED_AT);
        assertThat(event.producer()).isEqualTo("workspace-service");
        assertThat(event.actorUserId()).isEqualTo(CREATOR_ID);
        assertThat(event.recipientUserIds()).containsExactly(CREATOR_ID);
        assertThat(event.workspaceId()).isEqualTo(WORKSPACE_ID);
        assertThat(event.entity()).isEqualTo(new WorkspaceNotificationEvent.Entity("CONNECTION", CONNECTION_ID));
        assertThat(event.data()).isEqualTo(
                new WorkspaceNotificationEvent.ConnectionNameData("x".repeat(198) + "…"));
        assertThat(((WorkspaceNotificationEvent.ConnectionNameData) event.data()).connectionName().length())
                .isLessThanOrEqualTo(200);
    }

    @Test
    void disabledNotifiesCurrentOwnerAndCreatorButRemovesTheActor() {
        currentMemberships.put(OWNER_ID, Membership.owner(WORKSPACE_ID, OWNER_ID));
        currentMemberships.put(CREATOR_ID, Membership.member(WORKSPACE_ID, CREATOR_ID));

        recorder.recordDisabled(connection(CREATOR_ID, "Connection name"), OWNER_ID);

        WorkspaceNotificationEvent event = onlyEvent();
        assertThat(event.eventType()).isEqualTo("connection.disabled");
        assertThat(event.actorUserId()).isEqualTo(OWNER_ID);
        assertThat(event.recipientUserIds()).containsExactly(CREATOR_ID);
        assertThat(event.entity().kind()).isEqualTo("CONNECTION");
        assertThat(event.entity().id()).isEqualTo(CONNECTION_ID);
        assertThat(event.data()).isEqualTo(new WorkspaceNotificationEvent.ConnectionNameData("Connection name"));
    }

    @Test
    void invalidNotifiesOwnerAndCreatorAndKeepsAnInteractiveActor() {
        currentMemberships.put(OWNER_ID, Membership.owner(WORKSPACE_ID, OWNER_ID));
        currentMemberships.put(CREATOR_ID, Membership.member(WORKSPACE_ID, CREATOR_ID));

        recorder.recordInvalid(connection(CREATOR_ID, "Connection name"), CREATOR_ID);

        WorkspaceNotificationEvent event = onlyEvent();
        assertThat(event.eventType()).isEqualTo("connection.invalid");
        assertThat(event.actorUserId()).isEqualTo(CREATOR_ID);
        assertThat(event.recipientUserIds()).containsExactly(OWNER_ID, CREATOR_ID);
    }

    @Test
    void internalInvalidUsesNullActorAndIncludesBothAuthorizedRecipients() {
        currentMemberships.put(OWNER_ID, Membership.owner(WORKSPACE_ID, OWNER_ID));
        currentMemberships.put(CREATOR_ID, Membership.member(WORKSPACE_ID, CREATOR_ID));

        recorder.recordInvalid(connection(CREATOR_ID, "Connection name"), null);

        WorkspaceNotificationEvent event = onlyEvent();
        assertThat(event.eventType()).isEqualTo("connection.invalid");
        assertThat(event.actorUserId()).isNull();
        assertThat(event.recipientUserIds()).containsExactly(OWNER_ID, CREATOR_ID);
    }

    @Test
    void removedCreatorAndMissingOwnerMembershipAreNotRecipients() {
        currentMemberships.put(CREATOR_ID, Membership.member(WORKSPACE_ID, CREATOR_ID));

        recorder.recordInvalid(connection(CREATOR_ID, "Connection name"), null);

        WorkspaceNotificationEvent event = onlyEvent();
        assertThat(event.recipientUserIds()).containsExactly(CREATOR_ID);
    }

    @Test
    void workspaceCreatorIsNotAnOwnerRecipientWithoutCurrentOwnerRole() {
        currentMemberships.put(OWNER_ID, Membership.member(WORKSPACE_ID, OWNER_ID));
        currentMemberships.put(CREATOR_ID, Membership.member(WORKSPACE_ID, CREATOR_ID));

        recorder.recordInvalid(connection(CREATOR_ID, "Connection name"), null);

        assertThat(onlyEvent().recipientUserIds()).containsExactly(CREATOR_ID);
    }

    @Test
    void duplicateOwnerCreatorIsCollapsedAndDisabledActorCanLeaveNoRecipients() {
        currentMemberships.put(OWNER_ID, Membership.owner(WORKSPACE_ID, OWNER_ID));

        recorder.recordDisabled(connection(OWNER_ID, "Connection name"), OWNER_ID);

        assertThat(outbox.events).isEmpty();

        recorder.recordInvalid(connection(OWNER_ID, "Connection name"), OWNER_ID);

        WorkspaceNotificationEvent event = onlyEvent();
        assertThat(event.recipientUserIds()).containsExactly(OWNER_ID);
    }

    private WorkspaceNotificationEvent onlyEvent() {
        assertThat(outbox.events).hasSize(1);
        return outbox.events.getFirst();
    }

    private Connection connection(UUID creatorId, String name) {
        return new Connection(
                CONNECTION_ID,
                WORKSPACE_ID,
                creatorId,
                name,
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                ConnectionStatus.DISABLED,
                Map.of(),
                null,
                Instant.parse(OCCURRED_AT),
                Instant.parse(OCCURRED_AT));
    }

    private static final class RecordingOutbox implements NotificationOutboxPort {
        private final List<WorkspaceNotificationEvent> events = new ArrayList<>();

        @Override
        public void append(WorkspaceNotificationEvent event) {
            events.add(event);
        }
    }
}
