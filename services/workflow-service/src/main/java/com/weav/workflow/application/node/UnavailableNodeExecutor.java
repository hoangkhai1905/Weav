package com.weav.workflow.application.node;

import java.util.Map;
import java.util.Set;

/** Explicit fail-closed adapters for integrations without an approved runtime contract. */
public final class UnavailableNodeExecutor implements NodeExecutor {
    public static final Set<String> UNAVAILABLE_NODE_TYPES = Set.of(
            "email.send",
            "telegram.send_message",
            "ai.extract",
            "ai.classify",
            "ai.summarize");

    private final String type;

    public UnavailableNodeExecutor(String type) {
        if (type == null || !UNAVAILABLE_NODE_TYPES.contains(type)) {
            throw new IllegalArgumentException("Node type does not have an unavailable integration adapter");
        }
        this.type = type;
    }

    @Override
    public String type() {
        return type;
    }

    @Override
    public Result execute(Context context, Map<String, Object> resolvedConfig) {
        throw new Failure("DEPENDENCY_NOT_CONFIGURED",
                "This node has no configured execution adapter.", false);
    }
}
