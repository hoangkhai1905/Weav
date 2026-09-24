package com.weav.workflow.application.execution;

import com.weav.workflow.application.node.NodeExecutor;
import com.weav.workflow.application.node.NodeExecutorRegistry;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.RetryWaitPort;
import com.weav.workflow.domain.definition.DefinitionValidator;
import com.weav.workflow.domain.definition.JsonValues;
import com.weav.workflow.domain.definition.ValidationIssue;
import com.weav.workflow.domain.definition.WorkflowDefinition;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.execution.ReadinessPlanner;
import com.weav.workflow.domain.execution.RetryPolicy;
import com.weav.workflow.domain.mapping.MappingContext;
import com.weav.workflow.domain.mapping.MappingException;
import com.weav.workflow.domain.mapping.MappingResolver;
import com.weav.workflow.domain.model.aggregate.execution.ExecutionLog;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.LogLevel;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletionService;
import java.util.concurrent.ExecutorCompletionService;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs one fenced execution from its PostgreSQL snapshot. All state writes go
 * through the fenced port and provider calls happen outside those transactions.
 */
public final class ExecutionRunner implements com.weav.workflow.application.port.in.ExecutionRunner, AutoCloseable {
    private static final Logger LOGGER = LoggerFactory.getLogger(ExecutionRunner.class);
    private static final Duration DEFAULT_LEASE = Duration.ofSeconds(60);
    private static final Duration DEFAULT_HEARTBEAT = Duration.ofSeconds(15);

    private final ExecutionStatePort state;
    private final NodeAttemptRunner attempts;
    private final RetryWaitPort retryWait;
    private final ExecutorService executor;
    private final ScheduledExecutorService timer;
    private final Clock clock;
    private final int maxConcurrentNodes;
    private final Duration leaseDuration;
    private final Duration heartbeatInterval;
    private final ReadinessPlanner planner = new ReadinessPlanner();
    private final RetryPolicy retryPolicy = new RetryPolicy();
    private final MappingResolver mappingResolver = new MappingResolver();
    private final AtomicBoolean accepting = new AtomicBoolean(true);

    public ExecutionRunner(
            ExecutionStatePort state,
            NodeExecutorRegistry registry,
            RetryWaitPort retryWait,
            @Qualifier("workflowExecutionExecutor") ExecutorService executor,
            @Qualifier("workflowExecutionTimer") ScheduledExecutorService timer,
            @Qualifier("workflowExecutionClock") Clock clock,
            @Value("${weav.workflow.execution.max-concurrent-nodes:4}") int maxConcurrentNodes,
            @Value("${weav.workflow.execution.worker.lease-duration:PT60S}") Duration leaseDuration,
            @Value("${weav.workflow.execution.worker.heartbeat-interval:PT15S}") Duration heartbeatInterval) {
        this.state = Objects.requireNonNull(state, "state must not be null");
        this.attempts = new NodeAttemptRunner(Objects.requireNonNull(registry, "registry must not be null"));
        this.retryWait = Objects.requireNonNull(retryWait, "retryWait must not be null");
        this.executor = Objects.requireNonNull(executor, "executor must not be null");
        this.timer = Objects.requireNonNull(timer, "timer must not be null");
        this.clock = Objects.requireNonNull(clock, "clock must not be null");
        if (maxConcurrentNodes < 1 || maxConcurrentNodes > 128) {
            throw new IllegalArgumentException("Maximum concurrent nodes must be between one and 128");
        }
        this.maxConcurrentNodes = maxConcurrentNodes;
        this.leaseDuration = positiveBounded(leaseDuration, "lease duration", Duration.ofHours(24));
        this.heartbeatInterval = positiveBounded(heartbeatInterval, "heartbeat interval", this.leaseDuration)
                .compareTo(this.leaseDuration) >= 0
                ? this.leaseDuration.dividedBy(3).isZero() ? Duration.ofMillis(1) : this.leaseDuration.dividedBy(3)
                : heartbeatInterval;
    }

