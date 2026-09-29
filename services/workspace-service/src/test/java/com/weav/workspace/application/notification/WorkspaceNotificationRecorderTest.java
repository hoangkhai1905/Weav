package com.weav.workspace.application.notification;

import com.weav.workspace.application.port.out.NotificationOutboxPort;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;

class WorkspaceNotificationRecorderTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OWNER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID OTHER_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final String OCCURRED_AT = "2026-01-02T03:04:05Z";

    private final ObjectMapper objectMapper = new ObjectMapper();
    private RecordingOutbox outbox;
    private WorkspaceNotificationRecorder recorder;

    @BeforeEach
    void setUp() {
        outbox = new RecordingOutbox();
        recorder = new WorkspaceNotificationRecorder(
                outbox,
                Clock.fixed(Instant.parse(OCCURRED_AT), ZoneOffset.UTC));
    }

    @Test
    void createdAndRenamedSerializeOnlyTheApprovedEnvelopeFields() throws Exception {
        recorder.recordCreated(WORKSPACE_ID, OWNER_ID, "Team space");
        recorder.recordRenamed(WORKSPACE_ID, OWNER_ID, "New name", List.of(OWNER_ID, MEMBER_ID));

        assertThat(outbox.events).hasSize(2);
        JsonNode created = objectMapper.readTree(objectMapper.writeValueAsBytes(outbox.events.get(0)));
        assertThat(fieldNames(created)).containsExactlyInAnyOrder(
                "schemaVersion", "eventId", "eventType", "occurredAt", "producer",
                "actorUserId", "recipientUserIds", "workspaceId", "entity", "data");
        assertThat(created.path("schemaVersion").intValue()).isEqualTo(2);
        assertThat(created.path("eventType").textValue()).isEqualTo("workspace.created");
        assertThat(created.path("occurredAt").textValue()).isEqualTo(OCCURRED_AT);
        assertThat(created.path("producer").textValue()).isEqualTo("workspace-service");
        assertThat(created.path("actorUserId").textValue()).isEqualTo(OWNER_ID.toString());
        assertThat(created.path("recipientUserIds").toString()).isEqualTo("[\"" + OWNER_ID + "\"]");
        assertThat(created.path("workspaceId").textValue()).isEqualTo(WORKSPACE_ID.toString());
        assertThat(created.path("entity").path("kind").textValue()).isEqualTo("WORKSPACE");
        assertThat(created.path("entity").path("id").textValue()).isEqualTo(WORKSPACE_ID.toString());
        assertThat(fieldNames(created.path("data"))).containsExactly("workspaceName");
        assertThat(created.path("data").path("workspaceName").textValue()).isEqualTo("Team space");

        JsonNode renamed = objectMapper.readTree(objectMapper.writeValueAsBytes(outbox.events.get(1)));
        assertThat(renamed.path("eventType").textValue()).isEqualTo("workspace.renamed");
        assertThat(renamed.path("recipientUserIds").toString()).isEqualTo("[\"" + MEMBER_ID + "\"]");
        assertThat(renamed.path("data").path("workspaceName").textValue()).isEqualTo("New name");
    }

    @Test
    void membershipEventsUseTheSubjectAsRecipientAndLeaveTargetsTheOwner() {
        recorder.recordMemberAdded(WORKSPACE_ID, OWNER_ID, MEMBER_ID, "Team space");
        recorder.recordMemberRemoved(WORKSPACE_ID, OWNER_ID, MEMBER_ID, "Team space");
        recorder.recordMemberPermissionsUpdated(WORKSPACE_ID, OWNER_ID, MEMBER_ID, "Team space");
        recorder.recordMemberLeft(WORKSPACE_ID, MEMBER_ID, OWNER_ID, "Team space");

        assertThat(outbox.events).hasSize(4);
        assertMembershipEvent(outbox.events.get(0), "workspace.member_added", OWNER_ID, MEMBER_ID, MEMBER_ID);
        assertMembershipEvent(outbox.events.get(1), "workspace.member_removed", OWNER_ID, MEMBER_ID, MEMBER_ID);
        assertMembershipEvent(
                outbox.events.get(2), "workspace.member_permissions_updated", OWNER_ID, MEMBER_ID, MEMBER_ID);
        assertMembershipEvent(outbox.events.get(3), "workspace.member_left", MEMBER_ID, OWNER_ID, MEMBER_ID);
    }

    @Test
    void renameRecipientsAreSortedDeduplicatedAndSplitIntoHundredRecipientBatches() {
        UUID actor = UUID.fromString("ffffffff-ffff-ffff-ffff-ffffffffffff");
        List<UUID> orderedRecipients = IntStream.rangeClosed(1, 201)
                .mapToObj(WorkspaceNotificationRecorderTest::numberedUser)
                .toList();
        List<UUID> shuffledWithDuplicates = new ArrayList<>(orderedRecipients);
        shuffledWithDuplicates.add(actor);
        shuffledWithDuplicates.add(orderedRecipients.get(3));
        shuffledWithDuplicates.add(orderedRecipients.get(150));
        java.util.Collections.reverse(shuffledWithDuplicates);

        recorder.recordRenamed(WORKSPACE_ID, actor, "Team space", shuffledWithDuplicates);

        assertThat(outbox.events).hasSize(3);
        assertThat(outbox.events).extracting(event -> event.recipientUserIds().size())
                .containsExactly(100, 100, 1);
        List<UUID> actual = outbox.events.stream()
                .flatMap(event -> event.recipientUserIds().stream())
                .toList();
        List<UUID> expected = shuffledWithDuplicates.stream()
                .filter(userId -> !userId.equals(actor))
                .distinct()
                .sorted(Comparator.comparing(UUID::toString))
                .toList();
        assertThat(actual).containsExactlyElementsOf(expected);
        assertThat(new HashSet<>(actual)).hasSize(201);
        assertThat(outbox.events).extracting(WorkspaceNotificationEvent::eventId)
                .doesNotHaveDuplicates();
    }

    @Test
    void renameWithNoOtherMembersDoesNotAppendAnInvalidEmptyRecipientEvent() {
        recorder.recordRenamed(WORKSPACE_ID, OWNER_ID, "Only owner", List.of(OWNER_ID));

        assertThat(outbox.events).isEmpty();
    }

    @Test
    void workspaceNameSummaryRespectsTwoHundredUtf16UnitsWithoutSplittingSurrogatePairs() {
        recorder.recordCreated(WORKSPACE_ID, OWNER_ID, "x".repeat(200));
        recorder.recordCreated(WORKSPACE_ID, OWNER_ID, "x".repeat(201));
        recorder.recordCreated(WORKSPACE_ID, OWNER_ID, "x".repeat(255));
        recorder.recordCreated(WORKSPACE_ID, OWNER_ID, "x".repeat(198) + "😀" + "tail");
        recorder.recordCreated(WORKSPACE_ID, OWNER_ID, "x".repeat(197) + "😀" + "tail");

        List<String> names = outbox.events.stream()
                .map(event -> ((WorkspaceNotificationEvent.WorkspaceNameData) event.data()).workspaceName())
                .toList();
        assertThat(names.get(0)).isEqualTo("x".repeat(200));
        assertThat(names.get(1)).isEqualTo("x".repeat(199) + "…");
        assertThat(names.get(2)).isEqualTo("x".repeat(199) + "…");
        assertThat(names.get(3)).isEqualTo("x".repeat(198) + "…");
        assertThat(names.get(4)).isEqualTo("x".repeat(197) + "😀" + "…");
        assertThat(names).allSatisfy(name -> assertThat(name.length()).isLessThanOrEqualTo(200));
        assertThat(Character.isHighSurrogate(names.get(3).charAt(names.get(3).length() - 2))).isFalse();
    }

    private void assertMembershipEvent(
            WorkspaceNotificationEvent event,
            String eventType,
            UUID actor,
            UUID recipient,
            UUID subject) {
        assertThat(event.eventType()).isEqualTo(eventType);
        assertThat(event.actorUserId()).isEqualTo(actor);
        assertThat(event.recipientUserIds()).containsExactly(recipient);
        assertThat(event.workspaceId()).isEqualTo(WORKSPACE_ID);
        assertThat(event.entity()).isEqualTo(new WorkspaceNotificationEvent.Entity("WORKSPACE", WORKSPACE_ID));
        assertThat(event.data()).isEqualTo(new WorkspaceNotificationEvent.MembershipData("Team space", subject));
    }

    private static UUID numberedUser(int number) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(number));
    }

    private static List<String> fieldNames(JsonNode node) {
        List<String> names = new ArrayList<>();
        node.propertyStream().map(java.util.Map.Entry::getKey).forEach(names::add);
        return names;
    }

    private static final class RecordingOutbox implements NotificationOutboxPort {
        private final List<WorkspaceNotificationEvent> events = new ArrayList<>();

        @Override
        public void append(WorkspaceNotificationEvent event) {
            events.add(event);
        }
    }
}
