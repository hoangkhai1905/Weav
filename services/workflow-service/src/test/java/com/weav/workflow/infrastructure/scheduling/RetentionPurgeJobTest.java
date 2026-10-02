package com.weav.workflow.infrastructure.scheduling;

import com.weav.workflow.WorkflowPublicationTestConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** WF-12: outbox and execution-history retention against real PostgreSQL. */
@SpringBootTest(properties = {
        "weav.workflow.execution-outbox.initial-delay=3600000",
        "weav.workflow.execution-outbox.poll-interval=3600000"
})
@Import(WorkflowPublicationTestConfiguration.class)
class RetentionPurgeJobTest {
    private static final String DEFINITION = "{\"schemaVersion\":\"1.0\",\"nodes\":[],\"edges\":[],\"variables\":{}}";

    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private PlatformTransactionManager transactions;

    @Test
    void purgesOnlyOldPublishedOutboxRows() {
        UUID aggregate = UUID.randomUUID();
        UUID oldPublished = outbox(aggregate, "PUBLISHED", 10);
        UUID recentPublished = outbox(aggregate, "PUBLISHED", 1);
        UUID oldPending = outbox(aggregate, "PENDING", 10);

        new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 0).purgeNow();

        assertEquals(0, count("outbox_events", oldPublished));
        assertEquals(1, count("outbox_events", recentPublished));
        assertEquals(1, count("outbox_events", oldPending));
    }

    @Test
    void executionHistoryIsKeptWhenRetentionIsZeroAndPurgedWithChildrenWhenEnabled() {
        UUID workflow = UUID.randomUUID();
        UUID version = UUID.randomUUID();
        UUID actor = UUID.randomUUID();
        jdbc.update("insert into workflow.workflows (id, workspace_id, name, status, schema_version, "
                + "draft_definition, created_by) values (?, ?, 'Retention', 'PUBLISHED', '1.0', "
                + "cast(? as jsonb), ?)", workflow, UUID.randomUUID(), DEFINITION, actor);
        jdbc.update("insert into workflow.workflow_versions (id, workflow_id, version_number, definition, "
                + "schema_version, published_by) values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                version, workflow, DEFINITION, actor);
        UUID oldDone = execution(workflow, version, "SUCCESS", 40);
        UUID oldBlocked = execution(workflow, version, "FAILED", 40);
        outbox(oldBlocked, "PENDING", 40);
        UUID recent = execution(workflow, version, "SUCCESS", 1);
        UUID running = execution(workflow, version, "RUNNING", -1);

        new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 0).purgeNow();
        assertEquals(1, count("workflow_executions", oldDone));

        new RetentionPurgeJob(jdbc, transactions, "workflow", 7, 14, 30).purgeNow();
        assertEquals(0, count("workflow_executions", oldDone));
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where execution_id = ?", Integer.class, oldDone));
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from workflow.execution_logs where execution_id = ?", Integer.class, oldDone));
        assertEquals(1, count("workflow_executions", oldBlocked));
        assertEquals(1, count("workflow_executions", recent));
        assertEquals(1, count("workflow_executions", running));
    }

    private UUID outbox(UUID aggregate, String status, int ageDays) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into workflow.outbox_events (id, aggregate_type, aggregate_id, event_type, payload, "
                + "status, created_at, published_at) values (?, 'WORKFLOW_EXECUTION', ?, 'EXECUTION_REQUESTED', "
                + "'{}'::jsonb, ?, CURRENT_TIMESTAMP - (? * INTERVAL '1 day'), "
                + "case when ? = 'PUBLISHED' then CURRENT_TIMESTAMP - (? * INTERVAL '1 day') end)",
                id, aggregate, status, ageDays, status, ageDays);
        return id;
    }

    private UUID execution(UUID workflow, UUID version, String status, int finishedDaysAgo) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into workflow.workflow_executions (id, workflow_id, workflow_version_id, status, "
                + "trigger_type, finished_at) values (?, ?, ?, ?, 'MANUAL', "
                + "case when ? >= 0 then CURRENT_TIMESTAMP - (? * INTERVAL '1 day') end)",
                id, workflow, version, status, finishedDaysAgo, finishedDaysAgo);
        UUID node = UUID.randomUUID();
        jdbc.update("insert into workflow.node_executions (id, execution_id, node_id, node_type, status) "
                + "values (?, ?, 'root', 'trigger.manual', 'SUCCESS')", node, id);
        jdbc.update("insert into workflow.execution_logs (id, execution_id, node_execution_id, level, event_type) "
                + "values (?, ?, ?, 'INFO', 'TEST')", UUID.randomUUID(), id, node);
        return id;
    }

    private int count(String table, UUID id) {
        return jdbc.queryForObject("select count(*) from workflow." + table + " where id = ?",
                Integer.class, id);
    }
}