    /** Test-friendly constructor with explicit runtime dependencies and the default lease cadence. */
    public ExecutionRunner(ExecutionStatePort state, NodeExecutorRegistry registry, RetryWaitPort retryWait,
                           ExecutorService executor, ScheduledExecutorService timer, Clock clock,
                           int maxConcurrentNodes) {
        this(state, registry, retryWait, executor, timer, clock, maxConcurrentNodes,
                DEFAULT_LEASE, DEFAULT_HEARTBEAT);
    }

    @Override
    public void run(ExecutionStatePort.Lease lease) {
        Objects.requireNonNull(lease, "lease must not be null");
        if (!accepting.get()) {
            state.release(lease);
            return;
        }

        AtomicBoolean leaseLost = new AtomicBoolean(false);
        ScheduledFuture<?> heartbeat = scheduleHeartbeat(lease, leaseLost);
        try {
            runClaimed(lease, leaseLost);
        } finally {
            heartbeat.cancel(false);
            state.release(lease);
        }
    }

    private void runClaimed(ExecutionStatePort.Lease lease, AtomicBoolean leaseLost) {
        ExecutionStatePort.Snapshot snapshot = state.load(lease);
        RuntimeState runtime = new RuntimeState(snapshot, lease.executionId());
        if (!initializeIfNeeded(lease, runtime, leaseLost)) {
            return;
        }

        CompletionService<NodeCompletion> completions = new ExecutorCompletionService<>(executor);
        Map<Future<NodeCompletion>, String> running = new LinkedHashMap<>();
        boolean failureSeen = false;
        Map<String, Object> failure = null;

        while (accepting.get() && !leaseLost.get()) {
            promoteDueRetries(runtime, failureSeen);
            if (!failureSeen) {
                planner.ready(runtime.snapshot.definition(), runtime.graph);
            }
            persistPlannerChanges(lease, runtime, leaseLost);

            if (!failureSeen) {
                scheduleReadyNodes(lease, runtime, running, completions, leaseLost);
            }

            if (running.isEmpty()) {
                if (failureSeen) {
                    failure = failure == null ? runtime.error : failure;
                    finalizeFailure(lease, runtime, failure, leaseLost);
                    return;
                }
                if (allTerminal(runtime)) {
                    finalizeSuccess(lease, runtime, leaseLost);
                    return;
                }
                Instant nextRetry = earliestRetry(runtime);
                if (nextRetry != null) {
                    retryWait.until(nextRetry).toCompletableFuture().join();
                    continue;
                }
                // A nonterminal graph with no ready/running/retry work is corrupt or unsupported.
                failureSeen = true;
                failure = error("CONFIGURATION_ERROR", "The workflow could not make progress.");
                runtime.error = failure;
                continue;
            }

            try {
                CompletedNode completed = pollCompletion(completions, running, earliestRetry(runtime), runtime);
                if (completed == null) {
                    continue;
                }
                running.remove(completed.future());
                NodeCompletion completion = completed.completion();
                if (!commitCompletion(lease, runtime, completion, leaseLost)) {
                    return;
                }
                if (!completion.outcome().succeeded()) {
                    NodeExecutor.Failure nodeFailure = completion.outcome().failure();
                    if (!shouldRetry(nodeFailure, runtime.nodes.get(completion.nodeId()).getAttemptCount())) {
                        failureSeen = true;
                        failure = error(nodeFailure.code(), nodeFailure.safeMessage());
                        runtime.error = failure;
                    }
                }
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                failureSeen = true;
                failure = error("WORKER_INTERRUPTED", "The worker stopped before execution completed.");
                runtime.error = failure;
            }
        }

        if (!leaseLost.get() && !accepting.get()) {
            awaitRunning(running);
        }
    }

