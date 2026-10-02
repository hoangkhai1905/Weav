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
        } else {
            throw new IllegalArgumentException("Unsupported Workflow notification type");
        }
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
