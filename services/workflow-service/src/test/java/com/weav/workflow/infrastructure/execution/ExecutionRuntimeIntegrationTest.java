package com.weav.workflow.infrastructure.execution;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.dto.CreateWorkflowCommand;
import com.weav.workflow.application.execution.ExecutionRunner;
import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ExecutionAdmissionPort;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.RetryWaitPort;
import com.weav.workflow.application.service.ExecutionAdmissionService;
import com.weav.workflow.application.service.WorkflowDraftService;
import com.weav.workflow.application.service.WorkflowPublicationService;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.model.aggregate.workflow.Workflow;
import com.weav.workflow.domain.port.out.WorkflowRepository;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.infrastructure.messaging.ExecutionJobListener;
import com.weav.workflow.infrastructure.messaging.ExecutionOutboxPublisher;
import com.weav.workflow.infrastructure.messaging.ExecutionWorkerRabbitConfiguration;
import com.weav.workflow.infrastructure.messaging.RabbitExecutionConfiguration;
import com.weav.workflow.infrastructure.scheduling.ExecutionRecoveryScanner;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * Real PostgreSQL/RabbitMQ coverage for the enabled execution worker and the
 * concrete Task 11 runner. Provider behavior is deterministic and local to
 * this test; admission, delivery, leasing, graph transitions, and attempts
 * are the production implementations.
 */
@SpringBootTest(properties = {
        "weav.workflow.execution.worker.enabled=true",
        "weav.workflow.execution.worker.owner=task11-runtime-integration",
        "weav.workflow.execution.worker.lease-duration=PT20S",
        "weav.workflow.execution.worker.heartbeat-interval=PT10S",
        "weav.workflow.execution.worker.max-transient-redeliveries=3",
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
        "spring.rabbitmq.publisher-confirm-type=correlated",
        "spring.rabbitmq.publisher-returns=true",
        "spring.rabbitmq.template.mandatory=true"
})
@Import({WorkflowPublicationTestConfiguration.class, ExecutionRuntimeIntegrationTest.RuntimeConfiguration.class})
class ExecutionRuntimeIntegrationTest {
    private static final UUID ACTOR_ID = UUID.fromString("20000000-0000-0000-0000-0000000000a1");
    private static final Set<String> RUN_CAPABILITIES = Set.of(
            "WORKSPACE_VIEW", "WORKFLOW_CREATE", "WORKFLOW_EDIT", "WORKFLOW_PUBLISH",
            "WORKFLOW_RUN", "WORKFLOW_MANAGE_STATE", "WORKFLOW_MONITOR");

    @Autowired
    private ApplicationContext applicationContext;
    @Autowired
    private ExecutionAdmissionService admissionService;
    @Autowired
    private WorkflowDraftService draftService;
    @Autowired
    private WorkflowPublicationService publicationService;
    @Autowired
    private WorkflowRepository workflows;
    @Autowired
    private ExecutionOutboxPublisher publisher;
    @Autowired
    private ExecutionJobListener listener;
    @Autowired
    private ExecutionRecoveryScanner recovery;
    @Autowired
    private ExecutionStatePort executions;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private RabbitAdmin rabbitAdmin;
    @Autowired
    private WorkflowPublicationTestConfiguration.PublicationWorkspaceAccess workspaceAccess;
    @Autowired
    private DeterministicNodeExecutor fakeExecutor;
    @Autowired
    private NodeExecutorRegistry registry;
    @Autowired
    private RetryWaitPort retryWait;
    @Autowired
    @Qualifier("workflowExecutionExecutor")
    private ExecutorService nodePool;
    @Autowired
    @Qualifier("workflowExecutionTimer")
    private java.util.concurrent.ScheduledExecutorService timer;
    @Autowired
    @Qualifier("workflowExecutionClock")
    private Clock clock;
    @Autowired
    private ExecutionRunner runner;

    @BeforeEach
    void setUp() {
        workspaceAccess.setCapabilities(RUN_CAPABILITIES);
        fakeExecutor.reset();
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        rabbitAdmin.purgeQueue(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, false);
    }

