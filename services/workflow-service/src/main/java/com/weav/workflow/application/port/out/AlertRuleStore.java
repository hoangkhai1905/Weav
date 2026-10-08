package com.weav.workflow.application.port.out;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import com.weav.workflow.domain.valueobject.ExecutionStatus;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Persistence for alert rules, their firings and the finished-run facts the evaluator needs. */
public interface AlertRuleStore {

    List<AlertRule> list(UUID workspaceId);

    Optional<AlertRule> find(UUID workspaceId, UUID ruleId);

    /** True when the workflow exists in the workspace and is not deleted. */
    boolean workflowInWorkspace(UUID workspaceId, UUID workflowId);

    /**
     * Inserts the rule unless the workspace already has {@code maxRules} rules (counted like {@link #list}).
     * The check and the insert run under a per-workspace lock, so concurrent creates cannot exceed the cap.
     */
    boolean insertIfBelowLimit(AlertRule rule, int maxRules);

    boolean update(AlertRule rule);

    boolean delete(UUID workspaceId, UUID ruleId);

    /** The finished run behind an execution id, or empty when it is missing, deleted or not finished. */
    Optional<FinishedRun> finishedRun(UUID executionId);

    /** Enabled rules that apply to the workflow: scoped to it, or workspace-wide (null workflow). */
    List<AlertRule> enabledRules(UUID workspaceId, UUID workflowId);

    /**
     * RUNNING/WAITING runs that have been going longer than an enabled LONG_RUNNING rule's threshold (rule scoped to
     * the run's workflow, or workspace-wide) and have not fired that rule yet, oldest first, at most {@code limit}.
     * One query joins rules to runs; each element carries the elapsed time at {@code now}.
     */
    List<OverdueRun> overdueRuns(Instant now, int limit);

    /** The workflow's most recent SUCCESS/FAILED runs, newest finish first. */
    List<RecentRun> lastFinishedRuns(UUID workflowId, int limit);

    /**
     * Atomically (per rule and workflow) applies the cooldown and the one-firing-per-run guard; only when both
     * pass does it record the firing and enqueue the notification events in the same transaction.
     * Returns whether the rule fired.
     */
    boolean fire(AlertRule rule, UUID workflowId, UUID executionId, Instant now, Duration cooldown,
                 List<WorkflowNotificationEvent> events);

    record AlertRule(UUID id, UUID workspaceId, UUID workflowId, String name, AlertRuleType type,
                     int threshold, Integer windowMinutes, int cooldownMinutes, boolean enabled,
                     UUID createdBy, Instant createdAt, Instant updatedAt) {
    }

    record FinishedRun(UUID executionId, UUID workflowId, UUID workspaceId, String workflowName,
                       UUID workflowCreatedBy, ExecutionStatus status, Instant startedAt, Instant finishedAt) {
    }

    /** {@code run.finishedAt()} is null: the run is still going. */
    record OverdueRun(AlertRule rule, FinishedRun run) {
    }

    record RecentRun(ExecutionStatus status, Instant finishedAt) {
    }
}
