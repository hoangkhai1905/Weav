package com.weav.workflow.application.execution;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.RetryWaitPort;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.model.aggregate.workflow.WorkflowVersion;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExecutionRunnerTest {

    @Test
    void persistsRunningAttemptsBeforeCallingReadyNodesAndRunsThemConcurrently() throws Exception {
        CountDownLatch entered = new CountDownLatch(2);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger active = new AtomicInteger();
        AtomicInteger maximum = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            int now = active.incrementAndGet();
            maximum.accumulateAndGet(now, Math::max);
            entered.countDown();
            try {
                if (!release.await(5, TimeUnit.SECONDS)) {
                    throw new NodeExecutor.Failure("TIMEOUT", "The test gate timed out.", true);
                }
                return new NodeExecutor.Result(Map.of("node", context.nodeId()), null);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new NodeExecutor.Failure("WORKER_INTERRUPTED", "The test gate was interrupted.", true);
            } finally {
                active.decrementAndGet();
            }
        });
        WorkflowDefinition definition = definition(
                List.of(node("left", "http.request", Map.of()), node("right", "http.request", Map.of())),
                List.of(edge("root-left", "root", "left", null), edge("root-right", "root", "right", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(action), 2,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            var run = harness.callers.submit(() -> harness.runner.run(harness.lease));
            assertTrue(entered.await(5, TimeUnit.SECONDS), "both ready nodes should be admitted concurrently");
            assertEquals(2, maximum.get());
            assertEquals(NodeExecutionStatus.RUNNING, harness.state.snapshot().nodes().get("left").getStatus());
            assertEquals(NodeExecutionStatus.RUNNING, harness.state.snapshot().nodes().get("right").getStatus());
            assertEquals(2, harness.state.snapshot().attempts().stream()
                    .filter(attempt -> attempt.getStatus() == AttemptStatus.RUNNING).count());

            release.countDown();
            run.get(5, TimeUnit.SECONDS);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("left").getStatus());
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("right").getStatus());
        }
    }

    @Test
    void preservesAttemptBudgetAndPersistedOneAndTwoSecondRetryEligibility() {
        Instant base = Instant.parse("2026-09-22T00:00:00Z");
        List<Instant> retryTimes = new ArrayList<>();
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            if (calls.incrementAndGet() < 3) {
                throw new NodeExecutor.Failure("NETWORK_ERROR", "temporary provider failure", true);
            }
            return new NodeExecutor.Result(Map.of("attempt", context.attemptNumber()), null);
        });
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));
        AtomicReference<Instant> now = new AtomicReference<>(base);
        Clock clock = mutableClock(now);

        try (Harness harness = harness(definition, Map.of(), List.of(action), 1,
                eligibleAt -> {
                    retryTimes.add(eligibleAt);
                    now.set(eligibleAt);
                    return CompletableFuture.completedFuture(null);
                }, clock)) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(3, harness.state.snapshot().nodes().get("action").getAttemptCount());
            assertEquals(List.of(base.plusSeconds(1), base.plusSeconds(3)), retryTimes);
            assertEquals(List.of(AttemptStatus.FAILED, AttemptStatus.FAILED, AttemptStatus.SUCCESS),
                    harness.state.snapshot().attempts().stream().map(NodeExecutionAttempt::getStatus).toList());
            assertTrue(harness.state.snapshot().nextAttempts().isEmpty());
        }
    }

    @Test
    void exposesOnlySuccessfulActivePathOutputsToMappedNodesAndSkipsInactiveBranches() {
        AtomicReference<Map<String, Object>> resolvedConfig = new AtomicReference<>();
        AtomicInteger actionCalls = new AtomicInteger();
        NodeExecutor action = executor("http.request", (context, config) -> {
            actionCalls.incrementAndGet();
            resolvedConfig.set(config);
            return new NodeExecutor.Result(Map.of("seen", config.get("body")), null);
        });
        WorkflowDefinition definition = definition(
                List.of(
                        node("condition", "logic.condition", Map.of(
                                "left", "{{ trigger.input.allow }}", "operator", "eq", "right", true)),
                        node("selected", "http.request", Map.of("body", "{{ nodes.condition.output.value }}")),
                        node("inactive", "http.request", Map.of("body", "{{ nodes.condition.output.value }}"))),
                List.of(
                        edge("root-condition", "root", "condition", null),
                        edge("condition-selected", "condition", "selected", "true"),
                        edge("condition-inactive", "condition", "inactive", "false")));

        try (Harness harness = harness(definition, Map.of("allow", true), List.of(action), 2,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.SUCCESS, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(1, actionCalls.get());
            assertEquals(Map.of("body", true), resolvedConfig.get());
            assertEquals(NodeExecutionStatus.SUCCESS, harness.state.snapshot().nodes().get("selected").getStatus());
            assertEquals(NodeExecutionStatus.SKIPPED, harness.state.snapshot().nodes().get("inactive").getStatus());
        }
    }

    @Test
    void failsClosedForMissingAdaptersAndStoresOnlySanitizedTerminalErrors() {
        WorkflowDefinition definition = definition(
                List.of(node("action", "http.request", Map.of())),
                List.of(edge("root-action", "root", "action", null)));

        try (Harness harness = harness(definition, Map.of(), List.of(), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.FAILED, harness.state.snapshot().nodes().get("action").getStatus());
            assertEquals(AttemptStatus.FAILED, harness.state.snapshot().attempts().getFirst().getStatus());
            Map<String, Object> error = harness.state.snapshot().nodes().get("action").getError();
            assertEquals("DEPENDENCY_NOT_CONFIGURED", error.get("code"));
            assertNotNull(error.get("message"));
            assertFalse(error.get("message").toString().contains("secret"));
        }
    }

    @Test
    void mappingConfigurationAndAuthenticationFailuresConsumeOneAttemptWithoutRetry() {
        WorkflowDefinition mappingDefinition = definition(
                List.of(node("action", "http.request", Map.of(
                        "method", "GET", "url", "https://example.test",
                        "body", "{{ nodes.root.output.missing }}"))),
                List.of(edge("root-action", "root", "action", null)));
        assertSingleNonRetryableFailure(mappingDefinition, executor("http.request",
                (context, config) -> new NodeExecutor.Result(Map.of("unexpected", true), null)),
                "MAPPING_ERROR", 0);

        WorkflowDefinition configurationDefinition = definition(
                List.of(node("action", "http.request", Map.of(
                        "headers", Map.of("x-test", 42)))),
                List.of(edge("root-action", "root", "action", null)));
        assertSingleNonRetryableFailure(configurationDefinition, executor("http.request",
                (context, config) -> new NodeExecutor.Result(Map.of("unexpected", true), null)),
                "CONFIGURATION_ERROR", 0);

        WorkflowDefinition authenticationDefinition = definition(
                List.of(node("action", "http.request", Map.of(
                        "method", "GET", "url", "https://example.test"))),
                List.of(edge("root-action", "root", "action", null)));
        assertSingleNonRetryableFailure(authenticationDefinition, executor("http.request",
                (context, config) -> {
                    throw new NodeExecutor.Failure("AUTHENTICATION_REJECTED",
                            "The provider rejected the configured credentials.", false);
                }), "AUTHENTICATION_REJECTED", 1);
    }

    private void assertSingleNonRetryableFailure(WorkflowDefinition definition, NodeExecutor executor,
                                                 String expectedCode, int expectedCalls) {
        AtomicInteger calls = new AtomicInteger();
        NodeExecutor countingExecutor = executor("http.request", (context, config) -> {
            calls.incrementAndGet();
            return executor.execute(context, config);
        });
        try (Harness harness = harness(definition, Map.of(), List.of(countingExecutor), 1,
                eligibleAt -> CompletableFuture.completedFuture(null))) {
            harness.runner.run(harness.lease);

            assertEquals(ExecutionStatus.FAILED, harness.state.snapshot().status(), harness.state::summary);
            assertEquals(NodeExecutionStatus.FAILED, harness.state.snapshot().nodes().get("action").getStatus());
            assertEquals(1, harness.state.snapshot().nodes().get("action").getAttemptCount());
            assertEquals(List.of(AttemptStatus.FAILED), harness.state.snapshot().attempts().stream()
                    .map(NodeExecutionAttempt::getStatus).toList());
            assertEquals(expectedCode, harness.state.snapshot().nodes().get("action").getError().get("code"));
            assertTrue(harness.state.snapshot().nextAttempts().isEmpty());
            assertEquals(expectedCalls, calls.get());
        }
    }

    private static NodeExecutor executor(String type, Invoker invoker) {
        return new NodeExecutor() {
            @Override
            public String type() {
                return type;
            }

            @Override
            public Result execute(Context context, Map<String, Object> resolvedConfig) {
                return invoker.invoke(context, resolvedConfig);
            }
        };
    }

    private static WorkflowDefinition definition(List<WorkflowDefinition.Node> nodes,
                                                 List<WorkflowDefinition.Edge> edges) {
        List<WorkflowDefinition.Node> allNodes = new ArrayList<>();
        allNodes.add(node("root", "trigger.manual", Map.of()));
        allNodes.addAll(nodes);
        return new WorkflowDefinition("1.0", allNodes, edges, Map.of());
    }

    private static WorkflowDefinition.Node node(String id, String type, Map<String, Object> config) {
        return new WorkflowDefinition.Node(id, type, config);
    }

    private static WorkflowDefinition.Edge edge(String id, String source, String target, String sourcePort) {
        return new WorkflowDefinition.Edge(id, source, target, sourcePort);
    }

    private static Harness harness(WorkflowDefinition definition, Object input,
                                   List<NodeExecutor> executors, int concurrency,
                                   RetryWaitPort retryWait) {
        return harness(definition, input, executors, concurrency, retryWait,
                Clock.fixed(Instant.parse("2026-09-22T00:00:00Z"), ZoneOffset.UTC));
    }

    private static Clock mutableClock(AtomicReference<Instant> now) {
        return new Clock() {
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
                return now.get();
            }
        };
    }

    private static Harness harness(WorkflowDefinition definition, Object input,
                                   List<NodeExecutor> executors, int concurrency,
                                   RetryWaitPort retryWait, Clock clock) {
        UUID executionId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID workspaceId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-09-21T00:00:00Z");
        Map<String, NodeExecution> nodes = new LinkedHashMap<>();
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>();
        for (WorkflowDefinition.Node node : definition.nodes()) {
            UUID nodeExecutionId = UUID.randomUUID();
            nodes.put(node.id(), new NodeExecution(nodeExecutionId, executionId, node.id(), node.type(),
                    NodeExecutionStatus.PENDING, Map.of(), null, null, 0, null, null, createdAt, null));
            statuses.put(node.id(), NodeExecutionStatus.PENDING);
        }
        Map<String, GraphState.EdgeState> edges = new LinkedHashMap<>();
        definition.edges().forEach(edge -> edges.put(edge.id(), GraphState.EdgeState.UNKNOWN));
        WorkflowVersion version = new WorkflowVersion(UUID.randomUUID(), workflowId, 1, Map.of(), "1.0",
                UUID.randomUUID(), createdAt);
        ExecutionStatePort.Snapshot snapshot = new ExecutionStatePort.Snapshot(workflowId, workspaceId, version,
                definition, "root", input, new GraphState(statuses, edges), nodes, List.of(), Map.of(),
                "correlation-id", "00-trace", ExecutionStatus.QUEUED);
        ExecutionStatePort.Lease lease = new ExecutionStatePort.Lease(executionId, "test-worker", 1);
        InMemoryState state = new InMemoryState(snapshot, lease);
        ExecutorService nodeExecutor = Executors.newFixedThreadPool(concurrency);
        ScheduledExecutorService timer = Executors.newScheduledThreadPool(2);
        ExecutorService callers = Executors.newSingleThreadExecutor();
        ExecutionRunner runner = new ExecutionRunner(state, new NodeExecutorRegistry(executors.toArray(NodeExecutor[]::new)),
                retryWait, nodeExecutor, timer, clock, concurrency);
        return new Harness(runner, state, lease, nodeExecutor, timer, callers);
    }

    @FunctionalInterface
    private interface Invoker {
        NodeExecutor.Result invoke(NodeExecutor.Context context, Map<String, Object> config);
    }

    private record Harness(ExecutionRunner runner, InMemoryState state, ExecutionStatePort.Lease lease,
                           ExecutorService nodes, ScheduledExecutorService timer, ExecutorService callers)
            implements AutoCloseable {
        @Override
        public void close() {
            runner.close();
            callers.shutdownNow();
            nodes.shutdownNow();
            timer.shutdownNow();
        }
    }

    private static final class InMemoryState implements ExecutionStatePort {
        private volatile Snapshot snapshot;
        private final Lease lease;

        private InMemoryState(Snapshot snapshot, Lease lease) {
            this.snapshot = snapshot;
            this.lease = lease;
        }

        @Override
        public Optional<Lease> claim(UUID executionId, String owner, java.time.Duration leaseDuration) {
            return Optional.of(lease);
        }

        @Override
        public boolean renew(Lease lease, java.time.Duration leaseDuration) {
            return this.lease.equals(lease);
        }

        @Override
        public Snapshot load(Lease lease) {
            if (!this.lease.equals(lease)) {
                throw new IllegalStateException("unknown lease");
            }
            return snapshot;
        }

        @Override
        public synchronized boolean commit(Lease lease, Transition transition) {
            if (!this.lease.equals(lease)) {
                return false;
            }
            Map<String, NodeExecution> nodes = new LinkedHashMap<>();
            transition.nodes().forEach(node -> nodes.put(node.getNodeId(), node));
            snapshot = new Snapshot(snapshot.workflowId(), snapshot.workspaceId(), snapshot.version(),
                    snapshot.definition(), snapshot.firingRoot(), snapshot.input(), transition.graph(), nodes,
                    transition.attempts(), transition.nextAttempts(), snapshot.correlationId(), snapshot.traceparent(),
                    transition.status());
            return true;
        }

        @Override
        public void release(Lease lease) {
            // The in-memory fixture does not need a release marker.
        }

        Snapshot snapshot() {
            return snapshot;
        }

        String summary() {
            return "status=" + snapshot.status() + ", nodes=" + snapshot.nodes().entrySet().stream()
                    .map(entry -> entry.getKey() + "=" + entry.getValue().getStatus()
                            + ":" + entry.getValue().getError() + "/" + entry.getValue().getAttemptCount())
                    .toList()
                    + ", attempts=" + snapshot.attempts().stream()
                    .map(attempt -> attempt.getAttemptNumber() + "=" + attempt.getStatus()
                            + ":" + attempt.getError()).toList();
        }
    }
}
