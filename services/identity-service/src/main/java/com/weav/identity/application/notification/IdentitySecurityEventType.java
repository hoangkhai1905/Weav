package com.weav.identity.application.notification;

import java.util.UUID;

/** The allowlisted Identity security milestones supported by Notification v2. */
public enum IdentitySecurityEventType {
    PASSWORD_CHANGED("identity.password_changed", true),
    PASSWORD_RESET("identity.password_reset", false),
    GOOGLE_LINKED("identity.google_linked", true),
    GOOGLE_UNLINKED("identity.google_unlinked", true);

    private final String eventType;
    private final boolean authenticatedActor;

    IdentitySecurityEventType(String eventType, boolean authenticatedActor) {
        this.eventType = eventType;
        this.authenticatedActor = authenticatedActor;
    }

    public String eventType() {
        return eventType;
    }

    public UUID actorUserId(UUID userId) {
        return authenticatedActor ? userId : null;
    }

    static IdentitySecurityEventType fromEventType(String eventType) {
        for (IdentitySecurityEventType type : values()) {
            if (type.eventType.equals(eventType)) {
                return type;
            }
        }
        throw new IllegalArgumentException("Unsupported Identity security event type");
    }
}
