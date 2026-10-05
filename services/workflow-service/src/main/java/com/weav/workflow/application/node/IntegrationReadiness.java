package com.weav.workflow.application.node;

import java.net.URI;

/** Server-owned readiness for integration types; node configuration cannot enable an adapter. */
public final class IntegrationReadiness {
    private static final String DEPENDENCY_NOT_CONFIGURED = "DEPENDENCY_NOT_CONFIGURED";

    private IntegrationReadiness() {
    }

    public static Readiness forType(String type) {
        return forType(type, null);
    }

    /**
     * @param telegramPublicBaseUrl the configured public HTTPS base URL of the gateway, or null; Telegram can
     *                              only deliver updates to a trigger when it is set to a valid https URL
     */
    public static Readiness forType(String type, String telegramPublicBaseUrl) {
        boolean unavailable = type == null
                || UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES.contains(type)
                || "trigger.telegram".equals(type) && httpsBaseUrl(telegramPublicBaseUrl) == null;
        return unavailable
                ? new Readiness(false, DEPENDENCY_NOT_CONFIGURED)
                : new Readiness(true, null);
    }

    /** Returns the base URL without a trailing slash, or null unless it is an https URL with a host. */
    public static String httpsBaseUrl(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String trimmed = raw.strip();
        while (trimmed.endsWith("/")) {
            trimmed = trimmed.substring(0, trimmed.length() - 1);
        }
        try {
            URI uri = URI.create(trimmed);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null) {
                return null;
            }
            return trimmed;
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    public record Readiness(boolean configured, String reasonCode) {
    }
}
