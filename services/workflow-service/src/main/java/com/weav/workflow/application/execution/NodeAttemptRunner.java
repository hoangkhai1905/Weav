package com.weav.workflow.application.execution;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;

import java.util.Map;
import java.util.Objects;

/** Invokes one adapter and converts untrusted runtime exceptions to safe node failures. */
public final class NodeAttemptRunner {
    private final NodeExecutorRegistry registry;

    public NodeAttemptRunner(NodeExecutorRegistry registry) {
        this.registry = Objects.requireNonNull(registry, "registry must not be null");
    }

    public Outcome execute(String nodeType, NodeExecutor.Context context, Map<String, Object> resolvedConfig) {
        try {
            NodeExecutor executor = registry.require(nodeType);
            NodeExecutor.Result result = executor.execute(context, resolvedConfig);
            if (result == null) {
                return Outcome.failure(new NodeExecutor.Failure("CONFIGURATION_ERROR",
                        "The node executor returned no result.", false));
            }
            return Outcome.success(result);
        } catch (NodeExecutor.Failure failure) {
            return Outcome.failure(failure);
        } catch (RuntimeException exception) {
            return Outcome.failure(new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
                    "The node executor failed without a safe result.", false));
        }
    }

    public record Outcome(NodeExecutor.Result result, NodeExecutor.Failure failure) {
        public Outcome {
            if ((result == null) == (failure == null)) {
                throw new IllegalArgumentException("An attempt outcome must contain exactly one result or failure");
            }
        }

        public static Outcome success(NodeExecutor.Result result) {
            return new Outcome(Objects.requireNonNull(result), null);
        }

        public static Outcome failure(NodeExecutor.Failure failure) {
            return new Outcome(null, Objects.requireNonNull(failure));
        }

        public boolean succeeded() {
            return result != null;
        }
    }
}
