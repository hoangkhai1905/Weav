package com.weav.workflow.domain.definition;

import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Classifies whether executing a node can change state outside Weav. A side-effecting node
 * interrupted mid-attempt has an unknown outcome and must never be re-run blindly.
 */
public final class NodeSideEffects {
    private static final Set<String> SAFE_HTTP_METHODS = Set.of("GET", "HEAD", "OPTIONS");

    private NodeSideEffects() {
    }

    /**
     * @param config the node's configuration as stored in the definition (mappings unresolved);
     *               an unresolved or missing HTTP method is treated as side-effecting.
     */
    public static boolean isSideEffecting(String type, Map<String, Object> config) {
        if (type == null) {
            return true;
        }
        return switch (type) {
            case "http.request" -> !(config != null && config.get("method") instanceof String method
                    && SAFE_HTTP_METHODS.contains(method.toUpperCase(Locale.ROOT)));
            case "email.send", "telegram.send_message", "google.calendar" -> true;
            case "google.sheets" -> !(config != null && "read".equals(config.get("operation")));
            case "google.drive" -> !(config != null && "list".equals(config.get("operation")));
            case "logic.condition", "logic.switch", "data.set", "ai.extract", "ai.classify", "ai.summarize", "ocr.extract", "ai.generate" -> false;
            default -> type.startsWith("trigger.") ? false : true;
        };
    }
}
