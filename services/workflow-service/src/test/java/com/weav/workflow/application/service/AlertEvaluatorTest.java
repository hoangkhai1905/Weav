package com.weav.workflow.application.service;

import com.weav.workflow.application.notification.WorkflowNotificationEvent;
import com.weav.workflow.application.port.out.AlertRuleStore;
import com.weav.workflow.application.port.out.AlertRuleStore.AlertRule;
import com.weav.workflow.application.port.out.AlertRuleStore.FinishedRun;
import com.weav.workflow.application.port.out.AlertRuleStore.RecentRun;
import com.weav.workflow.domain.valueobject.AlertRuleType;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AlertEvaluatorTest {
    private static final UUID WORKSPACE = UUID.randomUUID();
    private static final UUID WORKFLOW = UUID.randomUUID();
    private static final UUID RULE_CREATOR = UUID.randomUUID();
    private static final UUID WORKFLOW_CREATOR = UUID.randomUUID();
    private static final Instant T0 = Instant.parse("2026-10-08T10:00:00Z");

    private FakeStore store;
    private AlertEvaluator evaluator;
    private MutableClock clock;

    @BeforeEach
    void setUp() {
        store = new FakeStore();
        clock = new MutableClock(T0);
        evaluator = new AlertEvaluator(store, clock);
    }

    private AlertRule rule(AlertRuleType type, int threshold, Integer window, int cooldown, boolean enabled,
                           UUID workflowId) {
        AlertRule rule = new AlertRule(UUID.randomUUID(), WORKSPACE, workflowId, "Rule", type, threshold, window,
                cooldown, enabled, RULE_CREATOR, T0, T0);
        store.rules.add(rule);
        return rule;
    }

    /** Records a finished run; {@code minutesAgo} is relative to T0, the clock stays at T0. */
    private UUID run(ExecutionStatus status, long minutesAgo, long durationSeconds) {
        UUID id = UUID.randomUUID();
        Instant finished = T0.minus(Duration.ofMinutes(minutesAgo));
        store.runs.put(id, new FinishedRun(id, WORKFLOW, WORKSPACE, "Nightly sync", WORKFLOW_CREATOR, status,
                finished.minusSeconds(durationSeconds), finished));
        return id;
    }

    @Test
    void firesWhenTheLastNFinishedRunsAllFailedWithinTheWindow() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 3, 30, 60, true, WORKFLOW);
        run(ExecutionStatus.FAILED, 20, 5);
        run(ExecutionStatus.FAILED, 10, 5);
        UUID third = run(ExecutionStatus.FAILED, 0, 5);

        assertEquals(1, evaluator.evaluate(third));

        assertEquals(2, store.events.size());
        WorkflowNotificationEvent event = store.events.getFirst();
        assertEquals("monitoring.alert.consecutive_failures", event.eventType());
        assertEquals(third, event.entityId());
        assertEquals("3", event.data().get("failureCount"));
        assertEquals(List.of(RULE_CREATOR, WORKFLOW_CREATOR),
                store.events.stream().map(WorkflowNotificationEvent::recipientUserId).toList());
    }

    @Test
    void doesNotFireBelowTheThresholdOrAfterASuccessOrOutsideTheWindow() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 3, 30, 60, true, null);
        run(ExecutionStatus.FAILED, 10, 5);
        UUID second = run(ExecutionStatus.FAILED, 0, 5);
        assertEquals(0, evaluator.evaluate(second), "two failures are below the threshold of three");

        store.runs.clear();
        run(ExecutionStatus.FAILED, 20, 5);
        run(ExecutionStatus.SUCCESS, 10, 5);
        UUID afterSuccess = run(ExecutionStatus.FAILED, 0, 5);
        assertEquals(0, evaluator.evaluate(afterSuccess), "a success in between breaks the streak");

        store.runs.clear();
        run(ExecutionStatus.FAILED, 120, 5);
        run(ExecutionStatus.FAILED, 60, 5);
        UUID slowStreak = run(ExecutionStatus.FAILED, 0, 5);
        assertEquals(0, evaluator.evaluate(slowStreak), "the streak spans two hours, the window is 30 minutes");
        assertTrue(store.events.isEmpty());
    }

    @Test
    void aSuccessfulRunNeverFiresAFailureRule() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 1, 30, 60, true, null);
        UUID ok = run(ExecutionStatus.SUCCESS, 0, 5);

        assertEquals(0, evaluator.evaluate(ok));
    }

    @Test
    void workspaceWideRuleJudgesTheWorkflowThatJustFinished() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 1, 5, 60, true, null);
        UUID failed = run(ExecutionStatus.FAILED, 0, 5);

        assertEquals(1, evaluator.evaluate(failed));
        assertEquals(WORKFLOW.toString(), store.events.getFirst().data().get("workflowId"));
    }

    @Test
    void cooldownSuppressesRepeatsUntilItHasElapsed() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 1, 5, 60, true, WORKFLOW);
        UUID first = run(ExecutionStatus.FAILED, 0, 5);
        assertEquals(1, evaluator.evaluate(first));

        clock.set(T0.plus(Duration.ofMinutes(30)));
        UUID second = run(ExecutionStatus.FAILED, 0, 5);
        assertEquals(0, evaluator.evaluate(second), "still inside the 60 minute cooldown");

        clock.set(T0.plus(Duration.ofMinutes(61)));
        UUID third = run(ExecutionStatus.FAILED, 0, 5);
        assertEquals(1, evaluator.evaluate(third), "cooldown over");
        assertEquals(4, store.events.size());
    }

    @Test
    void theSameRunNeverFiresTheSameRuleTwice() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 1, 5, 0, true, WORKFLOW);
        UUID failed = run(ExecutionStatus.FAILED, 0, 5);

        assertEquals(1, evaluator.evaluate(failed));
        assertEquals(0, evaluator.evaluate(failed), "replaying the same run is a no-op even with no cooldown");
        assertEquals(2, store.events.size());
    }

    @Test
    void longRunningFiresOnlyAboveTheThresholdForSuccessAndFailureAlike() {
        rule(AlertRuleType.LONG_RUNNING, 60, null, 60, true, null);
        UUID within = run(ExecutionStatus.SUCCESS, 0, 60);
        assertEquals(0, evaluator.evaluate(within), "exactly at the threshold is not longer than it");

        UUID slow = run(ExecutionStatus.SUCCESS, 0, 125);
        assertEquals(1, evaluator.evaluate(slow));
        WorkflowNotificationEvent event = store.events.getFirst();
        assertEquals("monitoring.alert.long_running", event.eventType());
        assertEquals("125", event.data().get("durationSeconds"));
        assertEquals("60", event.data().get("thresholdSeconds"));
    }

    @Test
    void disabledRulesAndOtherWorkflowsRulesDoNotFire() {
        rule(AlertRuleType.LONG_RUNNING, 1, null, 0, false, null);
        rule(AlertRuleType.LONG_RUNNING, 1, null, 0, true, UUID.randomUUID());
        UUID slow = run(ExecutionStatus.SUCCESS, 0, 500);

        assertEquals(0, evaluator.evaluate(slow));
        assertTrue(store.events.isEmpty());
    }

    @Test
    void unknownOrUnfinishedRunsAreIgnored() {
        rule(AlertRuleType.LONG_RUNNING, 1, null, 0, true, null);

        assertEquals(0, evaluator.evaluate(UUID.randomUUID()));
    }

    @Test
    void aFailingStoreNeverEscapesTheCompletionHook() {
        rule(AlertRuleType.LONG_RUNNING, 1, null, 0, true, null);
        UUID slow = run(ExecutionStatus.SUCCESS, 0, 500);
        store.failOnFire = true;

        assertDoesNotThrow(() -> evaluator.onExecutionFinished(slow));
        store.failOnLookup = true;
        assertDoesNotThrow(() -> evaluator.onExecutionFinished(slow));
    }

    @Test
    void aFailingStoreNeverEscapesTheSweep() {
        store.failOnLookup = true;

        assertEquals(0, assertDoesNotThrow(() -> evaluator.sweepOverdue(200)));
    }

    @Test
    void oneBrokenRuleDoesNotStopTheOthers() {
        rule(AlertRuleType.CONSECUTIVE_FAILURES, 1, null, 0, true, null); // window missing: throws in the evaluator
        AlertRule good = rule(AlertRuleType.LONG_RUNNING, 1, null, 0, true, null);
        UUID slow = run(ExecutionStatus.FAILED, 0, 500);

        assertEquals(1, evaluator.evaluate(slow));
        assertTrue(store.firedRules.contains(good.id()));
    }

    private static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant now) {
            this.now = now;
        }

        void set(Instant value) {
            now = value;
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    /** In-memory store that applies the same cooldown and one-firing-per-run rules as the SQL adapter. */
    private static final class FakeStore implements AlertRuleStore {
        final List<AlertRule> rules = new ArrayList<>();
        final java.util.Map<UUID, FinishedRun> runs = new java.util.LinkedHashMap<>();
        final List<WorkflowNotificationEvent> events = new ArrayList<>();
        final List<UUID> firedRules = new ArrayList<>();
        private final List<Object[]> firings = new ArrayList<>();
        boolean failOnFire;
        boolean failOnLookup;

        @Override
        public List<AlertRule> list(UUID workspaceId) {
            return rules;
        }

        @Override
        public Optional<AlertRule> find(UUID workspaceId, UUID ruleId) {
            return rules.stream().filter(rule -> rule.id().equals(ruleId)).findFirst();
        }

        @Override
        public boolean workflowInWorkspace(UUID workspaceId, UUID workflowId) {
            return true;
        }

        @Override
        public boolean insertIfBelowLimit(AlertRule rule, int maxRules) {
            if (rules.size() >= maxRules) {
                return false;
            }
            rules.add(rule);
            return true;
        }

        @Override
        public List<OverdueRun> overdueRuns(Instant now, int limit) {
            if (failOnLookup) {
                throw new IllegalStateException("database down");
            }
            return List.of();
        }

        @Override
        public boolean update(AlertRule rule) {
            return true;
        }

        @Override
        public boolean delete(UUID workspaceId, UUID ruleId) {
            return rules.removeIf(rule -> rule.id().equals(ruleId));
        }

        @Override
        public Optional<FinishedRun> finishedRun(UUID executionId) {
            if (failOnLookup) {
                throw new IllegalStateException("database down");
            }
            return Optional.ofNullable(runs.get(executionId));
        }

        @Override
        public List<AlertRule> enabledRules(UUID workspaceId, UUID workflowId) {
            return rules.stream().filter(AlertRule::enabled)
                    .filter(rule -> rule.workflowId() == null || rule.workflowId().equals(workflowId)).toList();
        }

        @Override
        public List<RecentRun> lastFinishedRuns(UUID workflowId, int limit) {
            return runs.values().stream().filter(run -> run.workflowId().equals(workflowId))
                    .sorted(java.util.Comparator.comparing(FinishedRun::finishedAt).reversed())
                    .limit(limit).map(run -> new RecentRun(run.status(), run.finishedAt())).toList();
        }

        @Override
        public boolean fire(AlertRule rule, UUID workflowId, UUID executionId, Instant now, Duration cooldown,
                            List<WorkflowNotificationEvent> toSend) {
            if (failOnFire) {
                throw new IllegalStateException("outbox down");
            }
            boolean cooling = firings.stream().anyMatch(f -> f[0].equals(rule.id()) && f[1].equals(workflowId)
                    && ((Instant) f[3]).isAfter(now.minus(cooldown)));
            boolean duplicate = firings.stream().anyMatch(f -> f[0].equals(rule.id()) && f[2].equals(executionId));
            if (cooling || duplicate) {
                return false;
            }
            firings.add(new Object[] {rule.id(), workflowId, executionId, now});
            firedRules.add(rule.id());
            events.addAll(toSend);
            return true;
        }
    }
}
