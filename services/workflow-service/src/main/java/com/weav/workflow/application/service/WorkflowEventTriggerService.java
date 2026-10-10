package com.weav.workflow.application.service;

import com.weav.workflow.application.node.WeavWorkflowNodeExecutor;
import com.weav.workflow.application.port.out.ControlBotStore;
import com.weav.workflow.application.port.out.ControlBotStore.EventListener;
import com.weav.workflow.application.port.out.ControlBotStore.FinishedSource;
import com.weav.workflow.application.port.out.ExecutionFinishedListener;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.ExecutionTriggerType;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * trigger.workflow_event: once a run has finished and committed, starts every listening workflow of the same
 * workspace whose trigger matches the source workflow and outcome. Never throws (the run is already committed).
 *
 * <p>Guards: CANCELLED runs never fire; a run that was itself started by this trigger, or by a weav.workflow run
 * step inside such a chain (idempotency key prefix {@code wfctl-chain-}), never fires, which stops A-runs-B-runs-A
 * loops of any length;
 * a workflow never fires itself; one firing per (listening workflow, source run) through the admission
 * idempotency key {@code wfevent:<sourceExecutionId>}.
 */
@Service
public final class WorkflowEventTriggerService implements ExecutionFinishedListener {
    private static final Logger LOGGER = LoggerFactory.getLogger(WorkflowEventTriggerService.class);

    private final ControlBotStore store;
    private final ExecutionAdmissionService admission;
    private final String webBaseUrl;
    private final TransactionTemplate newTransaction;

    public WorkflowEventTriggerService(
            ControlBotStore store, ExecutionAdmissionService admission, PlatformTransactionManager transactionManager,
            @Value("${weav.workflow.web-base-url:}") String webBaseUrl) {
        this.store = Objects.requireNonNull(store);
        this.admission = Objects.requireNonNull(admission);
        // Called from afterCommit, where the finished run's transaction is still bound: a plain REQUIRED call would
        // join it and the admission's pessimistic locks would fail. Each listener gets its own transaction.
        this.newTransaction = new TransactionTemplate(Objects.requireNonNull(transactionManager));
        this.newTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.webBaseUrl = normalizeBase(webBaseUrl);
    }

    @Override
    public void onExecutionFinished(UUID executionId) {
        try {
            fire(executionId);
        } catch (RuntimeException exception) {
            LOGGER.warn("event=workflow_event_failed executionId={} cause={}", executionId,
                    exception.getClass().getSimpleName());
        }
    }

    /** Returns how many listening workflows were started (or already had been). Package-visible for tests. */
    int fire(UUID executionId) {
        FinishedSource source = store.finishedSource(executionId).orElse(null);
        if (source == null || source.status() == ExecutionStatus.CANCELLED
                || source.triggerType() == ExecutionTriggerType.WORKFLOW_EVENT
                || source.idempotencyKey() != null
                && source.idempotencyKey().startsWith(WeavWorkflowNodeExecutor.CHAIN_KEY_PREFIX)) {
            return 0;
        }
        String event = source.status() == ExecutionStatus.SUCCESS ? "SUCCEEDED" : "FAILED";
        int started = 0;
        for (EventListener listener : store.eventListeners(source.workspaceId())) {
            if (listener.workflowId().equals(source.workflowId()) || !matches(listener.config(), source, event)) {
                continue;
            }
            try {
                newTransaction.executeWithoutResult(status -> admission.automatic(listener.triggerId(),
                        input(source, event), null, null, null, "wfevent:" + executionId));
                started++;
            } catch (RuntimeException exception) {
                // A listener that was paused or republished meanwhile is not an error for the others.
                LOGGER.warn("event=workflow_event_admission_failed listenerWorkflowId={} executionId={} cause={} "
                                + "message={}", listener.workflowId(), executionId,
                        exception.getClass().getSimpleName(), exception.getMessage());
            }
        }
        return started;
    }

    private static boolean matches(Map<String, Object> config, FinishedSource source, String event) {
        if (!(config.get("events") instanceof List<?> events) || !events.contains(event)) {
            return false;
        }
        return !(config.get("workflowIds") instanceof List<?> ids) || ids.isEmpty()
                || ids.stream().anyMatch(id -> source.workflowId().toString().equalsIgnoreCase(String.valueOf(id)));
    }

    private Map<String, Object> input(FinishedSource source, String event) {
        Map<String, Object> input = new LinkedHashMap<>();
        input.put("workflowId", source.workflowId().toString());
        input.put("workflowName", source.workflowName());
        input.put("executionId", source.executionId().toString());
        input.put("status", event);
        input.put("errorCode", source.errorCode());
        input.put("errorMessage", source.errorMessage());
        input.put("startedAt", source.startedAt() == null ? null : source.startedAt().toString());
        input.put("finishedAt", source.finishedAt() == null ? null : source.finishedAt().toString());
        input.put("durationMs", source.startedAt() == null || source.finishedAt() == null ? null
                : Math.max(0, Duration.between(source.startedAt(), source.finishedAt()).toMillis()));
        if (!webBaseUrl.isEmpty()) {
            input.put("runUrl", webBaseUrl + "/executions/" + source.executionId());
        }
        return input;
    }

    private static String normalizeBase(String raw) {
        String base = raw == null ? "" : raw.strip();
        while (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        return base;
    }
}
