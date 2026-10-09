package com.weav.workflow.infrastructure.persistence;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import com.weav.workflow.application.port.out.ExecutionStatePort;
import com.weav.workflow.application.port.out.ExecutionStatePort.CancelResult;
import com.weav.workflow.domain.valueobject.ExecutionStatus;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** W6-C3: PostgreSQL behaviour of "stop a run" (request, race with a finished run, no failure notification). */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class ExecutionCancelStateTest {
    private static final String DEFINITION = """
            {"schemaVersion":"1.0","nodes":[
              {"id":"root","type":"trigger.manual","config":{}},
              {"id":"call","type":"http.request","config":{}}],
             "edges":[{"id":"root-call","source":"root","target":"call"}],"variables":{}}
            """;

    @Autowired
    private ExecutionStatePort executions;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void queuedRunIsCancelledAtOnceAndItsNodesAreCancelled() {
        Fixture fixture = fixture("QUEUED");

        assertEquals(CancelResult.CANCELLED, cancel(fixture));

        assertEquals("CANCELLED", status(fixture));
        assertEquals("CANCELLED_BY_USER", jdbc.queryForObject(
                "select error->>'code' from workflow.workflow_executions where id = ?", String.class,
                fixture.executionId()));
        assertEquals(0, jdbc.queryForObject("select count(*) from workflow.node_executions "
                + "where execution_id = ? and status <> 'CANCELLED'", Integer.class, fixture.executionId()));
        assertEquals(0, notifications(fixture));
    }

    @Test
    void runningRunGetsTheFlagAndStaysRunning() {
        Fixture fixture = fixture("RUNNING");
        assertFalse(executions.isCancelRequested(fixture.executionId()));

        assertEquals(CancelResult.REQUESTED, cancel(fixture));
        assertEquals(CancelResult.REQUESTED, cancel(fixture));

        assertEquals("RUNNING", status(fixture));
        assertTrue(executions.isCancelRequested(fixture.executionId()));
    }

    @Test
    void aRecoveredRunWithAnExpiredLeaseKeepsItsStopRequestAcrossTheClaim() {
        Fixture fixture = fixture("RUNNING");
        assertEquals(CancelResult.REQUESTED, cancel(fixture));
        jdbc.update("update workflow.workflow_executions set lease_owner = 'dead-worker', "
                + "lease_until = CURRENT_TIMESTAMP - INTERVAL '1 minute' where id = ?", fixture.executionId());

        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker-2", Duration.ofSeconds(30))
                .orElseThrow();

        assertEquals("RUNNING", status(fixture));
        assertTrue(executions.isCancelRequested(lease.executionId()));
    }

    @Test
    void finishedRunIsNeverOverwritten() {
        Fixture fixture = fixture("SUCCESS");

        assertEquals(CancelResult.ALREADY_FINISHED, cancel(fixture));

        assertEquals("SUCCESS", status(fixture));
        assertFalse(executions.isCancelRequested(fixture.executionId()));
    }

    @Test
    void anotherWorkflowOrWorkspaceSeesNotFound() {
        Fixture fixture = fixture("QUEUED");
        Instant now = Instant.now();

        assertEquals(CancelResult.NOT_FOUND,
                executions.requestCancel(fixture.workspaceId(), UUID.randomUUID(), fixture.executionId(), now));
        assertEquals(CancelResult.NOT_FOUND,
                executions.requestCancel(UUID.randomUUID(), fixture.workflowId(), fixture.executionId(), now));
        assertEquals("QUEUED", status(fixture));
    }

    @Test
    void cancelledTerminalCommitWritesNoFailureNotification() {
        Fixture fixture = fixture("QUEUED");
        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker", Duration.ofSeconds(30))
                .orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);
        assertEquals("Cancel fixture", snapshot.workflowName());

        boolean committed = executions.commit(lease, new ExecutionStatePort.Transition(snapshot.graph(),
                List.copyOf(snapshot.nodes().values()), snapshot.attempts(), Map.of(), ExecutionStatus.CANCELLED,
                null, Map.of("code", "CANCELLED_BY_USER", "message", "stopped"), Instant.now(), List.of()));

        assertTrue(committed);
        assertEquals("CANCELLED", status(fixture));
        assertEquals(0, notifications(fixture));
    }

    @Test
    void failedTerminalCommitStillWritesTheFailureNotification() {
        Fixture fixture = fixture("QUEUED");
        ExecutionStatePort.Lease lease = executions.claim(fixture.executionId(), "worker", Duration.ofSeconds(30))
                .orElseThrow();
        ExecutionStatePort.Snapshot snapshot = executions.load(lease);

        assertTrue(executions.commit(lease, new ExecutionStatePort.Transition(snapshot.graph(),
                List.copyOf(snapshot.nodes().values()), snapshot.attempts(), Map.of(), ExecutionStatus.FAILED,
                null, Map.of("code", "X", "message", "failed"), Instant.now(), List.of())));

        assertEquals(1, notifications(fixture));
    }

    private CancelResult cancel(Fixture fixture) {
        return executions.requestCancel(fixture.workspaceId(), fixture.workflowId(), fixture.executionId(),
                Instant.now());
    }

    private String status(Fixture fixture) {
        return jdbc.queryForObject("select status from workflow.workflow_executions where id = ?", String.class,
                fixture.executionId());
    }

    private int notifications(Fixture fixture) {
        return jdbc.queryForObject("select count(*) from workflow.notification_outbox where entity_id = ?",
                Integer.class, fixture.executionId());
    }

    private Fixture fixture(String status) {
        UUID workspaceId = UUID.randomUUID();
        UUID workflowId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        UUID executionId = UUID.randomUUID();
        jdbc.update("insert into workflow.workflows "
                        + "(id, workspace_id, name, status, schema_version, draft_definition, created_by) "
                        + "values (?, ?, 'Cancel fixture', 'PUBLISHED', '1.0', cast(? as jsonb), ?)",
                workflowId, workspaceId, DEFINITION, actorId);
        jdbc.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                versionId, workflowId, DEFINITION, actorId);
        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", versionId, workflowId);
        boolean finished = "SUCCESS".equals(status);
        jdbc.update("insert into workflow.workflow_executions "
                        + "(id, workflow_id, workflow_version_id, status, trigger_type, triggered_by, root_node_id, "
                        + "input, edge_states, started_at, finished_at, created_at) "
                        + "values (?, ?, ?, ?, 'MANUAL', ?, 'root', cast('{}' as jsonb), "
                        + "cast('{\"root-call\":\"UNKNOWN\"}' as jsonb), null, "
                        + (finished ? "CURRENT_TIMESTAMP" : "null") + ", CURRENT_TIMESTAMP)",
                executionId, workflowId, versionId, status, actorId);
        String nodeStatus = finished ? "SUCCESS" : "PENDING";
        jdbc.update("insert into workflow.node_executions (id, execution_id, node_id, node_type, status, "
                + "attempt_count) values (?, ?, 'root', 'trigger.manual', ?, 0)",
                UUID.randomUUID(), executionId, nodeStatus);
        jdbc.update("insert into workflow.node_executions (id, execution_id, node_id, node_type, status, "
                + "attempt_count) values (?, ?, 'call', 'http.request', ?, 0)",
                UUID.randomUUID(), executionId, nodeStatus);
        return new Fixture(workspaceId, workflowId, executionId);
    }

    private record Fixture(UUID workspaceId, UUID workflowId, UUID executionId) {
    }
}
