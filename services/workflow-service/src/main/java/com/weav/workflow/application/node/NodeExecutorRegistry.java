package com.weav.workflow.application.node;

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
}
