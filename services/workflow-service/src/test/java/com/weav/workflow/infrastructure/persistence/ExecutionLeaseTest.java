package com.weav.workflow.infrastructure.persistence;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.domain.execution.GraphState;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecution;
import com.weav.workflow.domain.model.aggregate.execution.NodeExecutionAttempt;
import com.weav.workflow.domain.valueobject.AttemptStatus;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import com.weav.workflow.domain.valueobject.NodeExecutionStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.InvalidDataAccessApiUsageException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** PostgreSQL integration tests for execution ownership, takeover, and atomic fenced writes. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class ExecutionLeaseTest {
    private static final String DEFINITION = """
            {"schemaVersion":"1.0","nodes":[
              {"id":"root","type":"trigger.manual","config":{}},
              {"id":"done","type":"action.telegram","config":{}},
              {"id":"skipped","type":"action.telegram","config":{}},
              {"id":"running","type":"action.telegram","config":{}}],
             "edges":[
              {"id":"root-done","source":"root","target":"done"},
              {"id":"root-skipped","source":"root","target":"skipped"},
              {"id":"root-running","source":"root","target":"running"}],"variables":{}}
            """;

    @Autowired
    private ExecutionStatePort executions;
    @Autowired
    private JdbcTemplate jdbc;
    @Test
    void postgresFencingAllowsOnlyOneWorkerToClaimAQueuedExecution() throws Exception {
        Fixture fixture = fixture("QUEUED", "root", "[1,null,{\"source\":\"webhook\"}]", 0, false);
        ExecutorService workers = Executors.newFixedThreadPool(2);
        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        try {
            Future<Optional<ExecutionStatePort.Lease>> first = workers.submit(() -> claimTogether(
                    fixture.executionId(), "worker-a", ready, start));
            Future<Optional<ExecutionStatePort.Lease>> second = workers.submit(() -> claimTogether(
                    fixture.executionId(), "worker-b", ready, start));
            assertTrue(ready.await(5, TimeUnit.SECONDS));
            start.countDown();

            List<Optional<ExecutionStatePort.Lease>> results = List.of(
                    first.get(10, TimeUnit.SECONDS), second.get(10, TimeUnit.SECONDS));
            assertEquals(1, results.stream().filter(Optional::isPresent).count());
            assertEquals(1, jdbc.queryForObject(
                    "select count(*) from workflow.workflow_executions where id = ? and status = 'RUNNING' "
                            + "and lease_owner in ('worker-a','worker-b') and lease_token = 1",
                    Integer.class, fixture.executionId()));
        } finally {
            start.countDown();
            workers.shutdownNow();
        }
    }

    @Test
    void liveLeaseRenewsLoadsAndReleasesUsingPersistedFencingToken() {
        Fixture fixture = fixture("QUEUED", "root", "[1,null,{\"source\":\"webhook\"}]", 0, false);
        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker-a", Duration.ofSeconds(30))
                .orElseThrow();

        assertTrue(executions.renew(lease, Duration.ofSeconds(60)));
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        assertEquals(fixture.workflowId(), snapshot.workflowId());
        assertEquals(fixture.workspaceId(), snapshot.workspaceId());
        assertEquals(fixture.versionId(), snapshot.version().getId());
        assertEquals("root", snapshot.firingRoot());
        assertTrue(snapshot.input() instanceof List<?>);
        assertEquals(3, ((List<?>) snapshot.input()).size());
        assertNull(((List<?>) snapshot.input()).get(1));
        assertEquals(NodeExecutionStatus.PENDING, snapshot.nodes().get("done").getStatus());

        executions.release(lease);
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ? and lease_owner is null "
                        + "and lease_until is null and lease_token = ?",
                Integer.class, fixture.executionId(), lease.token()));
        ExecutionStatePort.Lease nextOwner = executions.claim(
                fixture.executionId(), "worker-b", Duration.ofSeconds(30)).orElseThrow();
        assertTrue(nextOwner.token() > lease.token());
        assertFalse(executions.renew(lease, Duration.ofSeconds(30)));
    }

    @Test
    void committedNodeAndAttemptNullMapsNormalizeToEmptyAndKeepNullFinishTimes() {
        Fixture fixture = fixture("QUEUED", "root", "{}", 0, false);
        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker-a", Duration.ofSeconds(30))
                .orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        NodeExecution original = snapshot.nodes().get("done");
        Instant startedAt = Instant.parse("2026-09-21T01:00:00Z");
        NodeExecution running = new NodeExecution(original.getId(), original.getExecutionId(), original.getNodeId(),
                original.getNodeType(), NodeExecutionStatus.RUNNING, original.getInput(), null, null,
                original.getAttemptCount() + 1, startedAt, null, original.getCreatedAt(), null);
        List<NodeExecution> nodes = new ArrayList<>(snapshot.nodes().values());
        for (int index = 0; index < nodes.size(); index++) {
            if (nodes.get(index).getNodeId().equals("done")) {
                nodes.set(index, running);
                break;
            }
        }
        Map<String, NodeExecutionStatus> nodeStatuses = new LinkedHashMap<>(snapshot.graph().nodes());
        nodeStatuses.put("done", NodeExecutionStatus.RUNNING);
        GraphState graph = new GraphState(nodeStatuses, snapshot.graph().edges());
        NodeExecutionAttempt attempt = new NodeExecutionAttempt(UUID.randomUUID(), running.getId(),
                running.getAttemptCount(), AttemptStatus.RUNNING, Map.of(), null, null, startedAt, null, startedAt);
        ExecutionStatePort.Transition transition = new ExecutionStatePort.Transition(graph, nodes,
                List.of(attempt), Map.of(), ExecutionStatus.RUNNING, null, null, null, List.of());

        assertTrue(executions.commit(lease, transition));

        ExecutionStatePort.Snapshot persisted = executions.load(lease);
        NodeExecution persistedNode = persisted.nodes().get("done");
        assertEquals(Map.of(), persistedNode.getInput());
        assertEquals(Map.of(), persistedNode.getOutput());
        assertEquals(Map.of(), persistedNode.getError());
        assertNull(persistedNode.getFinishedAt());
        assertEquals(1, persisted.attempts().size());
        NodeExecutionAttempt persistedAttempt = persisted.attempts().getFirst();
        assertEquals(Map.of(), persistedAttempt.getInput());
        assertEquals(Map.of(), persistedAttempt.getOutput());
        assertEquals(Map.of(), persistedAttempt.getError());
        assertNull(persistedAttempt.getFinishedAt());
    }

    @Test
    void takeoverPreservesCompletedNodesAndRecordsAnInterruptedAttemptWithoutResettingBudget() {
        Fixture fixture = fixture("RUNNING", "root", "{\"source\":\"manual\"}", 4, true);

        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker-new", Duration.ofSeconds(30))
                .orElseThrow();

        assertEquals(5, lease.token());
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id = ? and node_id = 'done' "
                        + "and status = 'SUCCESS' and output = cast('{\"ok\":true}' as jsonb)",
                Integer.class, fixture.executionId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id = ? and node_id = 'skipped' "
                        + "and status = 'SKIPPED'",
                Integer.class, fixture.executionId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id = ? and node_id = 'running' "
                        + "and status = 'WAITING' and attempt_count = 2 and next_attempt_at > CURRENT_TIMESTAMP "
                        + "and error ->> 'code' = 'WORKER_INTERRUPTED'",
                Integer.class, fixture.executionId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_execution_attempts where node_execution_id = ? "
                        + "and attempt_number = 2 and status = 'FAILED' and finished_at is not null "
                        + "and error ->> 'code' = 'WORKER_INTERRUPTED'",
                Integer.class, fixture.runningNodeId()));

        ExecutionStatePort.Snapshot recovered = executions.load(lease);
        assertEquals(NodeExecutionStatus.SUCCESS, recovered.graph().nodes().get("done"));
        assertEquals(NodeExecutionStatus.SKIPPED, recovered.graph().nodes().get("skipped"));
        assertEquals(NodeExecutionStatus.WAITING, recovered.graph().nodes().get("running"));
        assertEquals(2, recovered.nodes().get("running").getAttemptCount());
        assertNotNull(recovered.nextAttempts().get("running"));
    }

    @Test
    void anInterruptedThirdAttemptFailsInsteadOfResettingOrSchedulingAnotherAttempt() {
        Fixture fixture = fixture("RUNNING", "root", "{}", 2, true);
        jdbc.update("update workflow.node_executions set attempt_count = 3 where id = ?", fixture.runningNodeId());
        jdbc.update("update workflow.node_execution_attempts set attempt_number = 3 where node_execution_id = ? "
                + "and attempt_number = 2", fixture.runningNodeId());

        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker-new", Duration.ofSeconds(30))
                .orElseThrow();

        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where id = ? and status = 'FAILED' "
                        + "and attempt_count = 3 and next_attempt_at is null and finished_at is not null "
                        + "and error ->> 'code' = 'WORKER_INTERRUPTED'",
                Integer.class, fixture.runningNodeId()));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_execution_attempts where node_execution_id = ? "
                        + "and attempt_number = 3 and status = 'FAILED'",
                Integer.class, fixture.runningNodeId()));
        assertEquals(ExecutionStatus.RUNNING, executions.load(lease).status());
    }

    @Test
    void staleOwnerCannotCommitAfterAnotherWorkerTakesOver() {
        Fixture fixture = fixture("QUEUED", "root", "null", 0, false);
        ExecutionStatePort.Lease oldLease = executions.claim(fixture.executionId(), "worker-old", Duration.ofSeconds(30))
                .orElseThrow();
        ExecutionStatePort.Snapshot oldSnapshot = executions.load(oldLease);
        jdbc.update("update workflow.workflow_executions set lease_until = CURRENT_TIMESTAMP - INTERVAL '1 second' "
                + "where id = ?", fixture.executionId());
        executions.claim(fixture.executionId(), "worker-new", Duration.ofSeconds(30)).orElseThrow();

        ExecutionStatePort.Transition staleTransition = transition(
                oldSnapshot, ExecutionStatus.SUCCESS, Map.of("stale", true), Instant.parse("2026-09-21T00:00:00Z"));
        InvalidDataAccessApiUsageException staleLease = assertThrows(
                InvalidDataAccessApiUsageException.class, () -> executions.load(oldLease));
        assertTrue(staleLease.getMostSpecificCause() instanceof IllegalStateException);
        assertFalse(executions.commit(oldLease, staleTransition));
        executions.release(oldLease);
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ? and status = 'RUNNING' "
                        + "and output is null and lease_owner = 'worker-new' and lease_token = 2 "
                        + "and lease_until > CURRENT_TIMESTAMP",
                Integer.class, fixture.executionId()));
    }

    @Test
    void failedTransitionRollsBackExecutionAndNodeWritesTogether() {
        Fixture fixture = fixture("QUEUED", "root", "null", 0, false);
        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker-a", Duration.ofSeconds(30))
                .orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        NodeExecution original = snapshot.nodes().get("done");
        Instant now = Instant.parse("2026-09-21T00:00:00Z");
        NodeExecution changed = new NodeExecution(original.getId(), original.getExecutionId(), original.getNodeId(),
                original.getNodeType(), NodeExecutionStatus.SUCCESS, original.getInput(), Map.of("changed", true),
                null, 1, now, now, original.getCreatedAt(), null);
        Map<String, NodeExecutionStatus> nodeStatuses = new LinkedHashMap<>(snapshot.graph().nodes());
        nodeStatuses.put("done", NodeExecutionStatus.SUCCESS);
        GraphState graph = new GraphState(nodeStatuses, snapshot.graph().edges());
        NodeExecutionAttempt brokenAttempt = new NodeExecutionAttempt(UUID.randomUUID(), UUID.randomUUID(), 1,
                AttemptStatus.RUNNING, Map.of(), null, null, now, null, now);
        List<NodeExecution> changedNodes = new ArrayList<>(snapshot.nodes().values());
        for (int index = 0; index < changedNodes.size(); index++) {
            if (changedNodes.get(index).getNodeId().equals("done")) {
                changedNodes.set(index, changed);
                break;
            }
        }
        ExecutionStatePort.Transition transition = new ExecutionStatePort.Transition(graph,
                changedNodes, List.of(brokenAttempt), Map.of(), ExecutionStatus.SUCCESS,
                Map.of("changed", true), null, now, List.of());

        assertThrows(DataIntegrityViolationException.class, () -> executions.commit(lease, transition));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ? and status = 'RUNNING' "
                        + "and output is null and finished_at is null",
                Integer.class, fixture.executionId()));
        Map<String, Object> restoredNode = jdbc.queryForMap(
                "select status, output::text as output_json, attempt_count "
                        + "from workflow.node_executions where id = ?",
                original.getId());
        assertEquals("PENDING", restoredNode.get("status"), restoredNode.toString());
        assertNull(restoredNode.get("output_json"), restoredNode.toString());
        assertEquals(original.getAttemptCount(), ((Number) restoredNode.get("attempt_count")).intValue(),
                restoredNode.toString());
    }

    @Test
    void missingLegacyRootFailsVisiblyInsteadOfGuessingTheTrigger() {
        Fixture fixture = fixture("QUEUED", null, "null", 0, false);

        assertTrue(executions.claim(fixture.executionId(), "worker-a", Duration.ofSeconds(30)).isEmpty());
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_executions where id = ? and status = 'FAILED' "
                        + "and lease_owner is null and finished_at is not null "
                        + "and error ->> 'code' = 'LEGACY_STATE_UNRECOVERABLE'",
                Integer.class, fixture.executionId()));
    }

    private Optional<ExecutionStatePort.Lease> claimTogether(UUID executionId, String owner,
                                                              CountDownLatch ready, CountDownLatch start)
            throws InterruptedException {
        ready.countDown();
        if (!start.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("Concurrent claim start gate timed out");
        }
        return executions.claim(executionId, owner, Duration.ofSeconds(30));
    }

    private ExecutionStatePort.Transition transition(ExecutionStatePort.Snapshot snapshot,
                                                     ExecutionStatus status,
                                                     Map<String, Object> output, Instant finishedAt) {
        return new ExecutionStatePort.Transition(snapshot.graph(),
                new ArrayList<>(snapshot.nodes().values()), snapshot.attempts(), snapshot.nextAttempts(),
                status, output, null, finishedAt, List.of());
    }

    private Fixture fixture(String status, String root, String inputJson, long token, boolean takeover) {
        UUID workspaceId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        UUID rootNodeId = UUID.randomUUID();
        UUID doneNodeId = UUID.randomUUID();
        UUID skippedNodeId = UUID.randomUUID();
        UUID runningNodeId = UUID.randomUUID();
        jdbc.update("insert into workflow.workflows "
                        + "(id, workspace_id, name, status, schema_version, draft_definition, created_by) "
                        + "values (?, ?, 'Lease fixture', 'PUBLISHED', '1.0', cast(? as jsonb), ?)",
                workflowId, workspaceId, DEFINITION, actorId);
        jdbc.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                versionId, workflowId, DEFINITION, actorId);
        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", versionId, workflowId);
        jdbc.update("insert into workflow.workflow_executions "
                        + "(id, workflow_id, workflow_version_id, status, trigger_type, triggered_by, root_node_id, "
                        + "input, edge_states, lease_owner, lease_token, lease_until, started_at, created_at) "
                        + "values (?, ?, ?, ?, 'MANUAL', ?, ?, cast(? as jsonb), "
                        + "cast('{\"root-done\":\"ACTIVE\",\"root-skipped\":\"INACTIVE\","
                        + "\"root-running\":\"ACTIVE\"}' as jsonb), ?, ?, "
                        + (takeover ? "CURRENT_TIMESTAMP - INTERVAL '1 second'" : "null") + ", "
                        + ("RUNNING".equals(status) ? "CURRENT_TIMESTAMP - INTERVAL '10 seconds'" : "null") + ", "
                        + "CURRENT_TIMESTAMP - INTERVAL '10 minutes')",
                executionId, workflowId, versionId, status, actorId, root, inputJson,
                takeover ? "worker-old" : null, token);

        insertNode(executionId, rootNodeId, "root", "trigger.manual", "PENDING", 0, null, null, null);
        insertNode(executionId, doneNodeId, "done", "action.telegram", takeover ? "SUCCESS" : "PENDING", 1,
                takeover ? "{\"ok\":true}" : null, null, takeover ? Instant.parse("2026-09-21T00:00:00Z") : null);
        insertNode(executionId, skippedNodeId, "skipped", "action.telegram", takeover ? "SKIPPED" : "PENDING", 0, null, null, null);
        insertNode(executionId, runningNodeId, "running", "action.telegram", takeover ? "RUNNING" : "PENDING",
                takeover ? 2 : 0, null, takeover ? "{\"code\":\"TIMEOUT\"}" : null, null);
        if (takeover) {
            jdbc.update("insert into workflow.node_execution_attempts "
                            + "(id, node_execution_id, attempt_number, status, input, output, started_at, "
                            + "finished_at, created_at) values (?, ?, 1, 'SUCCESS', cast('{}' as jsonb), "
                            + "cast('{\"ok\":true}' as jsonb), CURRENT_TIMESTAMP - INTERVAL '3 minutes', "
                            + "CURRENT_TIMESTAMP - INTERVAL '2 minutes', CURRENT_TIMESTAMP - INTERVAL '3 minutes')",
                    UUID.randomUUID(), doneNodeId);
            jdbc.update("insert into workflow.node_execution_attempts "
                            + "(id, node_execution_id, attempt_number, status, input, output, error, started_at, "
                            + "finished_at, created_at) values (?, ?, 1, 'FAILED', cast('{}' as jsonb), null, "
                            + "cast('{\"code\":\"TIMEOUT\"}' as jsonb), CURRENT_TIMESTAMP - INTERVAL '2 minutes', "
                            + "CURRENT_TIMESTAMP - INTERVAL '1 minute', CURRENT_TIMESTAMP - INTERVAL '2 minutes')",
                    UUID.randomUUID(), runningNodeId);
            jdbc.update("insert into workflow.node_execution_attempts "
                            + "(id, node_execution_id, attempt_number, status, input, started_at, created_at) "
                            + "values (?, ?, 2, 'RUNNING', cast('{}' as jsonb), "
                            + "CURRENT_TIMESTAMP - INTERVAL '10 seconds', CURRENT_TIMESTAMP - INTERVAL '10 seconds')",
                    UUID.randomUUID(), runningNodeId);
        }
        return new Fixture(workspaceId, workflowId, versionId, executionId, rootNodeId, runningNodeId);
    }

    private void insertNode(UUID executionId, UUID id, String nodeId, String nodeType, String status, int attempts,
                            String outputJson, String errorJson, Instant finishedAt) {
        jdbc.update("insert into workflow.node_executions "
                        + "(id, execution_id, node_id, node_type, status, attempt_count, output, error, "
                        + "started_at, finished_at) values (?, ?, ?, ?, ?, ?, "
                        + "cast(? as jsonb), cast(? as jsonb), ?, ?)",
                id, executionId, nodeId, nodeType, status, attempts, outputJson, errorJson,
                finishedAt == null ? null : timestamp(finishedAt.minusSeconds(60)), timestamp(finishedAt));
    }

    private java.sql.Timestamp timestamp(Instant instant) {
        return instant == null ? null : java.sql.Timestamp.from(instant);
    }

    private record Fixture(UUID workspaceId, UUID workflowId, UUID versionId, UUID executionId,
                           UUID rootNodeId, UUID runningNodeId) {
    }
}
