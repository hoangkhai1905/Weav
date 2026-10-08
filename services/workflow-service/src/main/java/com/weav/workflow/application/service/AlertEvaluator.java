package com.weav.workflow.application.service;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.application.port.out.AlertRuleStore;
import com.weav.workflow.application.port.out.AlertRuleStore.AlertRule;
import com.weav.workflow.application.port.out.AlertRuleStore.FinishedRun;
import com.weav.workflow.application.port.out.AlertRuleStore.OverdueRun;
import com.weav.workflow.application.port.out.AlertRuleStore.RecentRun;
import com.weav.workflow.application.port.out.ExecutionFinishedListener;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Evaluates the workspace's alert rules for one finished run. Runs after the execution commit and swallows every
 * failure: an alert problem must never change the run result (the run is already committed).
 *
 * <p>Both rule types are judged per workflow: a workspace-wide rule (no workflow) fires for the workflow whose run
 * just finished. Recipients are the rule creator and the workflow creator; the notification outbox publisher
 * re-checks WORKFLOW_MONITOR for each before sending.
 */
@Service
public final class AlertEvaluator implements ExecutionFinishedListener {
    private static final Logger LOGGER = LoggerFactory.getLogger(AlertEvaluator.class);

    private final AlertRuleStore store;
    private final Clock clock;

    public AlertEvaluator(AlertRuleStore store, @Qualifier("workflowExecutionClock") Clock clock) {
        this.store = Objects.requireNonNull(store);
        this.clock = Objects.requireNonNull(clock);
    }

    @Override
    public void onExecutionFinished(UUID executionId) {
        try {
            evaluate(executionId);
        } catch (RuntimeException exception) {
            LOGGER.warn("event=alert_evaluation_failed executionId={} cause={}", executionId,
                    exception.getClass().getSimpleName());
        }
    }

    /** Returns how many rules fired. Package-visible for tests; callers use {@link #onExecutionFinished}. */
    int evaluate(UUID executionId) {
        FinishedRun run = store.finishedRun(executionId).orElse(null);
        if (run == null) {
            return 0;
        }
        int fired = 0;
        for (AlertRule rule : store.enabledRules(run.workspaceId(), run.workflowId())) {
            try {
                if (evaluateRule(rule, run)) {
                    fired++;
                }
            } catch (RuntimeException exception) {
                LOGGER.warn("event=alert_rule_evaluation_failed ruleId={} executionId={} cause={}", rule.id(),
                        executionId, exception.getClass().getSimpleName());
            }
        }
        return fired;
    }

    private boolean evaluateRule(AlertRule rule, FinishedRun run) {
        Instant now = clock.instant();
        List<WorkflowNotificationEvent> events;
        if (rule.type() == AlertRuleType.LONG_RUNNING) {
            if (run.startedAt() == null || run.finishedAt() == null) {
                return false;
            }
            long seconds = Duration.between(run.startedAt(), run.finishedAt()).getSeconds();
            if (seconds <= rule.threshold()) {
                return false;
            }
            return fireLongRunning(rule, run, seconds, now);
        } else {
            if (run.status() != ExecutionStatus.FAILED || !failedInARow(rule, run)) {
                return false;
            }
            events = recipients(rule, run).stream().map(recipient ->
                    WorkflowNotificationEvent.consecutiveFailuresAlert(run.workspaceId(), recipient,
                            run.executionId(), run.workflowId(), run.workflowName(), rule.name(),
                            rule.threshold(), now)).toList();
        }
        return store.fire(rule, run.workflowId(), run.executionId(), now,
                Duration.ofMinutes(rule.cooldownMinutes()), events);
    }

    private boolean fireLongRunning(AlertRule rule, FinishedRun run, long seconds, Instant now) {
        List<WorkflowNotificationEvent> events = recipients(rule, run).stream()
                .map(recipient -> WorkflowNotificationEvent.longRunningAlert(
                        run.workspaceId(), recipient, run.executionId(), run.workflowId(), run.workflowName(),
                        rule.name(), seconds, rule.threshold(), now)).toList();
        return store.fire(rule, run.workflowId(), run.executionId(), now,
                Duration.ofMinutes(rule.cooldownMinutes()), events);
    }

    /**
     * Live watchdog for LONG_RUNNING rules: fires for runs that are still RUNNING/WAITING past a rule's threshold.
     * Safe next to the completion-time check and across instances: {@code fire} applies the cooldown and the
     * one-firing-per-(rule, run) guard. Returns how many rules fired; never throws.
     */
    public int sweepOverdue(int limit) {
        try {
            Instant now = clock.instant();
            int fired = 0;
            for (OverdueRun overdue : store.overdueRuns(now, limit)) {
                try {
                    long seconds = Duration.between(overdue.run().startedAt(), now).getSeconds();
                    if (fireLongRunning(overdue.rule(), overdue.run(), seconds, now)) {
                        fired++;
                    }
                } catch (RuntimeException exception) {
                    LOGGER.warn("event=alert_sweep_rule_failed ruleId={} executionId={} cause={}",
                            overdue.rule().id(), overdue.run().executionId(), exception.getClass().getSimpleName());
                }
            }
            return fired;
        } catch (RuntimeException exception) {
            LOGGER.warn("event=alert_sweep_failed cause={}", exception.getClass().getSimpleName());
            return 0;
        }
    }

    /** The last N finished runs all failed, and the oldest of them finished within the window of the newest. */
    private boolean failedInARow(AlertRule rule, FinishedRun run) {
        List<RecentRun> recent = store.lastFinishedRuns(run.workflowId(), rule.threshold());
        if (recent.size() < rule.threshold()
                || recent.stream().anyMatch(item -> item.status() != ExecutionStatus.FAILED)) {
            return false;
        }
        Duration span = Duration.between(recent.getLast().finishedAt(), recent.getFirst().finishedAt());
        return span.compareTo(Duration.ofMinutes(rule.windowMinutes())) <= 0;
    }

    private static Set<UUID> recipients(AlertRule rule, FinishedRun run) {
        Set<UUID> recipients = new LinkedHashSet<>();
        recipients.add(rule.createdBy());
        recipients.add(run.workflowCreatedBy());
        return recipients;
    }
}
