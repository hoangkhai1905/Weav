package com.weav.workflow.application.notification;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** Immutable, allow-listed notification data captured at the business commit boundary. */
public record WorkflowNotificationEvent(
        String eventType,
        Instant occurredAt,
        UUID workspaceId,
        UUID actorUserId,
        UUID recipientUserId,
        String entityKind,
        UUID entityId,
        Map<String, String> data,
        boolean requiresMonitorAccess) {

    private static final Set<String> LIFECYCLE_TYPES = Set.of(
            "workflow.created", "workflow.published", "workflow.paused", "workflow.resumed");

    private static final Map<String, Set<String>> ALERT_DATA_KEYS = Map.of(
            "monitoring.alert.consecutive_failures",
            Set.of("ruleName", "workflowName", "workflowId", "failureCount"),
            "monitoring.alert.long_running",
            Set.of("ruleName", "workflowName", "workflowId", "durationSeconds", "thresholdSeconds"));

    public WorkflowNotificationEvent {
        Objects.requireNonNull(eventType, "eventType must not be null");
        Objects.requireNonNull(occurredAt, "occurredAt must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(entityKind, "entityKind must not be null");
        Objects.requireNonNull(entityId, "entityId must not be null");
        data = Map.copyOf(Objects.requireNonNull(data, "data must not be null"));
        if (LIFECYCLE_TYPES.contains(eventType)) {
            if (!"WORKFLOW".equals(entityKind) || recipientUserId == null || requiresMonitorAccess
                    || !data.keySet().equals(Set.of("workflowName"))) {
                throw new IllegalArgumentException("Workflow lifecycle notification fields are invalid");
            }
            data = Map.of("workflowName", safeName(data.get("workflowName")));
        } else if ("workflow.completed".equals(eventType) || "workflow.failed".equals(eventType)) {
            if (!"EXECUTION".equals(entityKind) || !requiresMonitorAccess
                    || !data.keySet().equals(Set.of("workflowName", "workflowId"))) {
                throw new IllegalArgumentException("Workflow result notification fields are invalid");
            }
            data = Map.of("workflowName", safeName(data.get("workflowName")),
                    "workflowId", requireUuid(data.get("workflowId"), "workflowId").toString());
        } else if (ALERT_DATA_KEYS.containsKey(eventType)) {
            // W6-A monitoring alerts: EXECUTION entity, recipient re-checked for WORKFLOW_MONITOR at publish.
            if (!"EXECUTION".equals(entityKind) || !requiresMonitorAccess || recipientUserId == null
                    || !data.keySet().equals(ALERT_DATA_KEYS.get(eventType))) {
                throw new IllegalArgumentException("Monitoring alert notification fields are invalid");
            }
            Map<String, String> alert = new java.util.LinkedHashMap<>();
            alert.put("ruleName", safeName(data.get("ruleName")));
            alert.put("workflowName", safeName(data.get("workflowName")));
            alert.put("workflowId", requireUuid(data.get("workflowId"), "workflowId").toString());
            for (String key : ALERT_DATA_KEYS.get(eventType)) {
                if (key.endsWith("Count") || key.endsWith("Seconds")) {
                    alert.put(key, requireCount(data.get(key), key));
                }
            }
            data = Map.copyOf(alert);
        } else {
            throw new IllegalArgumentException("Unsupported Workflow notification type");
        }
    }

    public static WorkflowNotificationEvent consecutiveFailuresAlert(
            UUID workspaceId, UUID recipientId, UUID executionId, UUID workflowId, String workflowName,
            String ruleName, int failureCount, Instant at) {
        return new WorkflowNotificationEvent("monitoring.alert.consecutive_failures", at, workspaceId, null,
                recipientId, "EXECUTION", executionId,
                Map.of("ruleName", ruleName, "workflowName", workflowName, "workflowId", workflowId.toString(),
                        "failureCount", Integer.toString(failureCount)), true);
    }

    public static WorkflowNotificationEvent longRunningAlert(
            UUID workspaceId, UUID recipientId, UUID executionId, UUID workflowId, String workflowName,
            String ruleName, long durationSeconds, int thresholdSeconds, Instant at) {
        return new WorkflowNotificationEvent("monitoring.alert.long_running", at, workspaceId, null,
                recipientId, "EXECUTION", executionId,
                Map.of("ruleName", ruleName, "workflowName", workflowName, "workflowId", workflowId.toString(),
                        "durationSeconds", Long.toString(durationSeconds),
                        "thresholdSeconds", Integer.toString(thresholdSeconds)), true);
    }

    private static String requireCount(String value, String field) {
        if (value == null || !value.matches("[0-9]{1,9}")) {
            throw new IllegalArgumentException(field + " must be a non-negative integer");
        }
        return value;
    }

    public static WorkflowNotificationEvent lifecycle(
            String eventType, UUID workspaceId, UUID actorId, UUID workflowId, String workflowName, Instant at) {
        return new WorkflowNotificationEvent(eventType, at, workspaceId, actorId, actorId,
                "WORKFLOW", workflowId, Map.of("workflowName", workflowName), false);
    }

    public static WorkflowNotificationEvent terminal(
            String eventType, UUID workspaceId, UUID actorId, UUID recipientId,
            UUID executionId, UUID workflowId, String workflowName, Instant at) {
        return new WorkflowNotificationEvent(eventType, at, workspaceId, actorId, recipientId,
                "EXECUTION", executionId,
                Map.of("workflowName", workflowName, "workflowId", workflowId.toString()), true);
    }

    public static String safeName(String name) {
        if (name == null || name.isBlank()) {
            throw new IllegalArgumentException("Workflow notification name must be nonblank");
        }
        String summary = trimConsumerWhitespace(name);
        if (summary.isEmpty()) {
            return "Workflow";
        }
        if (summary.length() <= 200) {
            return summary;
        }
        int end = 200;
        if (Character.isHighSurrogate(summary.charAt(end - 1)) && Character.isLowSurrogate(summary.charAt(end))) {
            end--;
        }
        return summary.substring(0, end);
    }

    private static String trimConsumerWhitespace(String value) {
        int start = 0;
        int end = value.length();
        while (start < end) {
            int codePoint = value.codePointAt(start);
            if (!isConsumerWhitespace(codePoint)) {
                break;
            }
            start += Character.charCount(codePoint);
        }
        while (start < end) {
            int codePoint = value.codePointBefore(end);
            if (!isConsumerWhitespace(codePoint)) {
                break;
            }
            end -= Character.charCount(codePoint);
        }
        return value.substring(start, end);
    }

    /** Matches ECMAScript's built-in \s set used by the Notification Zod display-name contract. */
    private static boolean isConsumerWhitespace(int codePoint) {
        return codePoint == 0x0009 || codePoint == 0x000A || codePoint == 0x000B || codePoint == 0x000C
                || codePoint == 0x000D || codePoint == 0x0020 || codePoint == 0x00A0 || codePoint == 0x1680
                || (codePoint >= 0x2000 && codePoint <= 0x200A) || codePoint == 0x2028 || codePoint == 0x2029
                || codePoint == 0x202F || codePoint == 0x205F || codePoint == 0x3000 || codePoint == 0xFEFF;
    }

    private static UUID requireUuid(String value, String field) {
        try {
            return UUID.fromString(Objects.requireNonNull(value, field + " must not be null"));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException(field + " must be a UUID", exception);
        }
    }
}
