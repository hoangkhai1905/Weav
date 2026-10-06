package com.weav.workflow.application.node;

import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.execution.ConditionEvaluator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/** Resolves the explicitly registered node adapters and fails closed when one is absent. */
@Component
public final class NodeExecutorRegistry {
    private final Map<String, NodeExecutor> executors;

    @Autowired
    public NodeExecutorRegistry(List<NodeExecutor> configuredExecutors) {
        Map<String, NodeExecutor> registered = new LinkedHashMap<>();
        if (configuredExecutors != null) {
            for (NodeExecutor executor : configuredExecutors) {
                register(registered, executor);
            }
        }
        for (String type : UnavailableNodeExecutor.UNAVAILABLE_NODE_TYPES) {
            registered.computeIfAbsent(type, UnavailableNodeExecutor::new);
        }
        // The condition node is a local declarative evaluator and does not need an external provider.
        registered.putIfAbsent("logic.condition", new ConditionNodeExecutor());
        registered.putIfAbsent("logic.switch", new SwitchNodeExecutor());
        registered.putIfAbsent("data.set", new DataSetNodeExecutor());
        this.executors = Map.copyOf(registered);
    }

    public NodeExecutorRegistry(NodeExecutor... configuredExecutors) {
        this(configuredExecutors == null ? List.of() : List.of(configuredExecutors));
    }

    public NodeExecutor require(String type) {
        NodeExecutor executor = executors.get(type);
        if (executor == null) {
            throw new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
                    "No executor is configured for node type " + (type == null ? "unknown" : type) + ".", false);
        }
        return executor;
    }

    public Map<String, NodeExecutor> executors() {
        return executors;
    }

    private static void register(Map<String, NodeExecutor> registered, NodeExecutor executor) {
        Objects.requireNonNull(executor, "configured executor must not be null");
        String type = executor.type();
        if (type == null || type.isBlank() || type.length() > 255) {
            throw new IllegalArgumentException("Executor type must be nonblank and at most 255 characters");
        }
        if (registered.putIfAbsent(type, executor) != null) {
            throw new IllegalArgumentException("Duplicate node executor for type " + type);
        }
    }

    private static final class ConditionNodeExecutor implements NodeExecutor {
        private final ConditionEvaluator evaluator = new ConditionEvaluator();

        @Override
        public String type() {
            return "logic.condition";
        }

        @Override
        public Result execute(Context context, Map<String, Object> resolvedConfig) {
            if (resolvedConfig == null) {
                throw new Failure("CONFIGURATION_ERROR", "Condition configuration is missing.", false);
            }
            if (resolvedConfig.containsKey("conditions")) {
                // Multi form {combinator, conditions}; mixing with left/operator/right is a configuration error.
                if (resolvedConfig.containsKey("left") || resolvedConfig.containsKey("operator")
                        || resolvedConfig.containsKey("right")
                        || !(resolvedConfig.get("combinator") instanceof String combinator)
                        || !(resolvedConfig.get("conditions") instanceof List<?> conditions)) {
                    throw new Failure("CONFIGURATION_ERROR", "Condition configuration is invalid.", false);
                }
                try {
                    boolean selected = evaluator.evaluateAll(combinator, conditions);
                    return new Result(Map.of("value", selected), selected ? "true" : "false");
                } catch (IllegalArgumentException exception) {
                    throw new Failure("CONFIGURATION_ERROR", "Condition configuration is invalid.", false);
                }
            }
            Object operator = resolvedConfig.get("operator");
            if (!(operator instanceof String operation) || operation.isBlank()
                    || !resolvedConfig.containsKey("left") || !resolvedConfig.containsKey("right")) {
                throw new Failure("CONFIGURATION_ERROR", "Condition configuration is invalid.", false);
            }
            try {
                boolean selected = evaluator.evaluate(resolvedConfig.get("left"), operation,
                        resolvedConfig.get("right"));
                return new Result(Map.of("value", selected), selected ? "true" : "false");
            } catch (IllegalArgumentException exception) {
                throw new Failure("CONFIGURATION_ERROR", "Condition configuration is invalid.", false);
            }
        }
    }

    /** Picks the output port whose case equals the value as text, else the reserved "default" port. */
    private static final class SwitchNodeExecutor implements NodeExecutor {
        @Override
        public String type() {
            return "logic.switch";
        }

        @Override
        public Result execute(Context context, Map<String, Object> resolvedConfig) {
            if (resolvedConfig == null || !resolvedConfig.containsKey("value")
                    || !(resolvedConfig.get("cases") instanceof List<?> cases)) {
                throw new Failure("CONFIGURATION_ERROR", "Switch configuration is invalid.", false);
            }
            Object value = resolvedConfig.get("value");
            String text = JsonValues.scalarText(value);
            String port = text != null && cases.contains(text) ? text : "default";
            Map<String, Object> output = new LinkedHashMap<>();
            output.put("value", value);
            output.put("port", port);
            return new Result(output, port);
        }
    }

    /** The resolved fields object is the output; mappings were already resolved by the runner. */
    private static final class DataSetNodeExecutor implements NodeExecutor {
        @Override
        public String type() {
            return "data.set";
        }

        @Override
        public Result execute(Context context, Map<String, Object> resolvedConfig) {
            if (resolvedConfig == null || !(resolvedConfig.get("fields") instanceof Map<?, ?> fields)) {
                throw new Failure("CONFIGURATION_ERROR", "Set data configuration is invalid.", false);
            }
            // A whole-object mapping skips the publish-only key checks, so repeat them here.
            if (fields.isEmpty() || fields.size() > 100 || fields.keySet().stream().anyMatch(key ->
                    !(key instanceof String text) || text.isBlank() || text.length() > 128)) {
                throw new Failure("CONFIGURATION_ERROR",
                        "Set data needs 1 to 100 fields with non-blank names of at most 128 characters.", false);
            }
            Map<String, Object> output = new LinkedHashMap<>();
            fields.forEach((key, value) -> output.put((String) key, value));
            return new Result(output, null);
        }
    }
}
