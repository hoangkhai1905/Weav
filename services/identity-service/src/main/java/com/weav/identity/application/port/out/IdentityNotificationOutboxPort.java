package com.weav.identity.application.port.out;

import com.weav.identity.application.notification.IdentityNotificationEvent;

/** Stores an immutable Identity notification in the caller's database transaction. */
public interface IdentityNotificationOutboxPort {
    void append(IdentityNotificationEvent event);
}
