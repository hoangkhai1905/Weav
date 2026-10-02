package com.weav.identity.application.notification;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class IdentitySecurityNotificationRecorderTest {

    private static final UUID USER_ID = UUID.fromString("11111111-1111-1111-1111-111111111111");
    private static final Instant NOW = Instant.parse("2026-09-27T04:05:06Z");

    @Test
    void recordsOnlyTheFourIdentitySecurityEnvelopesWithFreshIdsAndSafeSelfTargeting() {
        List<IdentityNotificationEvent> saved = new ArrayList<>();
        IdentitySecurityNotificationRecorder recorder = new IdentitySecurityNotificationRecorder(
                saved::add,
                Clock.fixed(NOW, ZoneOffset.UTC));

        recorder.record(IdentitySecurityEventType.PASSWORD_CHANGED, USER_ID);
        recorder.record(IdentitySecurityEventType.PASSWORD_RESET, USER_ID);
        recorder.record(IdentitySecurityEventType.GOOGLE_LINKED, USER_ID);
        recorder.record(IdentitySecurityEventType.GOOGLE_UNLINKED, USER_ID);

        assertEquals(4, saved.size());
        assertEnvelope(saved.get(0), "identity.password_changed", USER_ID);
        assertEnvelope(saved.get(1), "identity.password_reset", null);
        assertEnvelope(saved.get(2), "identity.google_linked", USER_ID);
        assertEnvelope(saved.get(3), "identity.google_unlinked", USER_ID);
        assertNotEquals(saved.get(0).eventId(), saved.get(1).eventId());
        assertNotEquals(saved.get(1).eventId(), saved.get(2).eventId());
        assertNotEquals(saved.get(2).eventId(), saved.get(3).eventId());
    }

    private static void assertEnvelope(
            IdentityNotificationEvent event,
            String eventType,
            UUID actorUserId) {
        assertEquals(2, event.schemaVersion());
        assertNotNull(event.eventId());
        assertEquals(eventType, event.eventType());
        assertEquals("2026-09-27T04:05:06Z", event.occurredAt());
        assertEquals("identity-service", event.producer());
        if (actorUserId == null) {
            assertNull(event.actorUserId());
        } else {
            assertEquals(actorUserId, event.actorUserId());
        }
        assertEquals(List.of(USER_ID), event.recipientUserIds());
        assertNull(event.workspaceId());
        assertEquals("USER", event.entity().kind());
        assertEquals(USER_ID, event.entity().id());
        assertTrue(event.data().isEmpty());
    }
}
