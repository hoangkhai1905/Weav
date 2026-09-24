package com.weav.workflow.application.node;

import com.weav.workflow.domain.definition.JsonValues;

import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/** Application boundary for one synchronous workflow node invocation. */
public interface NodeExecutor {

    String type();

    Result execute(Context context, Map<String, Object> resolvedConfig);

    /** Correlation-only execution context. Provider credentials never cross this boundary. */
    record Context(UUID workspaceId, UUID executionId, UUID nodeExecutionId, String nodeId,
                   int attemptNumber, String correlationId, String traceparent) {
        public Context {
            Objects.requireNonNull(workspaceId, "workspaceId must not be null");
            Objects.requireNonNull(executionId, "executionId must not be null");
            Objects.requireNonNull(nodeExecutionId, "nodeExecutionId must not be null");
            if (nodeId == null || nodeId.isBlank() || nodeId.length() > 255) {
                throw new IllegalArgumentException("nodeId must be nonblank and at most 255 characters");
            }
            if (attemptNumber < 1 || attemptNumber > 3) {
                throw new IllegalArgumentException("attemptNumber must be between one and three");
            }
            if (correlationId != null && correlationId.length() > 128) {
                throw new IllegalArgumentException("correlationId must be at most 128 characters");
            }
            if (traceparent != null && traceparent.length() > 255) {
                throw new IllegalArgumentException("traceparent must be at most 255 characters");
            }
        }
    }

    record Result(Map<String, Object> output, String selectedPort) {
        public Result {
            output = output == null ? Map.of() : JsonValues.freezeMap(output);
            if (selectedPort != null && selectedPort.isBlank()) {
                throw new IllegalArgumentException("selectedPort must be null or nonblank");
            }
        }
    }

    /** Safe provider-facing failure. Raw bodies and causes are deliberately not retained. */
    final class Failure extends RuntimeException {
        private static final int MAX_MESSAGE_LENGTH = 512;

        private final String code;
        private final String safeMessage;
        private final boolean retryable;

        public Failure(String code, String safeMessage, boolean retryable) {
            super(sanitize(safeMessage));
            if (code == null || code.isBlank() || code.length() > 128) {
                throw new IllegalArgumentException("Failure code must be nonblank and at most 128 characters");
            }
            this.code = code;
            this.safeMessage = sanitize(safeMessage);
            this.retryable = retryable;
        }

        public String code() {
            return code;
        }

        public String safeMessage() {
            return safeMessage;
        }

        public boolean retryable() {
            return retryable;
        }

        private static String sanitize(String value) {
            if (value == null || value.isBlank()) {
                return "The node could not be executed.";
            }
            String normalized = value.replaceAll("[\\r\\n\\t]+", " ").trim();
            return normalized.length() <= MAX_MESSAGE_LENGTH
                    ? normalized : normalized.substring(0, MAX_MESSAGE_LENGTH);
        }
    }
}
