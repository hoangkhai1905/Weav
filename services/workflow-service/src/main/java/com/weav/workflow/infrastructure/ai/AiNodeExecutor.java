package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class AiNodeExecutor implements NodeExecutor {
    private static final int DEFAULT_SUMMARY_LENGTH = 200;
    private static final int DEFAULT_GENERATE_LENGTH = 1000;
    private static final int MAX_PROMPT_CODE_POINTS = 50_000;
    private static final int MAX_INSTRUCTIONS_CODE_POINTS = 2_000;
    private final String type;
    private final AiClient client;

    public AiNodeExecutor(String type, AiClient client) {
        if (!Set.of("ai.extract", "ai.classify", "ai.summarize", "ai.generate").contains(type)) {
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
            case "ai.generate" -> {
                operation = "prompt";
                String prompt = text(config, "prompt");
                if (prompt.codePointCount(0, prompt.length()) > MAX_PROMPT_CODE_POINTS) {
                    throw invalid("The prompt is too long (at most 50,000 characters).");
                }
                payload.put("prompt", prompt);
                Object instructions = config.get("instructions");
                if (instructions != null && !(instructions instanceof String)) {
                    throw invalid("The instructions must be text.");
                }
                if (instructions instanceof String value && !value.isBlank()) {
                    if (value.codePointCount(0, value.length()) > MAX_INSTRUCTIONS_CODE_POINTS) {
                        throw invalid("The instructions are too long (at most 2,000 characters).");
                    }
                    payload.put("instructions", value);
                }
                payload.put("maxLength", maxLength(config, DEFAULT_GENERATE_LENGTH, "Answer length must be between 1 and 5000 characters."));
            }
            default -> {
                operation = "summarize";
                payload.put("text", text(config, "inputText"));
                payload.put("maxLength", maxLength(config, DEFAULT_SUMMARY_LENGTH, "Summary length must be between 1 and 5000 characters."));
            }
        }
        return new Result(client.execute(context, operation, payload), null);
    }

    private static int maxLength(Map<String, Object> config, int fallback, String message) {
        Object raw = config.getOrDefault("maxLength", fallback);
        if (!(raw instanceof Number number) || number.doubleValue() != Math.rint(number.doubleValue())
                || number.longValue() < 1 || number.longValue() > 5000) {
            throw invalid(message);
        }
        return number.intValue();
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
