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
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
class ConnectionReferenceMigrationTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("11000000-0000-0000-0000-000000000071");
    private static final UUID LIVE_WORKFLOW_ID = UUID.fromString("44000000-0000-0000-0000-000000000071");
    private static final UUID DELETED_WORKFLOW_ID = UUID.fromString("44000000-0000-0000-0000-000000000072");
    private static final UUID MALFORMED_WORKFLOW_ID = UUID.fromString("44000000-0000-0000-0000-000000000073");
    private static final UUID LIVE_DRAFT_CONNECTION_ID = UUID.fromString("33000000-0000-0000-0000-000000000071");
    private static final UUID DELETED_DRAFT_CONNECTION_ID = UUID.fromString("33000000-0000-0000-0000-000000000072");
    private static final UUID DELETED_VERSION_CONNECTION_ID = UUID.fromString("33000000-0000-0000-0000-000000000073");
    private static final UUID LIVE_VERSION_ID = UUID.fromString("55000000-0000-0000-0000-000000000071");
    private static final UUID DELETED_VERSION_ID = UUID.fromString("55000000-0000-0000-0000-000000000072");
    private static final UUID MALFORMED_VERSION_ID = UUID.fromString("55000000-0000-0000-0000-000000000073");
    private static final UUID ACTOR_ID = UUID.fromString("22000000-0000-0000-0000-000000000071");

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("postgres:18.6"));

    @Test
    void upgradesPopulatedV1AndBackfillsOnlyExactValidConnectionFields() {
        DataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);

        Flyway.configure()
                .dataSource(dataSource)
                .schemas("workflow")
                .defaultSchema("workflow")
                .createSchemas(true)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion("1"))
                .load()
                .migrate();

        insertWorkflow(jdbc, LIVE_WORKFLOW_ID, false,
                definition("[{\"id\":\"sheets\",\"config\":{\"connectionId\":\""
                        + LIVE_DRAFT_CONNECTION_ID + "\"}},{\"id\":\"sheets-copy\",\"config\":{\"connectionId\":\""
                        + LIVE_DRAFT_CONNECTION_ID + "\"}}]"));
        insertWorkflow(jdbc, DELETED_WORKFLOW_ID, true,
                definition("[{\"id\":\"sheets\",\"config\":{\"connectionId\":\""
                        + DELETED_DRAFT_CONNECTION_ID + "\"}}]"));
        insertWorkflow(jdbc, MALFORMED_WORKFLOW_ID, false,
                "{\"nodes\":[null,17,{\"config\":null},{\"config\":[]},"
                        + "{\"config\":{\"connectionId\":\"not-a-uuid\"}},"
                        + "{\"description\":\"" + DELETED_DRAFT_CONNECTION_ID + "\"}],"
                        + "\"variables\":{\"connectionId\":\"" + DELETED_DRAFT_CONNECTION_ID + "\"}}");

        insertVersion(jdbc, LIVE_VERSION_ID, LIVE_WORKFLOW_ID,
                definition("[{\"config\":{\"connectionId\":\"not-a-uuid\"}}]"));
        insertVersion(jdbc, DELETED_VERSION_ID, DELETED_WORKFLOW_ID,
                definition("[{\"id\":\"sheets\",\"config\":{\"connectionId\":\""
                        + DELETED_VERSION_CONNECTION_ID + "\"}}]"));
        insertVersion(jdbc, MALFORMED_VERSION_ID, MALFORMED_WORKFLOW_ID,
                "{\"nodes\":\"not-an-array\",\"variables\":{\"connectionId\":\""
                        + DELETED_VERSION_CONNECTION_ID + "\"}}");

        Flyway.configure()
                .dataSource(dataSource)
                .schemas("workflow")
                .defaultSchema("workflow")
                .createSchemas(true)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        Set<String> references = jdbc.query(
                        "select workflow_id, version_id, connection_id "
                                + "from workflow.workflow_connection_references",
                        (resultSet, rowNumber) -> resultSet.getString(1) + ":"
                                + resultSet.getString(2) + ":" + resultSet.getString(3))
                .stream()
                .collect(Collectors.toSet());
        assertEquals(Set.of(
                LIVE_WORKFLOW_ID + ":null:" + LIVE_DRAFT_CONNECTION_ID,
                DELETED_WORKFLOW_ID + ":" + DELETED_VERSION_ID + ":" + DELETED_VERSION_CONNECTION_ID),
                references);

        List<String> indexes = jdbc.queryForList(
                "select indexname from pg_indexes "
                        + "where schemaname = 'workflow' and tablename = 'workflow_connection_references'",
                String.class);
        assertTrue(indexes.contains("uq_workflow_connection_references_draft"));
        assertTrue(indexes.contains("uq_workflow_connection_references_version"));
        assertTrue(indexes.contains("idx_workflow_connection_references_connection"));

        List<String> foreignKeys = jdbc.queryForList(
                "select conname from pg_constraint "
                        + "where conrelid = 'workflow.workflow_connection_references'::regclass and contype = 'f'",
                String.class);
        assertEquals(Set.of(
                "fk_workflow_connection_references_workflow",
                "fk_workflow_connection_references_version"), Set.copyOf(foreignKeys));
    }

    private void insertWorkflow(JdbcTemplate jdbc, UUID workflowId, boolean deleted, String definition) {
        jdbc.update("insert into workflow.workflows "
                        + "(id, workspace_id, name, status, schema_version, draft_definition, created_by, deleted_at) "
                        + "values (?, ?, ?, 'DRAFT', '1.0', cast(? as jsonb), ?, ?) ",
                workflowId, WORKSPACE_ID, "Workflow " + workflowId, definition, ACTOR_ID,
                deleted ? java.sql.Timestamp.from(Instant.parse("2026-09-20T00:00:00Z")) : null);
    }

    private void insertVersion(JdbcTemplate jdbc, UUID versionId, UUID workflowId, String definition) {
        jdbc.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                versionId, workflowId, definition, ACTOR_ID);
    }

    private String definition(String nodes) {
        return "{\"schemaVersion\":\"1.0\",\"nodes\":" + nodes
                + ",\"edges\":[],\"variables\":{}}";
    }
}
