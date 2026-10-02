package com.weav.identity.application.notification;

import com.weav.identity.application.port.out.IdentityNotificationOutboxPort;

import java.time.Clock;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Builds allowlisted self-targeted envelopes and appends them within the caller transaction. */
public final class IdentitySecurityNotificationRecorder {
    private static final DateTimeFormatter UTC_INSTANT = DateTimeFormatter.ISO_INSTANT;

    private final IdentityNotificationOutboxPort outbox;
    private final Clock clock;

    public IdentitySecurityNotificationRecorder(IdentityNotificationOutboxPort outbox, Clock clock) {
        this.outbox = Objects.requireNonNull(outbox);
        this.clock = Objects.requireNonNull(clock);
    }

    public void record(IdentitySecurityEventType eventType, UUID userId) {
        Objects.requireNonNull(eventType, "eventType must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        outbox.append(new IdentityNotificationEvent(
                2,
                UUID.randomUUID(),
                eventType.eventType(),
                UTC_INSTANT.format(clock.instant()),
                "identity-service",
                eventType.actorUserId(userId),
                List.of(userId),
                null,
                new IdentityNotificationEvent.Entity("USER", userId),
                Map.of()));
    }
}