    private boolean initializeIfNeeded(ExecutionStatePort.Lease lease, RuntimeState runtime,
                                       AtomicBoolean leaseLost) {
        NodeExecution root = runtime.nodes.get(runtime.snapshot.firingRoot());
        if (root == null) {
            runtime.error = error("LEGACY_STATE_UNRECOVERABLE", "The execution root is missing.");
            return false;
        }
        if (runtime.graph.nodes().get(runtime.snapshot.firingRoot()) == NodeExecutionStatus.SUCCESS
                && root.getStatus() == NodeExecutionStatus.SUCCESS) {
            return true;
        }

        GraphState graph = planner.initialize(runtime.snapshot.definition(), runtime.snapshot.firingRoot());
        planner.ready(runtime.snapshot.definition(), graph);
        Instant now = clock.instant();
        Map<String, NodeExecution> initialized = new LinkedHashMap<>();
        for (WorkflowDefinition.Node definitionNode : runtime.snapshot.definition().nodes()) {
            if (definitionNode == null) {
                continue;
            }
            NodeExecution current = runtime.nodes.get(definitionNode.id());
            NodeExecutionStatus desired = graph.nodes().get(definitionNode.id());
            Instant finishedAt = desired == NodeExecutionStatus.SUCCESS || desired == NodeExecutionStatus.SKIPPED
                    ? now : current.getFinishedAt();
            Map<String, Object> output = current.getOutput();
            if (definitionNode.id().equals(runtime.snapshot.firingRoot())) {
                output = triggerOutput(runtime.snapshot.input());
            }
            initialized.put(definitionNode.id(), copyNode(current, desired, current.getInput(), output,
                    current.getError(), current.getAttemptCount(), desired == NodeExecutionStatus.SUCCESS ? now : current.getStartedAt(),
                    finishedAt, null));
        }
        runtime.graph = graph;
        runtime.nodes = initialized;
        runtime.nextAttempts.clear();
        if (!commit(lease, runtime, ExecutionStatus.RUNNING, null, null, List.of(), leaseLost)) {
            return false;
        }
        return true;
    }

