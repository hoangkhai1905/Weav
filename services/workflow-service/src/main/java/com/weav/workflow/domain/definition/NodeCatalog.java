package com.weav.workflow.domain.definition;

import java.util.Map;
import java.util.Set;

/** The explicitly supported Workflow Service V1 node catalog. */
public final class NodeCatalog {
    private static final Set<String> SUPPORTED_TYPES = Set.of(
            "trigger.manual",
            "trigger.schedule",
            "trigger.webhook",
            "trigger.telegram",
            "http.request",
            "email.send",
            "google.sheets",
            "telegram.send_message",
            "logic.condition",
            "ai.extract",
            "ai.classify",
            "ai.summarize",
            "ocr.extract");

    private static final Map<String, Set<String>> CONFIG_FIELDS = Map.ofEntries(
            Map.entry("trigger.manual", Set.of("buttonLabel")),
            Map.entry("trigger.schedule", Set.of("cron", "timezone")),
            Map.entry("trigger.webhook", Set.of()),
            Map.entry("trigger.telegram", Set.of()),
            Map.entry("http.request", Set.of("method", "url", "headers", "query", "body", "connectionId")),
            Map.entry("email.send", Set.of("to", "subject", "body")),
            Map.entry("google.sheets", Set.of(
                    "connectionId", "operation", "spreadsheetId", "range", "values")),
            Map.entry("telegram.send_message", Set.of("chatId", "text")),
            Map.entry("logic.condition", Set.of("left", "operator", "right")),
            Map.entry("ai.extract", Set.of("text", "schemaDescription")),
            Map.entry("ai.classify", Set.of("content", "categories")),
            Map.entry("ai.summarize", Set.of("inputText", "maxLength")),
            Map.entry("ocr.extract", Set.of("artifactId", "fileUrl", "language", "detectTables")));

    private NodeCatalog() {
    }

    public static Set<String> supportedTypes() {
        return SUPPORTED_TYPES;
    }

    public static boolean supports(String type) {
        return type != null && SUPPORTED_TYPES.contains(type);
    }

    public static Set<String> configFields(String type) {
        return type == null ? Set.of() : CONFIG_FIELDS.getOrDefault(type, Set.of());
    }
}
