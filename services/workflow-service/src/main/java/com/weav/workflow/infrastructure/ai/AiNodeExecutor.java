package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class AiNodeExecutor implements NodeExecutor {
    private static final int DEFAULT_SUMMARY_LENGTH = 200;
    private final String type;
    private final AiClient client;

    public AiNodeExecutor(String type, AiClient client) {
        if (!Set.of("ai.extract", "ai.classify", "ai.summarize").contains(type)) {
            throw new IllegalArgumentException("Unsupported AI node type");
        }
        this.type = type;
        this.client = Objects.requireNonNull(client, "client must not be null");
    }

    @Override
    public String type() {
        return type;
    }

    @Override
    public Result execute(Context context, Map<String, Object> config) {
        if (context == null || config == null) {
            throw invalid("The AI node configuration is invalid.");
        }
        Map<String, Object> payload = new LinkedHashMap<>();
        String operation;
        switch (type) {
            case "ai.extract" -> {
                operation = "extract";
                payload.put("text", text(config, "text"));
                if (!(config.get("outputSchema") instanceof Map<?, ?> schema)) {
                    throw invalid("Add an output schema to this extract node.");
                }
                payload.put("outputSchema", schema);
                if (config.get("instructions") instanceof String instructions && !instructions.isBlank()) {
                    payload.put("instructions", instructions);
                }
            }
            case "ai.classify" -> {
                operation = "classify";
                payload.put("text", text(config, "content"));
                if (!(config.get("categories") instanceof List<?> categories) || categories.size() < 2
                        || !categories.stream().allMatch(String.class::isInstance)) {
                    throw invalid("Add at least two categories to this classify node.");
                }
                payload.put("categories", categories);
            }
            default -> {
                operation = "summarize";
                payload.put("text", text(config, "inputText"));
                Object raw = config.getOrDefault("maxLength", DEFAULT_SUMMARY_LENGTH);
                if (!(raw instanceof Number number) || number.doubleValue() != Math.rint(number.doubleValue())
                        || number.longValue() < 1 || number.longValue() > 5000) {
                    throw invalid("Summary length must be between 1 and 5000 characters.");
                }
                payload.put("maxLength", number.intValue());
            }
        }
        return new Result(client.execute(context, operation, payload), null);
    }

    private static String text(Map<String, Object> config, String field) {
        if (!(config.get(field) instanceof String value) || value.isBlank()) {
            throw invalid("The AI node input text is empty.");
        }
        return value;
    }

    private static Failure invalid(String message) {
        return new Failure("CONFIGURATION_ERROR", message, false);
    }
}