    private void scheduleReadyNodes(ExecutionStatePort.Lease lease, RuntimeState runtime,
                                    Map<Future<NodeCompletion>, String> running,
                                    CompletionService<NodeCompletion> completions,
                                    AtomicBoolean leaseLost) {
        int available = maxConcurrentNodes - running.size();
        if (available <= 0) {
            return;
        }
        List<String> candidates = runtime.nodes.values().stream()
                .filter(node -> node.getStatus() == NodeExecutionStatus.READY)
                .map(NodeExecution::getNodeId)
                .filter(nodeId -> !running.containsValue(nodeId))
                .limit(available)
                .toList();
        if (candidates.isEmpty()) {
            return;
        }

        List<NodeExecutionAttempt> newAttempts = new ArrayList<>(runtime.attempts);
        Map<String, NodeExecution> started = new LinkedHashMap<>(runtime.nodes);
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>(runtime.graph.nodes());
        Instant now = clock.instant();
        Map<String, PreparedNode> prepared = new LinkedHashMap<>();
        for (String nodeId : candidates) {
            NodeExecution node = runtime.nodes.get(nodeId);
            WorkflowDefinition.Node definitionNode = definitionNode(runtime.snapshot.definition(), nodeId);
            Map<String, Object> rawConfig = definitionNode.config();
            int attemptNumber = node.getAttemptCount() + 1;
            NodeExecutionAttempt attempt = NodeExecutionAttempt.start(node.getId(), attemptNumber, rawConfig);
            newAttempts.add(attempt);
            started.put(nodeId, copyNode(node, NodeExecutionStatus.RUNNING, rawConfig, node.getOutput(), node.getError(),
                    attemptNumber, node.getStartedAt() == null ? now : node.getStartedAt(), null, null));
            statuses.put(nodeId, NodeExecutionStatus.RUNNING);
            prepared.put(nodeId, new PreparedNode(definitionNode, attempt, node, activeOutputs(runtime, nodeId)));
        }
        runtime.graph = new GraphState(statuses, runtime.graph.edges());
        runtime.nodes = started;
        runtime.attempts = newAttempts;
        runtime.nextAttempts.clear();
        if (!commit(lease, runtime, ExecutionStatus.RUNNING, runtime.output, runtime.error, List.of(), leaseLost)) {
            return;
        }

        for (PreparedNode preparedNode : prepared.values()) {
            if (leaseLost.get() || !accepting.get()) {
                return;
            }
            try {
                Future<NodeCompletion> future = completions.submit(() -> executeNode(runtime, preparedNode));
                running.put(future, preparedNode.definitionNode().id());
            } catch (RuntimeException exception) {
                NodeExecutor.Failure failure = new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
                        "The node executor could not be scheduled.", false);
                // The persisted RUNNING attempt will be recovered/fenced if the local executor rejects it.
                running.put(completions.submit(() -> NodeCompletion.failure(preparedNode.definitionNode().id(),
                        preparedNode.attempt(), NodeAttemptRunner.Outcome.failure(failure))),
                        preparedNode.definitionNode().id());
            }
        }
    }

    private NodeCompletion executeNode(RuntimeState runtime, PreparedNode prepared) {
        String nodeId = prepared.definitionNode().id();
        NodeExecution node = prepared.node();
        try {
            Map<String, Object> resolvedConfig = resolveConfig(runtime, prepared.definitionNode(), prepared.outputs());
            NodeAttemptRunner.Outcome outcome = attempts.execute(prepared.definitionNode().type(),
                    new NodeExecutor.Context(runtime.snapshot.workspaceId(), runtime.executionId, node.getId(),
                            nodeId, prepared.attempt().getAttemptNumber(), runtime.snapshot.correlationId(),
                            runtime.snapshot.traceparent()), resolvedConfig);
            return new NodeCompletion(nodeId, prepared.attempt(), outcome);
        } catch (MappingException exception) {
            return NodeCompletion.failure(nodeId, prepared.attempt(), NodeAttemptRunner.Outcome.failure(
                    new NodeExecutor.Failure("MAPPING_ERROR", "The node mapping could not be resolved.", false)));
        } catch (ConfigurationFailure exception) {
            return NodeCompletion.failure(nodeId, prepared.attempt(), NodeAttemptRunner.Outcome.failure(
                    new NodeExecutor.Failure("CONFIGURATION_ERROR", "The node configuration is invalid.", false)));
        } catch (RuntimeException exception) {
            return NodeCompletion.failure(nodeId, prepared.attempt(), NodeAttemptRunner.Outcome.failure(
                    new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED", "The node could not be executed safely.", false)));
        }
    }

    private Map<String, Object> resolveConfig(RuntimeState runtime, WorkflowDefinition.Node definitionNode,
                                              Map<String, Object> outputs) {
        Object resolved = mappingResolver.resolve(definitionNode.config(),
                new MappingContext(runtime.snapshot.input(), outputs, runtime.snapshot.definition().variables()),
                definitionNode.id(), "config");
        if (!(resolved instanceof Map<?, ?> map)) {
            throw new ConfigurationFailure();
        }
        Map<String, Object> config = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            if (!(entry.getKey() instanceof String key)) {
                throw new ConfigurationFailure();
            }
            config.put(key, entry.getValue());
        }
        WorkflowDefinition single = new WorkflowDefinition("1.0",
                List.of(new WorkflowDefinition.Node(definitionNode.id(), definitionNode.type(), config)),
                List.of(), Map.of());
        List<ValidationIssue> issues = new DefinitionValidator().validateDraft(single);
        if (!issues.isEmpty()) {
            throw new ConfigurationFailure();
        }
        return JsonValues.freezeMap(config);
    }

    private boolean commitCompletion(ExecutionStatePort.Lease lease, RuntimeState runtime,
                                     NodeCompletion completion, AtomicBoolean leaseLost) {
        if (leaseLost.get() || !accepting.get()) {
            return false;
        }
        NodeExecution node = runtime.nodes.get(completion.nodeId());
        NodeExecutionAttempt attempt = completion.attempt();
        Instant now = clock.instant();
        List<ExecutionLog> logs = new ArrayList<>();
        if (completion.outcome().succeeded()) {
            NodeExecutor.Result result = completion.outcome().result();
            attempt.succeed(result.output(), now);
            NodeExecution completed = copyNode(node, NodeExecutionStatus.SUCCESS, node.getInput(), result.output(),
                    Map.of(), node.getAttemptCount(), node.getStartedAt(), now, null);
            Map<String, NodeExecution> updatedNodes = new LinkedHashMap<>(runtime.nodes);
            updatedNodes.put(node.getNodeId(), completed);
            runtime.nodes = updatedNodes;
            runtime.graph = planner.afterSuccess(runtime.snapshot.definition(), runtime.graph, node.getNodeId(),
                    result.selectedPort());
            runtime.nextAttempts.remove(node.getNodeId());
            logs.add(new ExecutionLog(UUID.randomUUID(), runtime.executionId, node.getId(), attempt.getId(),
                    LogLevel.INFO, "NODE_SUCCEEDED", "Node completed successfully.", Map.of(), now));
            return commit(lease, runtime, ExecutionStatus.RUNNING, runtime.output, runtime.error, logs, leaseLost);
        }

        NodeExecutor.Failure failure = completion.outcome().failure();
        Map<String, Object> error = error(failure.code(), failure.safeMessage());
        attempt.fail(error, now);
        boolean retry = shouldRetry(failure, node.getAttemptCount());
        NodeExecutionStatus status = retry ? NodeExecutionStatus.WAITING : NodeExecutionStatus.FAILED;
        Instant next = retry ? now.plus(retryPolicy.delayAfter(node.getAttemptCount())) : null;
        NodeExecution failed = copyNode(node, status, node.getInput(), node.getOutput(), error,
                node.getAttemptCount(), node.getStartedAt(), retry ? null : now, next);
        Map<String, NodeExecution> updatedNodes = new LinkedHashMap<>(runtime.nodes);
        updatedNodes.put(node.getNodeId(), failed);
        runtime.nodes = updatedNodes;
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>(runtime.graph.nodes());
        statuses.put(node.getNodeId(), status);
        runtime.graph = new GraphState(statuses, runtime.graph.edges());
        if (retry) {
            runtime.nextAttempts.put(node.getNodeId(), next);
        } else {
            runtime.nextAttempts.remove(node.getNodeId());
            runtime.error = error;
        }
        logs.add(new ExecutionLog(UUID.randomUUID(), runtime.executionId, node.getId(), attempt.getId(),
                retry ? LogLevel.WARN : LogLevel.ERROR, retry ? "NODE_RETRY_SCHEDULED" : "NODE_FAILED",
                failure.safeMessage(), Map.of("code", failure.code()), now));
        return commit(lease, runtime, ExecutionStatus.RUNNING, runtime.output, runtime.error, logs, leaseLost);
    }

    private void persistPlannerChanges(ExecutionStatePort.Lease lease, RuntimeState runtime,
                                       AtomicBoolean leaseLost) {
        if (leaseLost.get()) {
            return;
        }
        Map<String, NodeExecution> updatedNodes = new LinkedHashMap<>(runtime.nodes);
        for (Map.Entry<String, NodeExecutionStatus> entry : runtime.graph.nodes().entrySet()) {
            NodeExecution node = updatedNodes.get(entry.getKey());
            if (node == null || node.getStatus() == entry.getValue()) {
                continue;
            }
            Instant finished = entry.getValue() == NodeExecutionStatus.SKIPPED ? clock.instant() : node.getFinishedAt();
            updatedNodes.put(entry.getKey(), copyNode(node, entry.getValue(), node.getInput(), node.getOutput(),
                    node.getError(), node.getAttemptCount(), node.getStartedAt(), finished,
                    entry.getValue() == NodeExecutionStatus.WAITING ? node.getNextAttemptAt() : null));
        }
        runtime.nodes = updatedNodes;
        commit(lease, runtime, ExecutionStatus.RUNNING, runtime.output, runtime.error, List.of(), leaseLost);
    }

    private void promoteDueRetries(RuntimeState runtime, boolean failureSeen) {
        if (failureSeen) {
            return;
        }
        Instant now = clock.instant();
        Map<String, NodeExecution> updatedNodes = new LinkedHashMap<>(runtime.nodes);
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>(runtime.graph.nodes());
        boolean changed = false;
        for (Map.Entry<String, Instant> entry : new ArrayList<>(runtime.nextAttempts.entrySet())) {
            if (entry.getValue().compareTo(now) > 0) {
                continue;
            }
            NodeExecution node = runtime.nodes.get(entry.getKey());
            if (node != null && node.getStatus() == NodeExecutionStatus.WAITING) {
                updatedNodes.put(entry.getKey(), copyNode(node, NodeExecutionStatus.PENDING, node.getInput(),
                        node.getOutput(), node.getError(), node.getAttemptCount(), node.getStartedAt(), null, null));
                statuses.put(entry.getKey(), NodeExecutionStatus.PENDING);
                changed = true;
            }
            runtime.nextAttempts.remove(entry.getKey());
        }
        if (changed) {
            runtime.nodes = updatedNodes;
            runtime.graph = new GraphState(statuses, runtime.graph.edges());
        }
    }

    private void finalizeSuccess(ExecutionStatePort.Lease lease, RuntimeState runtime, AtomicBoolean leaseLost) {
        if (leaseLost.get()) {
            return;
        }
        runtime.output = collectOutputs(runtime);
        commit(lease, runtime, ExecutionStatus.SUCCESS, runtime.output, null, List.of(), leaseLost,
                clock.instant());
    }

    private void finalizeFailure(ExecutionStatePort.Lease lease, RuntimeState runtime,
                                 Map<String, Object> failure, AtomicBoolean leaseLost) {
        if (leaseLost.get()) {
            return;
        }
        Map<String, NodeExecution> updatedNodes = new LinkedHashMap<>(runtime.nodes);
        Map<String, NodeExecutionStatus> statuses = new LinkedHashMap<>(runtime.graph.nodes());
        Instant now = clock.instant();
        for (Map.Entry<String, NodeExecution> entry : runtime.nodes.entrySet()) {
            NodeExecution node = entry.getValue();
            if (node.getStatus() == NodeExecutionStatus.PENDING || node.getStatus() == NodeExecutionStatus.READY
                    || node.getStatus() == NodeExecutionStatus.WAITING) {
                updatedNodes.put(entry.getKey(), copyNode(node, NodeExecutionStatus.CANCELLED, node.getInput(),
                        node.getOutput(), node.getError(), node.getAttemptCount(), node.getStartedAt(), now, null));
                statuses.put(entry.getKey(), NodeExecutionStatus.CANCELLED);
            }
        }
        runtime.nodes = updatedNodes;
        runtime.graph = new GraphState(statuses, runtime.graph.edges());
        runtime.nextAttempts.clear();
        runtime.error = failure == null ? error("DEPENDENCY_NOT_CONFIGURED", "The execution failed.") : failure;
        commit(lease, runtime, ExecutionStatus.FAILED, runtime.output, runtime.error, List.of(), leaseLost, now);
    }

    private boolean commit(ExecutionStatePort.Lease lease, RuntimeState runtime, ExecutionStatus status,
                           Map<String, Object> output, Map<String, Object> error, List<ExecutionLog> logs,
                           AtomicBoolean leaseLost) {
        return commit(lease, runtime, status, output, error, logs, leaseLost, null);
    }

    private boolean commit(ExecutionStatePort.Lease lease, RuntimeState runtime, ExecutionStatus status,
                           Map<String, Object> output, Map<String, Object> error, List<ExecutionLog> logs,
                           AtomicBoolean leaseLost, Instant finishedAt) {
        if (leaseLost.get()) {
            return false;
        }
        boolean committed = state.commit(lease, new ExecutionStatePort.Transition(runtime.graph,
                List.copyOf(runtime.nodes.values()), List.copyOf(runtime.attempts),
                Map.copyOf(runtime.nextAttempts), status, output, error, finishedAt, logs));
        if (!committed) {
            leaseLost.set(true);
        }
        return committed;
    }

    private boolean allTerminal(RuntimeState runtime) {
        return runtime.nodes.values().stream().allMatch(node ->
                node.getStatus() == NodeExecutionStatus.SUCCESS || node.getStatus() == NodeExecutionStatus.SKIPPED);
    }

    private Instant earliestRetry(RuntimeState runtime) {
        return runtime.nextAttempts.values().stream().min(Instant::compareTo).orElse(null);
    }

    private Map<String, Object> activeOutputs(RuntimeState runtime, String nodeId) {
        Map<String, Set<String>> predecessors = new LinkedHashMap<>();
        for (WorkflowDefinition.Edge edge : runtime.snapshot.definition().edges()) {
            if (edge != null && runtime.graph.edges().get(edge.id()) == GraphState.EdgeState.ACTIVE) {
                predecessors.computeIfAbsent(edge.target(), ignored -> new LinkedHashSet<>()).add(edge.source());
            }
        }
        Set<String> ancestors = new LinkedHashSet<>();
        List<String> pending = new ArrayList<>(predecessors.getOrDefault(nodeId, Set.of()));
        while (!pending.isEmpty()) {
            String id = pending.removeLast();
            if (!ancestors.add(id)) {
                continue;
            }
            pending.addAll(predecessors.getOrDefault(id, Set.of()));
        }
        Map<String, Object> outputs = new LinkedHashMap<>();
        for (String ancestor : ancestors) {
            NodeExecution node = runtime.nodes.get(ancestor);
            if (node != null && node.getStatus() == NodeExecutionStatus.SUCCESS) {
                outputs.put(ancestor, node.getOutput());
            }
        }
        return outputs;
    }

    private boolean shouldRetry(NodeExecutor.Failure failure, int attemptsConsumed) {
        Integer status = httpStatus(failure.code());
        return retryPolicy.canRetry(attemptsConsumed, failure.retryable()
                && retryPolicy.retryable(failure.code(), status));
    }

    private static Integer httpStatus(String code) {
        if (code == null) {
            return null;
        }
        String digits = code.startsWith("HTTP_") ? code.substring(5) : "";
        try {
            return digits.isEmpty() ? null : Integer.valueOf(digits);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private ScheduledFuture<?> scheduleHeartbeat(ExecutionStatePort.Lease lease, AtomicBoolean leaseLost) {
        long intervalMillis = Math.max(1L, heartbeatInterval.toMillis());
        return timer.scheduleAtFixedRate(() -> {
            if (!accepting.get() || leaseLost.get()) {
                return;
            }
            try {
                if (!state.renew(lease, leaseDuration)) {
                    leaseLost.set(true);
                }
            } catch (RuntimeException exception) {
                leaseLost.set(true);
                LOGGER.warn("Execution lease heartbeat failed ({})", exception.getClass().getSimpleName());
            }
        }, intervalMillis, intervalMillis, TimeUnit.MILLISECONDS);
    }

    private CompletedNode pollCompletion(CompletionService<NodeCompletion> completions,
                                         Map<Future<NodeCompletion>, String> running,
                                         Instant retryAt,
                                         RuntimeState runtime) throws InterruptedException {
        if (retryAt == null) {
            Future<NodeCompletion> future = completions.take();
            return new CompletedNode(future, getCompletion(future, running.get(future), runtime));
        }
        long timeout = Math.max(1L, Duration.between(clock.instant(), retryAt).toMillis());
        Future<NodeCompletion> future = completions.poll(timeout, TimeUnit.MILLISECONDS);
        return future == null ? null : new CompletedNode(future, getCompletion(future, running.get(future), runtime));
    }

    private NodeCompletion getCompletion(Future<NodeCompletion> future, String nodeId, RuntimeState runtime)
            throws InterruptedException {
        try {
            return future.get();
        } catch (java.util.concurrent.ExecutionException exception) {
            NodeExecutor.Failure failure = new NodeExecutor.Failure("DEPENDENCY_NOT_CONFIGURED",
                    "The node call did not return a safe result.", false);
            return NodeCompletion.failure(nodeId, latestAttempt(runtime, nodeId),
                    NodeAttemptRunner.Outcome.failure(failure));
        }
    }

    private NodeExecutionAttempt latestAttempt(RuntimeState runtime, String nodeId) {
        return runtime.attempts.stream()
                .filter(attempt -> {
                    NodeExecution node = runtime.nodes.get(nodeId);
                    return node != null && attempt.getNodeExecutionId().equals(node.getId());
                })
                .max(Comparator.comparing(NodeExecutionAttempt::getAttemptNumber))
                .orElseGet(() -> {
                    NodeExecution node = runtime.nodes.get(nodeId);
                    if (node == null) {
                        throw new IllegalStateException("Missing node for completed execution");
                    }
                    return NodeExecutionAttempt.start(node.getId(), Math.max(1, node.getAttemptCount()), node.getInput());
                });
    }

    private void awaitRunning(Map<Future<NodeCompletion>, String> running) {
        long waitMillis = Math.max(1L, Math.min(Duration.ofSeconds(30).toMillis(), leaseDuration.toMillis()));
        long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(waitMillis);
        for (Future<NodeCompletion> future : running.keySet()) {
            try {
                long remainingNanos = deadline - System.nanoTime();
                if (remainingNanos <= 0) {
                    return;
                }
                future.get(remainingNanos, TimeUnit.NANOSECONDS);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                return;
            } catch (TimeoutException | java.util.concurrent.ExecutionException ignored) {
                // Lease expiry and recovery remain authoritative after shutdown.
            }
        }
    }

    private WorkflowDefinition.Node definitionNode(WorkflowDefinition definition, String nodeId) {
        return definition.nodes().stream().filter(node -> node != null && nodeId.equals(node.id())).findFirst()
                .orElseThrow(() -> new ConfigurationFailure());
    }

    private static NodeExecution copyNode(NodeExecution source, NodeExecutionStatus status,
                                         Map<String, Object> input, Map<String, Object> output,
                                         Map<String, Object> error, int attempts, Instant startedAt,
                                         Instant finishedAt, Instant nextAttemptAt) {
        return new NodeExecution(source.getId(), source.getExecutionId(), source.getNodeId(), source.getNodeType(),
                status, input, output, error, attempts, startedAt, finishedAt, source.getCreatedAt(), nextAttemptAt);
    }

    private static Map<String, Object> triggerOutput(Object input) {
        Map<String, Object> output = new LinkedHashMap<>();
        output.put("input", JsonValues.freeze(input));
        return output;
    }

    private static Map<String, Object> collectOutputs(RuntimeState runtime) {
        Map<String, Object> outputs = new LinkedHashMap<>();
        runtime.nodes.values().stream().filter(node -> node.getStatus() == NodeExecutionStatus.SUCCESS)
                .forEach(node -> outputs.put(node.getNodeId(), node.getOutput()));
        return outputs;
    }

    private static Map<String, Object> error(String code, String message) {
        return Map.of("code", code == null || code.isBlank() ? "DEPENDENCY_NOT_CONFIGURED" : code,
                "message", message == null || message.isBlank() ? "The execution failed." : message);
    }

    private static Duration positiveBounded(Duration value, String name, Duration maximum) {
        if (value == null || value.isZero() || value.isNegative() || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException(name + " must be positive and bounded");
        }
        return value;
    }

    @PreDestroy
    @Override
    public void close() {
        accepting.set(false);
    }

    private static final class RuntimeState {
        private final ExecutionStatePort.Snapshot snapshot;
        private final UUID executionId;
        private Map<String, NodeExecution> nodes;
        private List<NodeExecutionAttempt> attempts;
        private GraphState graph;
        private final Map<String, Instant> nextAttempts;
        private Map<String, Object> output;
        private Map<String, Object> error;

        private RuntimeState(ExecutionStatePort.Snapshot snapshot, UUID executionId) {
            this.snapshot = snapshot;
            this.executionId = Objects.requireNonNull(executionId, "executionId must not be null");
            this.nodes = new LinkedHashMap<>(snapshot.nodes());
            this.attempts = new ArrayList<>(snapshot.attempts());
            this.graph = snapshot.graph();
            this.nextAttempts = new LinkedHashMap<>(snapshot.nextAttempts());
        }
    }

    private record PreparedNode(WorkflowDefinition.Node definitionNode,
                                NodeExecutionAttempt attempt, NodeExecution node, Map<String, Object> outputs) {
    }

    private record CompletedNode(Future<NodeCompletion> future, NodeCompletion completion) {
    }

    private record NodeCompletion(String nodeId, NodeExecutionAttempt attempt,
                                  NodeAttemptRunner.Outcome outcome) {
        private static NodeCompletion failure(String nodeId, NodeExecutionAttempt attempt,
                                              NodeAttemptRunner.Outcome outcome) {
            return new NodeCompletion(nodeId, attempt, outcome);
        }
    }

    private static final class ConfigurationFailure extends RuntimeException {
    }
}
