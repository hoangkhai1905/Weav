package com.weav.workflow.application.notification;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class WorkflowNotificationEventTest {
    @Test
    void notificationSummaryTrimsLeadingBusinessWhitespaceBeforeApplyingTheLimit() {
        String businessName = " ".repeat(200) + "Report";

        String summary = WorkflowNotificationEvent.safeName(businessName);

        assertEquals(206, businessName.length());
        assertEquals("Report", summary);
    }

    @Test
    void notificationSummaryUsesSafeFallbackWhenBusinessNameHasNoConsumerVisibleText() {
        String businessName = "\u00A0\uFEFF";

        String summary = WorkflowNotificationEvent.safeName(businessName);

        assertFalse(businessName.isBlank());
        assertEquals("Workflow", summary);
    }

    @Test
    void notificationNameStillRejectsNullAndBusinessBlankValues() {
        assertThrows(IllegalArgumentException.class, () -> WorkflowNotificationEvent.safeName(null));
        assertThrows(IllegalArgumentException.class, () -> WorkflowNotificationEvent.safeName(" \t "));
    }

    @Test
    void notificationNameIsCappedAtTwoHundredUtf16UnitsWithoutSplittingASurrogatePair() {
        String input = "a".repeat(199) + "😀" + "tail";

        String safeName = WorkflowNotificationEvent.safeName(input);

        assertEquals(199, safeName.length());
        assertEquals("a".repeat(199), safeName);
    }

    @Test
    void notificationNamePreservesAWholePairAtTheBoundary() {
        String input = "a".repeat(198) + "😀" + "tail";

        String safeName = WorkflowNotificationEvent.safeName(input);

        assertEquals(200, safeName.length());
        assertEquals("😀", safeName.substring(198));
    }

    @Test
    void lifecycleFactoryRejectsBlankNamesAndUnsupportedEventTypes() {
        UUID workspaceId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();

        assertThrows(IllegalArgumentException.class, () -> WorkflowNotificationEvent.lifecycle(
                "workflow.created", workspaceId, actorId, workflowId, " \t ", Instant.now()));
        assertThrows(IllegalArgumentException.class, () -> WorkflowNotificationEvent.lifecycle(
                "workflow.deleted", workspaceId, actorId, workflowId, "Name", Instant.now()));
    }
    @Test
    void alertFactoriesBuildMonitorGatedExecutionEventsWithCountStrings() {
        UUID workspaceId = UUID.randomUUID();
        UUID recipientId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();

        WorkflowNotificationEvent failures = WorkflowNotificationEvent.consecutiveFailuresAlert(
                workspaceId, recipientId, executionId, workflowId, "Sync", " Rule ", 3, Instant.now());
        WorkflowNotificationEvent slow = WorkflowNotificationEvent.longRunningAlert(
                workspaceId, recipientId, executionId, workflowId, "Sync", "Slow", 125, 60, Instant.now());

        assertEquals("monitoring.alert.consecutive_failures", failures.eventType());
        assertEquals("EXECUTION", failures.entityKind());
        assertEquals(executionId, failures.entityId());
        assertEquals(true, failures.requiresMonitorAccess());
        assertEquals("Rule", failures.data().get("ruleName"));
        assertEquals("3", failures.data().get("failureCount"));
        assertEquals("125", slow.data().get("durationSeconds"));
        assertEquals("60", slow.data().get("thresholdSeconds"));
    }

    @Test
    void alertEventsRejectWrongShapeOrUnboundedNumbers() {
        UUID workspaceId = UUID.randomUUID();
        UUID recipientId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        java.util.Map<String, String> data = java.util.Map.of("ruleName", "R", "workflowName", "W",
                "workflowId", workflowId.toString(), "failureCount", "x");

        assertThrows(IllegalArgumentException.class, () -> new WorkflowNotificationEvent(
                "monitoring.alert.consecutive_failures", Instant.now(), workspaceId, null, recipientId,
                "EXECUTION", executionId, data, true));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowNotificationEvent(
                "monitoring.alert.consecutive_failures", Instant.now(), workspaceId, null, recipientId,
                "EXECUTION", executionId, java.util.Map.of("ruleName", "R", "workflowName", "W",
                        "workflowId", workflowId.toString(), "failureCount", "3"), false));
        assertThrows(IllegalArgumentException.class, () -> new WorkflowNotificationEvent(
                "monitoring.alert.long_running", Instant.now(), workspaceId, null, recipientId,
                "EXECUTION", executionId, java.util.Map.of("ruleName", "R", "workflowName", "W",
                        "workflowId", workflowId.toString(), "failureCount", "3"), true));
    }
}
