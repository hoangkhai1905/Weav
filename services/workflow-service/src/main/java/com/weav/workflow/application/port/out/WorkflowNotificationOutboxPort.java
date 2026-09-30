package com.weav.workflow.application.port.out;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;

/** Transactional local persistence boundary for Workflow notification intents. */
public interface WorkflowNotificationOutboxPort {
    void record(WorkflowNotificationEvent event);
}
