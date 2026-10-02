package com.weav.workspace.application.port.out;

import com.weav.workspace.application.notification.WorkspaceNotificationEvent;

/** Appends an immutable notification envelope inside the caller's database transaction. */
public interface NotificationOutboxPort {
    void append(WorkspaceNotificationEvent event);
}