    @AfterEach
    void tearDown() {
        workspaceAccess.reset();
        fakeExecutor.releaseBlockedNodes();
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.EXECUTION_QUEUE, false);
        rabbitAdmin.purgeQueue(RabbitExecutionConfiguration.DEAD_LETTER_QUEUE, false);
        rabbitAdmin.purgeQueue(ExecutionWorkerRabbitConfiguration.RETRY_QUEUE, false);
    }

    @Test
    void enabledWorkerUsesTheConcreteRunnerAndInjectedExecutorRegistry() {
        assertEquals(1, applicationContext.getBeansOfType(
                com.weav.workflow.application.port.in.ExecutionRunner.class).size());
        assertSame(runner, applicationContext.getBean(
                com.weav.workflow.application.port.in.ExecutionRunner.class));
        assertEquals(1, applicationContext.getBeansOfType(ExecutionJobListener.class).size());
        assertSame(fakeExecutor, registry.executors().get("http.request"));
    }

    @Test
    void admittedExecutionIsPublishedConsumedAndCompletedThroughTheRealRunner() throws Exception {
        fakeExecutor.blockNodes("left", "right");
        Fixture fixture = admit("parallel-join", parallelJoinDefinition(), Map.of("allow", true));

        assertEquals(ExecutionStatus.QUEUED.name(), status(fixture.executionId()));
        assertEquals("PENDING", outboxStatus(fixture.executionId()));

        assertTrue(publisher.publishPending() >= 1);
        assertTrue(fakeExecutor.awaitBlockedNodes(10, TimeUnit.SECONDS),
                "the real Rabbit listener did not reach both ready fake executors");
        assertEquals(2, fakeExecutor.maximumActive());
        assertEquals("RUNNING", status(fixture.executionId()));
        assertEquals(2, count("select count(*) from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ? and a.status = 'RUNNING'", fixture.executionId()));

        fakeExecutor.releaseBlockedNodes();
        awaitTerminal(fixture.executionId());

        assertEquals(ExecutionStatus.SUCCESS.name(), status(fixture.executionId()));
        assertEquals("PUBLISHED", outboxStatus(fixture.executionId()));
        assertEquals("SUCCESS", nodeStatus(fixture.executionId(), "condition"));
        assertEquals("SUCCESS", nodeStatus(fixture.executionId(), "left"));
        assertEquals("SUCCESS", nodeStatus(fixture.executionId(), "right"));
        assertEquals("SKIPPED", nodeStatus(fixture.executionId(), "inactive"));
        assertEquals("SUCCESS", nodeStatus(fixture.executionId(), "join"));
        assertEquals(0, fakeExecutor.calls("inactive"));
        assertEquals(1, count("select count(*) from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ? and n.node_id = 'join'", fixture.executionId()));

        Map<String, Object> joinConfig = fakeExecutor.config("join");
        assertNotNull(joinConfig);
        @SuppressWarnings("unchecked")
        Map<String, Object> body = (Map<String, Object>) joinConfig.get("body");
        assertEquals("left", body.get("left"));
        assertEquals("right", body.get("right"));
    }

    @Test
    void retryWaitsPersistAcrossFirstAndSecondFailuresAndSucceedsOnTheThirdAttempt() throws Exception {
        fakeExecutor.failuresBeforeSuccess(2);
        Fixture fixture = admit("retry-success", singleActionDefinition("retry"), Map.of());

        assertTrue(publisher.publishPending() >= 1);
        awaitTerminal(fixture.executionId());

        assertEquals(ExecutionStatus.SUCCESS.name(), status(fixture.executionId()));
        assertEquals(3, fakeExecutor.calls("retry"));
        List<String> attemptStatuses = jdbc.query(
                "select a.status from workflow.node_execution_attempts a "
                        + "join workflow.node_executions n on n.id = a.node_execution_id "
                        + "where n.execution_id = ? and n.node_id = 'retry' order by a.attempt_number",
                (rs, row) -> rs.getString(1), fixture.executionId());
        assertEquals(List.of("FAILED", "FAILED", "SUCCESS"), attemptStatuses);
        List<Instant> starts = jdbc.query(
                "select a.started_at from workflow.node_execution_attempts a "
                        + "join workflow.node_executions n on n.id = a.node_execution_id "
                        + "where n.execution_id = ? and n.node_id = 'retry' order by a.attempt_number",
                (rs, row) -> rs.getTimestamp(1).toInstant(), fixture.executionId());
        assertTrue(Duration.between(starts.get(0), starts.get(1)).toMillis() >= 700,
                () -> "first retry started too early: " + starts);
        assertTrue(Duration.between(starts.get(1), starts.get(2)).toMillis() >= 1700,
                () -> "second retry started too early: " + starts);
    }

    @Test
    void retryBudgetStopsAtThreePersistedFailedAttempts() throws Exception {
        fakeExecutor.failuresBeforeSuccess(3);
        Fixture fixture = admit("retry-failed", singleActionDefinition("retry"), Map.of());

        assertTrue(publisher.publishPending() >= 1);
        awaitTerminal(fixture.executionId());

        assertEquals(ExecutionStatus.FAILED.name(), status(fixture.executionId()));
        assertEquals(3, fakeExecutor.calls("retry"));
        assertEquals(3, count("select count(*) from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ? and n.node_id = 'retry' and a.status = 'FAILED'",
                fixture.executionId()));
        assertEquals("FAILED", nodeStatus(fixture.executionId(), "retry"));
        assertEquals("NETWORK_ERROR", scalar("select error ->> 'code' from workflow.workflow_executions "
                + "where id = ?", fixture.executionId()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"email.send", "telegram.send_message", "ai.extract", "ai.classify", "ai.summarize"})
    void unavailableIntegrationFailsOnceInRealDatabaseWithoutPersistingOutput(String type) throws Exception {
        NodeExecutor registered = registry.executors().get(type);
        assertNotNull(registered, "unavailable integration should have an explicit executor");
        assertEquals(type, registered.type());

        Fixture fixture = admit("unavailable-" + type.replace('.', '-'), unavailableActionDefinition(type), Map.of());
        assertEquals(ExecutionStatus.QUEUED.name(), status(fixture.executionId()),
                "manual admission should still accept the workflow");
        assertTrue(publisher.publishPending() >= 1);
        awaitTerminal(fixture.executionId());

        assertEquals(ExecutionStatus.FAILED.name(), status(fixture.executionId()));
        assertEquals("FAILED", nodeStatus(fixture.executionId(), "unavailable"));
        assertEquals(1, count("select count(*) from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ? and n.node_id = 'unavailable'", fixture.executionId()));
        assertEquals("DEPENDENCY_NOT_CONFIGURED", scalar("select a.error ->> 'code' "
                + "from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ? and n.node_id = 'unavailable'", fixture.executionId()));
        assertEquals(1, count("select count(*) from workflow.node_executions "
                + "where execution_id = ? and node_id = 'unavailable' and status = 'FAILED' "
                + "and output = '{}'::jsonb",
                fixture.executionId()));
        assertEquals(1, count("select count(*) from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ? and n.node_id = 'unavailable' "
                + "and a.output = '{}'::jsonb",
                fixture.executionId()));
        assertEquals(0, fakeExecutor.calls("unavailable"));
    }

    @Test
    void recoveryRepublishesExpiredWorkAndTheRunnerPreservesTheConsumedAttemptBudget() throws Exception {
        Fixture fixture = admit("recovery", singleActionDefinition("recovery"), Map.of());
        UUID actionId = jdbcUuid("select id from workflow.node_executions where execution_id = ? and node_id = 'recovery'",
                fixture.executionId());
        UUID interruptedAttempt = UUID.randomUUID();
        jdbc.update("update workflow.outbox_events set status = 'PUBLISHED', published_at = current_timestamp, "
                        + "created_at = current_timestamp - interval '10 minutes' where aggregate_id = ?",
                fixture.executionId());
        jdbc.update("update workflow.workflow_executions set status = 'RUNNING', lease_owner = 'dead-worker', "
                        + "lease_token = 9, lease_until = current_timestamp - interval '1 second', "
                        + "edge_states = cast(? as jsonb) where id = ?",
                "{\"root-recovery\":\"ACTIVE\"}", fixture.executionId());
        jdbc.update("update workflow.node_executions set status = 'SUCCESS', attempt_count = 0, "
                        + "started_at = current_timestamp, finished_at = current_timestamp "
                        + "where execution_id = ? and node_id = 'root'", fixture.executionId());
        jdbc.update("update workflow.node_executions set status = 'RUNNING', attempt_count = 1, "
                        + "started_at = current_timestamp, finished_at = null where id = ?", actionId);
        jdbc.update("insert into workflow.node_execution_attempts "
                        + "(id, node_execution_id, attempt_number, status, input, started_at, created_at) "
                        + "values (?, ?, 1, 'RUNNING', cast('{}' as jsonb), current_timestamp, current_timestamp)",
                interruptedAttempt, actionId);

        assertEquals(1, recovery.scanNow());
        assertEquals(1, publisher.publishPending());
        awaitTerminal(fixture.executionId());

        assertEquals(ExecutionStatus.SUCCESS.name(), status(fixture.executionId()));
        assertEquals(10L, scalarLong("select lease_token from workflow.workflow_executions where id = ?",
                fixture.executionId()));
        assertEquals(1, count("select count(*) from workflow.node_execution_attempts "
                + "where id = ? and status = 'FAILED' and error ->> 'code' = 'WORKER_INTERRUPTED'",
                interruptedAttempt));
        assertEquals(1, count("select count(*) from workflow.node_execution_attempts a "
                + "where a.node_execution_id = ? and a.attempt_number = 2 and a.status = 'SUCCESS'", actionId));
    }

    @Test
    void staleRunnerCannotCommitAfterASecondWorkerTakesTheLease() throws Exception {
        fakeExecutor.blockNodes("action");
        Fixture fixture = admit("lease-loss", singleActionDefinition("action"), Map.of());
        ExecutionStatePort.Lease staleLease = executions.claim(
                fixture.executionId(), "worker-old", Duration.ofSeconds(20)).orElseThrow();
        ExecutorService caller = Executors.newSingleThreadExecutor();
        try {
            var running = caller.submit(() -> runner.run(staleLease));
            assertTrue(fakeExecutor.awaitBlockedNodes(10, TimeUnit.SECONDS));
            jdbc.update("update workflow.workflow_executions set lease_until = current_timestamp - interval '1 second' "
                    + "where id = ?", fixture.executionId());
            ExecutionStatePort.Lease replacement = executions.claim(
                    fixture.executionId(), "worker-new", Duration.ofSeconds(20)).orElseThrow();
            assertEquals(2L, replacement.token());
            fakeExecutor.releaseBlockedNodes();
            running.get(10, TimeUnit.SECONDS);

            assertEquals("RUNNING", status(fixture.executionId()));
            assertEquals("worker-new", scalar("select lease_owner from workflow.workflow_executions where id = ?",
                    fixture.executionId()));
            assertEquals(2L, scalarLong("select lease_token from workflow.workflow_executions where id = ?",
                    fixture.executionId()));
            assertEquals("WAITING", nodeStatus(fixture.executionId(), "action"));
            assertEquals(0, count("select count(*) from workflow.node_execution_attempts a "
                    + "join workflow.node_executions n on n.id = a.node_execution_id "
                    + "where n.execution_id = ? and a.status = 'SUCCESS'", fixture.executionId()));
            executions.release(replacement);
            jdbc.update("update workflow.outbox_events set status = 'PUBLISHED', published_at = current_timestamp "
                    + "where aggregate_id = ?", fixture.executionId());
            jdbc.update("update workflow.workflow_executions set status = 'FAILED', error = cast(? as jsonb), "
                    + "finished_at = current_timestamp, lease_owner = null, lease_until = null where id = ?",
                    "{\"code\":\"TEST_CLEANUP\",\"message\":\"lease fencing fixture\"}", fixture.executionId());
        } finally {
            fakeExecutor.releaseBlockedNodes();
            caller.shutdownNow();
        }
    }

    @Test
    void shutdownStopsAClaimedExecutionBeforeAnyNodeAdmission() {
        Fixture fixture = admit("shutdown", singleActionDefinition("action"), Map.of());
        ExecutionStatePort.Lease lease = executions.claim(
                fixture.executionId(), "shutdown-worker", Duration.ofSeconds(20)).orElseThrow();
        ExecutionRunner stopped = new ExecutionRunner(executions, registry, retryWait, nodePool, timer, clock, 2);
        stopped.close();

        stopped.run(lease);

        assertEquals("RUNNING", status(fixture.executionId()));
        assertEquals(0, count("select count(*) from workflow.node_execution_attempts a "
                + "join workflow.node_executions n on n.id = a.node_execution_id "
                + "where n.execution_id = ?", fixture.executionId()));
        assertEquals(0, count("select count(*) from workflow.workflow_executions "
                + "where id = ? and lease_owner is not null", fixture.executionId()));
        jdbc.update("update workflow.outbox_events set status = 'PUBLISHED', published_at = current_timestamp "
                        + "where aggregate_id = ?", fixture.executionId());
        jdbc.update("update workflow.workflow_executions set status = 'FAILED', error = cast(? as jsonb), "
                        + "finished_at = current_timestamp where id = ?",
                "{\"code\":\"TEST_CLEANUP\",\"message\":\"shutdown fixture\"}", fixture.executionId());
    }

    @Test
    void shutdownWaitsForInFlightCallThenLeavesRecoveryAuthoritative() throws Exception {
        fakeExecutor.blockNodes("action");
        Fixture fixture = admit("shutdown-in-flight", singleActionDefinition("action"), Map.of());
        ExecutionStatePort.Lease lease = executions.claim(
                fixture.executionId(), "shutdown-in-flight-worker", Duration.ofSeconds(2)).orElseThrow();
        ExecutionRunner stopped = new ExecutionRunner(executions, registry, retryWait, nodePool, timer, clock, 2,
                Duration.ofSeconds(2), Duration.ofMillis(500));
        ExecutorService caller = Executors.newSingleThreadExecutor();
        try {
            var running = caller.submit(() -> stopped.run(lease));
            assertTrue(fakeExecutor.awaitBlockedNodes(10, TimeUnit.SECONDS));

            stopped.close();
            fakeExecutor.releaseBlockedNodes();
            running.get(10, TimeUnit.SECONDS);

            assertEquals("RUNNING", status(fixture.executionId()));
            assertEquals("RUNNING", nodeStatus(fixture.executionId(), "action"));
            assertEquals(1, count("select count(*) from workflow.node_execution_attempts a "
                    + "join workflow.node_executions n on n.id = a.node_execution_id "
                    + "where n.execution_id = ? and a.status = 'RUNNING'", fixture.executionId()));
            assertEquals(0, count("select count(*) from workflow.workflow_executions "
                    + "where id = ? and lease_owner is not null", fixture.executionId()));
        } finally {
            fakeExecutor.releaseBlockedNodes();
            caller.shutdownNow();
            jdbc.update("update workflow.node_execution_attempts set status = 'FAILED', "
                            + "error = cast(? as jsonb), finished_at = current_timestamp "
                            + "where node_execution_id in (select id from workflow.node_executions where execution_id = ?)",
                    "{\"code\":\"TEST_CLEANUP\",\"message\":\"shutdown in-flight fixture\"}", fixture.executionId());
            jdbc.update("update workflow.node_executions set status = 'FAILED', "
                            + "error = cast(? as jsonb), finished_at = current_timestamp, next_attempt_at = null "
                            + "where execution_id = ?", "{\"code\":\"TEST_CLEANUP\",\"message\":\"shutdown in-flight fixture\"}",
                    fixture.executionId());
            jdbc.update("update workflow.outbox_events set status = 'PUBLISHED', published_at = current_timestamp "
                            + "where aggregate_id = ?", fixture.executionId());
            jdbc.update("update workflow.workflow_executions set status = 'FAILED', error = cast(? as jsonb), "
                            + "finished_at = current_timestamp, lease_owner = null, lease_until = null where id = ?",
                    "{\"code\":\"TEST_CLEANUP\",\"message\":\"shutdown in-flight fixture\"}", fixture.executionId());
        }
    }

    private Fixture admit(String name, WorkflowDefinition definition, Object input) {
        UUID workspaceId = UUID.randomUUID();
        Workflow draft = draftService.create(new CreateWorkflowCommand(workspaceId, ACTOR_ID, name, null));
        draftService.save(workspaceId, draft.getId(), ACTOR_ID, name, null, definition, Map.of());
        publicationService.publish(workspaceId, draft.getId(), ACTOR_ID);
        Workflow published = workflows.findByWorkspaceAndId(workspaceId, draft.getId()).orElseThrow();
        assertEquals(com.weav.workflow.domain.valueobject.WorkflowStatus.PUBLISHED, published.getStatus());
        ExecutionAdmissionPort.Admission admission = admissionService.manual(
                workspaceId, draft.getId(), ACTOR_ID, input, name, null);
        return new Fixture(workspaceId, draft.getId(), admission.executionId());
    }

    private WorkflowDefinition parallelJoinDefinition() {
        return new WorkflowDefinition("1.0", List.of(
                node("root", "trigger.manual", Map.of()),
                node("condition", "logic.condition", Map.of(
                        "left", "{{ trigger.input.allow }}", "operator", "eq", "right", true)),
                httpNode("left", "https://example.test/left"),
                httpNode("right", "https://example.test/right"),
                httpNode("inactive", "https://example.test/inactive"),
                node("join", "http.request", Map.of(
                        "method", "POST", "url", "https://example.test/join",
                        "body", Map.of("left", "{{ nodes.left.output.value }}",
                                "right", "{{ nodes.right.output.value }}")))),
                List.of(
                        edge("root-condition", "root", "condition", null),
                        edge("condition-left", "condition", "left", "true"),
                        edge("condition-right", "condition", "right", "true"),
                        edge("condition-inactive", "condition", "inactive", "false"),
                        edge("left-join", "left", "join", null),
                        edge("right-join", "right", "join", null)),
                Map.of());
    }

    private WorkflowDefinition singleActionDefinition(String actionId) {
        return new WorkflowDefinition("1.0", List.of(
                node("root", "trigger.manual", Map.of()),
                httpNode(actionId, "https://example.test/" + actionId)),
                List.of(edge("root-" + actionId, "root", actionId, null)), Map.of());
    }

    private WorkflowDefinition unavailableActionDefinition(String type) {
        Map<String, Object> config = switch (type) {
            case "email.send" -> Map.of("to", "person@example.test", "subject", "Ready", "body", "Done");
            case "telegram.send_message" -> Map.of("chatId", "123", "text", "Done");
            case "ai.extract" -> Map.of("text", "Extract this");
            case "ai.classify" -> Map.of("content", "Classify this");
            case "ai.summarize" -> Map.of("inputText", "Summarize this", "maxLength", 200);
            default -> throw new IllegalArgumentException("Unsupported test type");
        };
        return new WorkflowDefinition("1.0", List.of(
                node("root", "trigger.manual", Map.of()), node("unavailable", type, config)),
                List.of(edge("root-unavailable", "root", "unavailable", null)), Map.of());
    }

    private static WorkflowDefinition.Node httpNode(String id, String url) {
        return node(id, "http.request", Map.of("method", "GET", "url", url));
    }

    private static WorkflowDefinition.Node node(String id, String type, Map<String, Object> config) {
        return new WorkflowDefinition.Node(id, type, config);
    }

    private static WorkflowDefinition.Edge edge(String id, String source, String target, String sourcePort) {
        return new WorkflowDefinition.Edge(id, source, target, sourcePort);
    }

    private void awaitTerminal(UUID executionId) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (System.nanoTime() < deadline) {
            String current = status(executionId);
            if (ExecutionStatus.SUCCESS.name().equals(current) || ExecutionStatus.FAILED.name().equals(current)
                    || ExecutionStatus.CANCELLED.name().equals(current)) {
                return;
            }
            Thread.sleep(100);
        }
        fail("Execution did not reach a terminal state: " + executionId + " status=" + status(executionId));
    }

    private String status(UUID executionId) {
        return scalar("select status from workflow.workflow_executions where id = ?", executionId);
    }

    private String outboxStatus(UUID executionId) {
        return scalar("select status from workflow.outbox_events where aggregate_id = ? order by created_at desc limit 1",
                executionId);
    }

    private String nodeStatus(UUID executionId, String nodeId) {
        return scalar("select status from workflow.node_executions where execution_id = ? and node_id = ?",
                executionId, nodeId);
    }

    private int count(String sql, Object... arguments) {
        return jdbc.queryForObject(sql, Integer.class, arguments);
    }

    private String scalar(String sql, Object... arguments) {
        return jdbc.queryForObject(sql, String.class, arguments);
    }

    private long scalarLong(String sql, Object... arguments) {
        return jdbc.queryForObject(sql, Long.class, arguments);
    }

    private UUID jdbcUuid(String sql, Object... arguments) {
        return jdbc.queryForObject(sql, UUID.class, arguments);
    }

    @TestConfiguration(proxyBeanMethods = false)
    @EnableScheduling
    static class RuntimeConfiguration {
        @Bean
        DeterministicNodeExecutor deterministicNodeExecutor() {
            return new DeterministicNodeExecutor();
        }
    }

    static final class DeterministicNodeExecutor implements NodeExecutor {
        private final AtomicInteger active = new AtomicInteger();
        private final AtomicInteger maximumActive = new AtomicInteger();
        private final AtomicInteger failuresBeforeSuccess = new AtomicInteger();
        private final Map<String, AtomicInteger> calls = new java.util.concurrent.ConcurrentHashMap<>();
        private final Map<String, Map<String, Object>> configs = new java.util.concurrent.ConcurrentHashMap<>();
        private volatile Set<String> blockedNodeIds = Set.of();
        private volatile CountDownLatch blockedEntered = new CountDownLatch(0);
        private volatile CountDownLatch blockedRelease = new CountDownLatch(0);

        @Override
        public String type() {
            return "http.request";
        }

        @Override
        public Result execute(Context context, Map<String, Object> resolvedConfig) {
            calls.computeIfAbsent(context.nodeId(), ignored -> new AtomicInteger()).incrementAndGet();
            configs.put(context.nodeId(), resolvedConfig);
            int concurrent = active.incrementAndGet();
            maximumActive.accumulateAndGet(concurrent, Math::max);
            try {
                if (blockedNodeIds.contains(context.nodeId())) {
                    blockedEntered.countDown();
                    try {
                        if (!blockedRelease.await(20, TimeUnit.SECONDS)) {
                            throw new Failure("TIMEOUT", "The deterministic executor gate timed out.", true);
                        }
                    } catch (InterruptedException exception) {
                        Thread.currentThread().interrupt();
                        throw new Failure("WORKER_INTERRUPTED", "The deterministic executor gate was interrupted.", true);
                    }
                }
                if ("retry".equals(context.nodeId()) && failuresBeforeSuccess.get() > 0
                        && failuresBeforeSuccess.getAndDecrement() > 0) {
                    throw new Failure("NETWORK_ERROR", "deterministic transient failure", true);
                }
                return new Result(Map.of("value", context.nodeId(), "attempt", context.attemptNumber()), null);
            } finally {
                active.decrementAndGet();
            }
        }

        void reset() {
            active.set(0);
            maximumActive.set(0);
            failuresBeforeSuccess.set(0);
            calls.clear();
            configs.clear();
            releaseBlockedNodes();
            blockedNodeIds = Set.of();
            blockedEntered = new CountDownLatch(0);
        }

        void failuresBeforeSuccess(int count) {
            failuresBeforeSuccess.set(count);
        }

        void blockNodes(String... nodeIds) {
            blockedNodeIds = Set.copyOf(Arrays.asList(nodeIds));
            blockedEntered = new CountDownLatch(nodeIds.length);
            blockedRelease = new CountDownLatch(1);
        }

        boolean awaitBlockedNodes(long timeout, TimeUnit unit) throws InterruptedException {
            return blockedEntered.await(timeout, unit);
        }

        void releaseBlockedNodes() {
            CountDownLatch release = blockedRelease;
            if (release != null) {
                release.countDown();
            }
        }

        int maximumActive() {
            return maximumActive.get();
        }

        int calls(String nodeId) {
            AtomicInteger count = calls.get(nodeId);
            return count == null ? 0 : count.get();
        }

        Map<String, Object> config(String nodeId) {
            return configs.get(nodeId);
        }
    }

    private record Fixture(UUID workspaceId, UUID workflowId, UUID executionId) {
    }
}
