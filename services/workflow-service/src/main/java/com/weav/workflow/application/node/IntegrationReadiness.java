package com.weav.workflow.application.node;

/** Server-owned readiness for integration types; node configuration cannot enable an adapter. */
public final class IntegrationReadiness {
    private static final String DEPENDENCY_NOT_CONFIGURED = "DEPENDENCY_NOT_CONFIGURED";

    private IntegrationReadiness() {
    }

    public static Readiness forType(String type) {
        boolean unavailable = type == null
                || UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES.contains(type)
                || "trigger.telegram".equals(type);
        return unavailable
                ? new Readiness(false, DEPENDENCY_NOT_CONFIGURED)
                : new Readiness(true, null);
    }

    public record Readiness(boolean configured, String reasonCode) {
    }
}
