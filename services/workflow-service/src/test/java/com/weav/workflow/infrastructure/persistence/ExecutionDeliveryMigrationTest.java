package com.weav.workflow.infrastructure.persistence;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import javax.sql.DataSource;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

@Testcontainers(disabledWithoutDocker = true)
class ExecutionDeliveryMigrationTest {
    private static final UUID WORKSPACE_ID = UUID.fromString("11000000-0000-0000-0000-000000000081");
    private static final UUID WORKFLOW_ID = UUID.fromString("44000000-0000-0000-0000-000000000081");
    private static final UUID VERSION_ID = UUID.fromString("55000000-0000-0000-0000-000000000081");
    private static final UUID TRIGGER_ID = UUID.fromString("66000000-0000-0000-0000-000000000081");
    private static final UUID EXECUTION_ID = UUID.fromString("77000000-0000-0000-0000-000000000081");
    private static final UUID NODE_EXECUTION_ID = UUID.fromString("88000000-0000-0000-0000-000000000081");
    private static final UUID OUTBOX_ID = UUID.fromString("99000000-0000-0000-0000-000000000081");
    private static final UUID CONNECTION_ID = UUID.fromString("33000000-0000-0000-0000-000000000081");
    private static final UUID ACTOR_ID = UUID.fromString("22000000-0000-0000-0000-000000000081");

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("postgres:18.6"));

    @Test
    void v3AddsDeliveryStateWithoutRecreatingTriggerIdOrDroppingPopulatedV2Rows() {
        DataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        Flyway.configure()
                .dataSource(dataSource)
                .schemas("workflow")
                .defaultSchema("workflow")
                .createSchemas(true)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("2"))
                .load()
                .migrate();

        insertV2Rows(jdbc);
        assertEquals(1, columnCount(jdbc, "workflow_executions", "trigger_id"));

        Flyway.configure()
                .dataSource(dataSource)
                .schemas("workflow")
                .defaultSchema("workflow")
                .createSchemas(true)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        assertEquals(1, columnCount(jdbc, "workflow_executions", "trigger_id"));
        assertEquals(TRIGGER_ID, jdbc.queryForObject(
                "select trigger_id from workflow.workflow_executions where id = ?", UUID.class, EXECUTION_ID));
        assertEquals("{\"source\": \"existing-v2-execution\"}", jdbc.queryForObject(
                "select input::text from workflow.workflow_executions where id = ?", String.class, EXECUTION_ID));
        assertEquals("{}", jdbc.queryForObject(
                "select edge_states::text from workflow.workflow_executions where id = ?",
                String.class, EXECUTION_ID));
        assertEquals(0L, jdbc.queryForObject(
                "select lease_token from workflow.workflow_executions where id = ?",
                Long.class, EXECUTION_ID));
        assertNull(jdbc.queryForObject(
                "select root_node_id from workflow.workflow_executions where id = ?",
                String.class, EXECUTION_ID));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.node_executions where id = ? and next_attempt_at is null",
                Integer.class, NODE_EXECUTION_ID));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.outbox_events where id = ? and status = 'PENDING' "
                        + "and next_attempt_at is not null and retry_count = 0",
                Integer.class, OUTBOX_ID));
        assertEquals(1, jdbc.queryForObject(
                "select count(*) from workflow.workflow_connection_references where workflow_id = ? "
                        + "and version_id = ? and connection_id = ?",
                Integer.class, WORKFLOW_ID, VERSION_ID, CONNECTION_ID));
    }

    private void insertV2Rows(JdbcTemplate jdbc) {
        String definition = "{\"schemaVersion\":\"1.0\",\"nodes\":["
                + "{\"id\":\"schedule-root\",\"type\":\"trigger.schedule\",\"config\":{}}],"
                + "\"edges\":[],\"variables\":{}}";
        jdbc.update("insert into workflow.workflows "
                        + "(id, workspace_id, name, status, schema_version, draft_definition, created_by) "
                        + "values (?, ?, 'Migration fixture', 'PUBLISHED', '1.0', cast(? as jsonb), ?)",
                WORKFLOW_ID, WORKSPACE_ID, definition, ACTOR_ID);
        jdbc.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                VERSION_ID, WORKFLOW_ID, definition, ACTOR_ID);
        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", VERSION_ID, WORKFLOW_ID);
        jdbc.update("insert into workflow.workflow_triggers "
                        + "(id, workflow_id, workflow_version_id, trigger_node_id, type, status) "
                        + "values (?, ?, ?, 'schedule-root', 'SCHEDULE', 'ACTIVE')",
                TRIGGER_ID, WORKFLOW_ID, VERSION_ID);
        jdbc.update("insert into workflow.workflow_executions "
                        + "(id, workflow_id, workflow_version_id, status, trigger_type, trigger_id, triggered_by, input) "
                        + "values (?, ?, ?, 'QUEUED', 'SCHEDULE', ?, ?, cast(? as jsonb))",
                EXECUTION_ID, WORKFLOW_ID, VERSION_ID, TRIGGER_ID, ACTOR_ID,
                "{\"source\":\"existing-v2-execution\"}");
        jdbc.update("insert into workflow.node_executions "
                        + "(id, execution_id, node_id, node_type, status) "
                        + "values (?, ?, 'schedule-root', 'trigger.schedule', 'PENDING')",
                NODE_EXECUTION_ID, EXECUTION_ID);
        jdbc.update("insert into workflow.outbox_events "
                        + "(id, aggregate_type, aggregate_id, event_type, payload, status) "
                        + "values (?, 'WORKFLOW_EXECUTION', ?, 'EXECUTION_REQUESTED', cast(? as jsonb), 'PENDING')",
                OUTBOX_ID, EXECUTION_ID, "{\"executionId\":\"" + EXECUTION_ID + "\"}");
        jdbc.update("insert into workflow.workflow_connection_references (workflow_id, version_id, connection_id) "
                        + "values (?, ?, ?)", WORKFLOW_ID, VERSION_ID, CONNECTION_ID);
    }

    private int columnCount(JdbcTemplate jdbc, String table, String column) {
        return jdbc.queryForObject("select count(*) from information_schema.columns "
                        + "where table_schema = 'workflow' and table_name = ? and column_name = ?",
                Integer.class, table, column);
    }
}
