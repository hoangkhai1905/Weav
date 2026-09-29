package com.weav.workspace.application.notification;

/** Safe signal for an outbox append failure; deliberately carries no persistence payload or cause. */
public final class NotificationOutboxWriteException extends RuntimeException {
    public NotificationOutboxWriteException() {
        super("Could not persist Workspace notification outbox event");
    }
}
