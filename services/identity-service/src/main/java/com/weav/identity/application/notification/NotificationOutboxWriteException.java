package com.weav.identity.application.notification;

/** Safe failure raised when an Identity event cannot be made durable with its mutation. */
public final class NotificationOutboxWriteException extends RuntimeException {
    public NotificationOutboxWriteException() {
        super("Identity security notification could not be persisted");
    }
}
