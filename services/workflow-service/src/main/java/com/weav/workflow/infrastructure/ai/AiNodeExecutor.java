package com.weav.workflow.infrastructure.ai;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ResolvedConnection;
import com.weav.workflow.application.port.out.WorkspaceConnectionPort;
import com.weav.workflow.application.port.out.WorkspaceDependencyUnavailableException;
import com.weav.workflow.domain.exception.ForbiddenException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

public final class AiNodeExecutor implements NodeExecutor {
    private static final int DEFAULT_SUMMARY_LENGTH = 200;
    private static final int DEFAULT_GENERATE_LENGTH = 1000;
    private static final int MAX_PROMPT_CODE_POINTS = 50_000;
    private static final int MAX_INSTRUCTIONS_CODE_POINTS = 2_000;
    private static final Set<String> AI_PROVIDERS = Set.of("OPENAI", "ANTHROPIC", "GEMINI");
    /** Provider model names such as gpt-4o, models/gemini-pro or llama3.1:8b; also keeps the name safe to echo. */
    static final Pattern MODEL = Pattern.compile("[A-Za-z0-9._:/-]{1,100}");
    private final String type;
    private final AiClient client;
    private final WorkspaceConnectionPort workspaceConnections;

    public AiNodeExecutor(String type, AiClient client, WorkspaceConnectionPort workspaceConnections) {
        if (!Set.of("ai.extract", "ai.classify", "ai.summarize", "ai.generate").contains(type)) {
            throw new IllegalArgumentException("Unsupported AI node type");
        }
        this.type = type;
        this.client = Objects.requireNonNull(client, "client must not be null");
        this.workspaceConnections = Objects.requireNonNull(
                workspaceConnections, "workspaceConnections must not be null");
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
        String model = model(config.get("model"));
        UUID connectionId = connectionId(config.get("connectionId"));
        if (connectionId == null) {
            if (model != null) {
                throw Failure.invalidField("connectionId", "is required when a model is set.");
            }
            return new Result(client.execute(context, operation, payload), null);
        }
        ResolvedConnection connection = resolveConnection(context, connectionId);
        try {
            payload.put("llm", llm(connection, model));
            try {
                return new Result(client.execute(context, operation, payload), null);
            } catch (Failure failure) {
                if ("CONNECTION_AUTHENTICATION_REJECTED".equals(failure.code())) {
                    reportAuthenticationRejected(context.workspaceId(), connectionId, connection);
                }
                throw failure;
            }
        } finally {
            connection.close();
        }
    }

    /** The user's key goes only into the request to ai-service: never into a log line, a message or the stored input. */
    private static Map<String, Object> llm(ResolvedConnection connection, String model) {
        if (!AI_PROVIDERS.contains(connection.provider()) || !"TOKEN".equals(connection.authType())
                || !connection.auth().keySet().equals(Set.of("token"))) {
            throw new Failure("CONNECTION_CONFIGURATION_INVALID", "The AI connection configuration is invalid.", false);
        }
        Map<String, Object> llm = new LinkedHashMap<>();
        llm.put("provider", connection.provider());
        llm.put("apiKey", connection.auth().get("token"));
        if (model != null) {
            llm.put("model", model);
        }
        return llm;
    }

    private ResolvedConnection resolveConnection(Context context, UUID connectionId) {
        ResolvedConnection connection;
        try {
            connection = workspaceConnections.resolve(context.workspaceId(), connectionId);
        } catch (ForbiddenException exception) {
            throw new Failure("CONNECTION_FORBIDDEN", "The AI connection is not available to this workspace.", false);
        } catch (WorkspaceDependencyUnavailableException exception) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The connection service is unavailable.", true, true);
        } catch (RuntimeException exception) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The connection service is unavailable.", true, true);
        }
        if (connection == null) {
            throw new Failure("CONNECTION_UNAVAILABLE", "The AI connection is unavailable.", true, true);
        }
        return connection;
    }

    private void reportAuthenticationRejected(UUID workspaceId, UUID connectionId, ResolvedConnection resolved) {
        try {
            workspaceConnections.reportAuthenticationRejected(workspaceId, connectionId, resolved);
        } catch (RuntimeException ignored) {
            // The provider confirmed the rejection; keep that classification if Workspace is unavailable.
        }
    }

    private static UUID connectionId(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text) || text.length() != 36) {
            throw Failure.invalidField("connectionId", "must be a connection id.");
        }
        try {
            UUID id = UUID.fromString(text);
            if (!id.toString().equalsIgnoreCase(text)) {
                throw new IllegalArgumentException();
            }
            return id;
        } catch (IllegalArgumentException exception) {
            throw Failure.invalidField("connectionId", "must be a connection id.");
        }
    }

    private static String model(Object value) {
        if (value == null) {
            return null;
        }
        if (!(value instanceof String text) || !MODEL.matcher(text).matches()) {
            throw Failure.invalidField("model", "must be 1 to 100 letters, digits or . _ : / -");
        }
        return text;
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
