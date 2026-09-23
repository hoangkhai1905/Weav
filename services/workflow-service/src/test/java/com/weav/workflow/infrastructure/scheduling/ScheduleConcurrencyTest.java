package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.WorkflowTriggerPort;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.application.trigger.ScheduleTriggerService;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowTrigger;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.TriggerStatus;
import com.weav.workflow.infrastructure.messaging.ExecutionOutboxPublisher;
import com.weav.workflow.infrastructure.messaging.RabbitExecutionConfiguration;
import com.weav.workflow.infrastructure.persistence.repository.ExecutionStateAdapter;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Real PostgreSQL/Rabbit coverage for durable schedule admission and worker completion. */
@SpringBootTest(properties = {
        "weav.workflow.schedule.scanner.enabled=false",
        "weav.workflow.execution.worker.enabled=true",
        "weav.workflow.execution.worker.owner=task16-schedule-test",
        "weav.workflow.execution.worker.lease-duration=PT20S",
        "weav.workflow.execution.worker.heartbeat-interval=PT10S",
        "weav.workflow.execution.worker.max-transient-redeliveries=1",
        "weav.workflow.execution.worker.transient-redelivery-delay=1000",
        "weav.workflow.execution.recovery.initial-delay=3600000",
        "weav.workflow.execution.recovery.poll-interval=3600000",
        "weav.workflow.execution.recovery.batch-size=20",
        "weav.workflow.execution.recovery.queued-delivery-age=PT1M",
        "weav.workflow.execution.recovery.outbox-cooldown=PT1M",
        "weav.workflow.execution.max-concurrent-nodes=2",
        "weav.workflow.execution.executor-threads=4",
        "weav.workflow.execution.executor-queue-size=16",
        "weav.workflow.execution.timer-threads=2",
        "weav.workflow.http.executor.enabled=false",
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000",
        "weav.workflow.execution-outbox.batch-size=20",
        "weav.workflow.schedule.failure-backoff-ms=1000",
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import({WorkflowPublicationTestConfiguration.class, ScheduleConcurrencyTest.RuntimeConfiguration.class})
class ScheduleConcurrencyTest {
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-0000000000b1");

    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private WorkflowPublicationService publication;
    @Autowired
    private WorkflowTriggerPort triggers;
    @Autowired
    private ScheduleTriggerService schedules;
    @Autowired
    private ExecutionOutboxPublisher outboxPublisher;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private Clock workflowExecutionClock;
    @Autowired
    private RabbitAdmin rabbitAdmin;
    @Autowired
    private WorkflowPublicationTestConfiguration.ScheduleScanGate scanGate;
    @Autowired
    private WorkflowPublicationTestConfiguration.ScheduleAdvanceFailureInjector advanceFailure;
    @Autowired
    private CompletionSignal completion;

    @BeforeEach
    void reset() {
        completion.reset();
        scanGate.release();
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
    }

    @Test
    void concurrentScannersAdmitOneDurableSlotAndWorkerCompletesIt() throws Exception {
        Fixture fixture = publishSchedule("Concurrent schedule");
        Instant requestedSlot = workflowExecutionClock.instant().minus(Duration.ofMinutes(2));
        Instant scanTime = workflowExecutionClock.instant();
        setNextRun(fixture.triggerId(), requestedSlot);
        Instant slot = triggers.find(fixture.triggerId()).getNextRunAt();

        scanGate.arm(2);
        ExecutorService scanners = Executors.newFixedThreadPool(2);
        try {
            Future<ScheduleTriggerService.ScanResult> first = scanners.submit(() -> schedules.scan(scanTime, 10));
            Future<ScheduleTriggerService.ScanResult> second = scanners.submit(() -> schedules.scan(scanTime, 10));
            assertTrue(scanGate.awaitArrivals(Duration.ofSeconds(10)),
                    "both scanners must select the same durable due registration before processing");
            scanGate.release();
            ScheduleTriggerService.ScanResult firstResult = first.get(15, TimeUnit.SECONDS);
            ScheduleTriggerService.ScanResult secondResult = second.get(15, TimeUnit.SECONDS);

            assertEquals(2, firstResult.selected() + secondResult.selected());
            assertEquals(1, firstResult.admitted() + secondResult.admitted());
            assertEquals(0, firstResult.failed() + secondResult.failed());
        } finally {
            scanGate.release();
            scanners.shutdownNow();
        }

        assertEquals(1, countExecutions(fixture.triggerId()));
        assertEquals(1, countOutbox(fixture.triggerId()));
        WorkflowTrigger advanced = triggers.find(fixture.triggerId());
        assertEquals(slot, advanced.getLastTriggeredAt());
        assertTrue(advanced.getNextRunAt().isAfter(scanTime));
        assertEquals(slot.toString(), jdbc.queryForObject(
                "select input->>'scheduledAt' from workflow.workflow_executions where trigger_id = ?",
                String.class, fixture.triggerId()));

        UUID executionId = jdbc.queryForObject(
                "select id from workflow.workflow_executions where trigger_id = ?", UUID.class, fixture.triggerId());
        completion.expect(executionId);
        assertTrue(outboxPublisher.publishPending() >= 1);
        assertTrue(completion.await(Duration.ofSeconds(20)),
                "the Rabbit worker must commit terminal SUCCESS for the scheduled execution");
        assertEquals(ExecutionStatus.SUCCESS.name(), jdbc.queryForObject(
                "select status from workflow.workflow_executions where trigger_id = ?",
                String.class, fixture.triggerId()));
    }

    @Test
    void slotAdvanceFailureRollsBackAdmissionAndRetriesTheSameSlot() {
        Fixture fixture = publishSchedule("Retry schedule");
        Instant requestedSlot = workflowExecutionClock.instant().minus(Duration.ofMinutes(2));
        Instant scanTime = workflowExecutionClock.instant();
        setNextRun(fixture.triggerId(), requestedSlot);
        Instant slot = triggers.find(fixture.triggerId()).getNextRunAt();
        advanceFailure.arm();

        ScheduleTriggerService.ScanResult failed = schedules.scan(scanTime, 10);

        assertEquals(1, failed.failed());
        assertEquals(0, failed.admitted());
        assertEquals(0, countExecutions(fixture.triggerId()));
        assertEquals(0, countOutbox(fixture.triggerId()));
        WorkflowTrigger stillDue = triggers.find(fixture.triggerId());
        assertEquals(slot, stillDue.getNextRunAt());
        assertEquals("SCHEDULE_ADMISSION_FAILED", stillDue.getLastError().get("code"));

        Instant afterBackoff = Instant.parse((String) stillDue.getLastError().get("retryAt")).plusMillis(1);
        ScheduleTriggerService.ScanResult retried = schedules.scan(afterBackoff, 10);
        assertEquals(1, retried.admitted());
        assertEquals(0, retried.failed());
        assertEquals(1, countExecutions(fixture.triggerId()));
        assertEquals(1, countOutbox(fixture.triggerId()));
        assertEquals(slot, triggers.find(fixture.triggerId()).getLastTriggeredAt());
    }

    @Test
    void pauseResumeAndRepublishStartAtFutureSlotsWithoutReplayingPausedTicks() {
        Fixture fixture = publishSchedule("Lifecycle schedule");
        Instant requestedStaleSlot = workflowExecutionClock.instant().minus(Duration.ofMinutes(2));
        setNextRun(fixture.triggerId(), requestedStaleSlot);

        publication.pause(fixture.workspaceId(), fixture.workflowId(), ACTOR_ID);
        assertEquals(0, schedules.scan(workflowExecutionClock.instant(), 10).selected());

        publication.resume(fixture.workspaceId(), fixture.workflowId(), ACTOR_ID);
        WorkflowTrigger resumed = triggers.find(fixture.triggerId());
        assertEquals(TriggerStatus.ACTIVE, resumed.getStatus());
        assertTrue(resumed.getNextRunAt().isAfter(workflowExecutionClock.instant()));
        assertEquals(0, schedules.scan(workflowExecutionClock.instant(), 10).selected());
        assertEquals(0, countExecutions(fixture.triggerId()));

        publication.pause(fixture.workspaceId(), fixture.workflowId(), ACTOR_ID);
        WorkflowPublicationService.Publication republished = publication.publish(
                fixture.workspaceId(), fixture.workflowId(), ACTOR_ID);
        WorkflowTrigger old = triggers.find(fixture.triggerId());
        WorkflowTrigger current = triggers.findCurrent(fixture.workflowId(), republished.versionId()).stream()
                .filter(trigger -> trigger.getType() == com.weav.workflow.domain.valueobject.TriggerType.SCHEDULE)
                .findFirst().orElseThrow();
        assertEquals(TriggerStatus.DISABLED, old.getStatus());
        assertEquals(TriggerStatus.DISABLED, current.getStatus());
        publication.resume(fixture.workspaceId(), fixture.workflowId(), ACTOR_ID);
        WorkflowTrigger resumedRepublish = triggers.find(current.getId());
        assertEquals(TriggerStatus.ACTIVE, resumedRepublish.getStatus());
        assertTrue(resumedRepublish.getNextRunAt().isAfter(workflowExecutionClock.instant()));
        assertEquals(0, schedules.scan(workflowExecutionClock.instant(), 10).selected());
        assertEquals(0, countExecutions(fixture.triggerId()));
    }

    private Fixture publishSchedule(String name) {
        UUID workspaceId = UUID.randomUUID();
        Workflow draft = Workflow.createDraft(workspaceId, name, "Schedule integration test", ACTOR_ID);
        draft.updateDraft(name, "Schedule integration test", scheduleDefinition(), Map.of());
        workflows.save(draft);
        WorkflowPublicationService.Publication result = publication.publish(workspaceId, draft.getId(), ACTOR_ID);
        WorkflowTrigger schedule = triggers.findCurrent(draft.getId(), result.versionId()).stream()
                .filter(trigger -> trigger.getType() == com.weav.workflow.domain.valueobject.TriggerType.SCHEDULE)
                .findFirst().orElseThrow();
        assertEquals(TriggerStatus.ACTIVE, schedule.getStatus());
        assertNotNull(schedule.getNextRunAt());
        return new Fixture(workspaceId, draft.getId(), schedule.getId());
    }

    private Map<String, Object> scheduleDefinition() {
        Map<String, Object> manual = Map.of("id", "manual", "type", "trigger.manual", "config", Map.of());
        Map<String, Object> schedule = Map.of("id", "schedule", "type", "trigger.schedule",
                "config", Map.of("cron", "0 * * * * *", "timezone", "UTC"));
        Map<String, Object> actionConfig = new LinkedHashMap<>();
        actionConfig.put("method", "GET");
        actionConfig.put("url", "https://example.test/schedule");
        Map<String, Object> action = Map.of("id", "action", "type", "http.request", "config", actionConfig);
        Map<String, Object> edge = Map.of("id", "schedule-action", "source", "schedule", "target", "action");
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("schemaVersion", "1.0");
        definition.put("nodes", List.of(manual, schedule, action));
        definition.put("edges", List.of(edge));
        definition.put("variables", Map.of());
        return definition;
    }

    private void setNextRun(UUID triggerId, Instant scheduledAt) {
        jdbc.update("update workflow.workflow_triggers set next_run_at = ? where id = ?",
                Timestamp.from(scheduledAt), triggerId);
    }

    private int countExecutions(UUID triggerId) {
        return jdbc.queryForObject("select count(*) from workflow.workflow_executions where trigger_id = ?",
                Integer.class, triggerId);
    }

    private int countOutbox(UUID triggerId) {
        return jdbc.queryForObject("select count(*) from workflow.outbox_events "
                        + "where aggregate_id in (select id from workflow.workflow_executions where trigger_id = ?)",
                Integer.class, triggerId);
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class RuntimeConfiguration {
        @Bean
        DeterministicScheduleExecutor deterministicScheduleExecutor() {
            return new DeterministicScheduleExecutor();
        }

        @Bean
        CompletionSignal scheduleCompletionSignal() {
            return new CompletionSignal();
        }

        @Bean
        @Primary
        ExecutionStatePort completionAwareExecutionState(ExecutionStateAdapter delegate, CompletionSignal signal) {
            return new ExecutionStatePort() {
                @Override
                public java.util.Optional<Lease> claim(UUID executionId, String owner, Duration leaseDuration) {
                    return delegate.claim(executionId, owner, leaseDuration);
                }

                @Override
                public boolean renew(Lease lease, Duration leaseDuration) {
                    return delegate.renew(lease, leaseDuration);
                }

                @Override
                public Snapshot load(Lease lease) {
                    return delegate.load(lease);
                }

                @Override
                public boolean commit(Lease lease, Transition transition) {
                    boolean committed = delegate.commit(lease, transition);
                    if (committed && transition.status() == ExecutionStatus.SUCCESS) {
                        signal.complete(lease.executionId());
                    }
                    return committed;
                }

                @Override
                public void release(Lease lease) {
                    delegate.release(lease);
                }
            };
        }
    }

    static final class DeterministicScheduleExecutor implements NodeExecutor {
        @Override
        public String type() {
            return "http.request";
        }

        @Override
        public Result execute(Context context, Map<String, Object> resolvedConfig) {
            return new Result(Map.of("value", "scheduled"), null);
        }
    }

    static final class CompletionSignal {
        private final AtomicReference<CountDownLatch> latch = new AtomicReference<>(new CountDownLatch(1));
        private final AtomicReference<UUID> expectedExecution = new AtomicReference<>();

        void reset() {
            expectedExecution.set(null);
            latch.set(new CountDownLatch(1));
        }

        void expect(UUID executionId) {
            expectedExecution.set(executionId);
        }

        void complete(UUID executionId) {
            if (executionId.equals(expectedExecution.get())) {
                latch.get().countDown();
            }
        }

        boolean await(Duration timeout) throws InterruptedException {
            return latch.get().await(timeout.toMillis(), TimeUnit.MILLISECONDS);
        }
    }

    private record Fixture(UUID workspaceId, UUID workflowId, UUID triggerId) {
    }
}
