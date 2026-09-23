package com.weav.workflow.application.service;

import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.exception.BadRequestException;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import tools.jackson.databind.ObjectMapper;

/** Validates trigger context and delegates atomic execution admission. */
@Service
public final class ExecutionAdmissionService {
    private static final String RUN_CAPABILITY = "WORKFLOW_RUN";
    private static final Pattern SAFE_CORRELATION_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");
    private static final Pattern TRACEPARENT = Pattern.compile(
            "(?!ff)[0-9a-f]{2}-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}");

    private final WorkspaceAuthorization workspaceAuthorization;
    private final ExecutionAdmissionPort admissionPort;
    private final ObjectMapper objectMapper;
    private final int maxInputBytes;
    private final int maxInputDepth;

    public ExecutionAdmissionService(WorkspaceAuthorization workspaceAuthorization,
                                     ExecutionAdmissionPort admissionPort,
                                     ObjectMapper objectMapper,
                                     @Value("${weav.workflow.execution.input.max-bytes:1048576}") int maxInputBytes,
                                     @Value("${weav.workflow.execution.input.max-depth:32}") int maxInputDepth) {
        this.workspaceAuthorization = Objects.requireNonNull(workspaceAuthorization);
        this.admissionPort = Objects.requireNonNull(admissionPort);
        this.objectMapper = Objects.requireNonNull(objectMapper);
        if (maxInputBytes < 1 || maxInputDepth < 1) {
            throw new IllegalArgumentException("Execution input limits must be positive");
        }
        this.maxInputBytes = maxInputBytes;
        this.maxInputDepth = maxInputDepth;
    }

    public ExecutionAdmissionPort.Admission manual(UUID workspaceId, UUID workflowId, UUID actorId, Object input,
                                                   String correlationId, String traceparent) {
        workspaceAuthorization.require(workspaceId, actorId, RUN_CAPABILITY);
        if (!(input instanceof Map<?, ?>)) {
            throw new BadRequestException("Manual execution input must be a JSON object");
        }
        Object immutableInput = validateAndFreeze(input);
        return admissionPort.create(new ExecutionAdmissionPort.Command(
                workspaceId, workflowId, actorId, null, ExecutionTriggerType.MANUAL, immutableInput, null,
                correlationId(correlationId), traceparent(traceparent)));
    }

    public ExecutionAdmissionPort.Admission automatic(UUID triggerId, Object input,
                                                       java.time.Instant scheduledAt,
                                                       String correlationId, String traceparent) {
        if (triggerId == null) {
            throw new BadRequestException("An automatic trigger registration is required");
        }
        Object immutableInput = validateAndFreeze(input);
        return admissionPort.create(new ExecutionAdmissionPort.Command(
                null, null, null, triggerId, null, immutableInput, scheduledAt,
                correlationId(correlationId), traceparent(traceparent)));
    }

    private Object validateAndFreeze(Object input) {
        try {
            checkDepthAndCycles(input);
            Object immutableInput = JsonValues.freeze(input);
            if (objectMapper.writeValueAsBytes(immutableInput).length > maxInputBytes) {
                throw new BadRequestException("Execution input exceeds the supported size");
            }
            return immutableInput;
        } catch (BadRequestException exception) {
            throw exception;
        } catch (RuntimeException exception) {
            throw new BadRequestException("Execution input is not valid JSON");
        } catch (Exception exception) {
            throw new BadRequestException("Execution input could not be validated");
        }
    }

    private void checkDepthAndCycles(Object input) {
        Deque<DepthEntry> pending = new ArrayDeque<>();
        IdentityHashMap<Object, Boolean> activeContainers = new IdentityHashMap<>();
        pending.addLast(new DepthEntry(input, 1, false));
        while (!pending.isEmpty()) {
            DepthEntry entry = pending.removeLast();
            Object value = entry.value();
            if (entry.exit()) {
                activeContainers.remove(value);
                continue;
            }
            if (!(value instanceof Map<?, ?>) && !(value instanceof java.util.List<?>)) {
                continue;
            }
            if (entry.depth() > maxInputDepth) {
                throw new BadRequestException("Execution input exceeds the supported nesting depth");
            }
            if (activeContainers.put(value, Boolean.TRUE) != null) {
                throw new BadRequestException("Cyclic values are not valid JSON input");
            }
            pending.addLast(new DepthEntry(value, entry.depth(), true));
            if (value instanceof Map<?, ?> object) {
                for (Map.Entry<?, ?> property : object.entrySet()) {
                    pending.addLast(new DepthEntry(property.getValue(), entry.depth() + 1, false));
                }
            } else {
                for (Object item : (java.util.List<?>) value) {
                    pending.addLast(new DepthEntry(item, entry.depth() + 1, false));
                }
            }
        }
    }

    private String correlationId(String value) {
        if (value == null) return null;
        String normalized = value.trim();
        if (!SAFE_CORRELATION_ID.matcher(normalized).matches()) {
            throw new BadRequestException("Correlation ID is invalid");
        }
        return normalized;
    }

    private String traceparent(String value) {
        if (value == null || value.isBlank()) return null;
        String normalized = value.trim();
        var matcher = TRACEPARENT.matcher(normalized);
        if (!matcher.matches() || "00000000000000000000000000000000".equals(matcher.group(1))
                || "0000000000000000".equals(matcher.group(2))) {
            return null;
        }
        return normalized;
    }

    private record DepthEntry(Object value, int depth, boolean exit) {
    }
}
