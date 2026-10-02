package com.weav.workflow.infrastructure.persistence;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
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
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Testcontainers(disabledWithoutDocker = true)
class WebhookEndpointMigrationTest {
    private static final UUID WORKSPACE_ID = UUID.fromString("11000000-0000-0000-0000-000000000091");
    private static final UUID WORKFLOW_ID = UUID.fromString("44000000-0000-0000-0000-000000000091");
    private static final UUID VERSION_ID = UUID.fromString("55000000-0000-0000-0000-000000000091");
    private static final UUID ACTOR_ID = UUID.fromString("22000000-0000-0000-0000-000000000091");
    private static final String DUPLICATE_KEY = "migration-fixture-endpoint-key";

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("postgres:18.6"));

    @Test
    void v4ReportsDuplicateEndpointKeysAndLeavesExistingRegistrationsUntouched() {
        DataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        migrate(dataSource, MigrationVersion.fromVersion("3"));
        insertDuplicateEndpoints(jdbc);

        FlywayException migrationFailure = assertThrows(FlywayException.class, () -> migrate(dataSource, null));

        assertTrue(causeMessages(migrationFailure).contains("1 duplicate endpoint identifiers"));
        assertEquals(2, jdbc.queryForObject(
                "select count(*) from workflow.workflow_triggers where endpoint_key = ?",
                Integer.class, DUPLICATE_KEY));
        assertEquals(0, jdbc.queryForObject(
                "select count(*) from pg_indexes where schemaname = 'workflow' "
                        + "and indexname = 'uq_workflow_triggers_endpoint_key'", Integer.class));
    }

    private void migrate(DataSource dataSource, MigrationVersion target) {
        var configuration = Flyway.configure()
                .dataSource(dataSource)
                .schemas("workflow")
                .defaultSchema("workflow")
                .createSchemas(true)
                .locations("classpath:db/migration");
        if (target != null) {
            configuration.target(target);
        }
        configuration.load().migrate();
    }

    private void insertDuplicateEndpoints(JdbcTemplate jdbc) {
        String definition = "{\"schemaVersion\":\"1.0\",\"nodes\":[],\"edges\":[],\"variables\":{}}";
        jdbc.update("insert into workflow.workflows "
                        + "(id, workspace_id, name, status, schema_version, draft_definition, created_by) "
                        + "values (?, ?, 'Webhook migration fixture', 'PUBLISHED', '1.0', cast(? as jsonb), ?)",
                WORKFLOW_ID, WORKSPACE_ID, definition, ACTOR_ID);
        jdbc.update("insert into workflow.workflow_versions "
                        + "(id, workflow_id, version_number, definition, schema_version, published_by) "
                        + "values (?, ?, 1, cast(? as jsonb), '1.0', ?)",
                VERSION_ID, WORKFLOW_ID, definition, ACTOR_ID);
        jdbc.update("update workflow.workflows set current_version_id = ? where id = ?", VERSION_ID, WORKFLOW_ID);
        jdbc.update("insert into workflow.workflow_triggers "
                        + "(id, workflow_id, workflow_version_id, trigger_node_id, type, status, endpoint_key, secret_hash) "
                        + "values (?, ?, ?, 'webhook-a', 'WEBHOOK', 'ACTIVE', ?, ?), "
                        + "(?, ?, ?, 'webhook-b', 'WEBHOOK', 'DISABLED', ?, ?)",
                UUID.randomUUID(), WORKFLOW_ID, VERSION_ID, DUPLICATE_KEY, "a".repeat(64),
                UUID.randomUUID(), WORKFLOW_ID, VERSION_ID, DUPLICATE_KEY, "b".repeat(64));
    }

    private String causeMessages(Throwable error) {
        StringBuilder messages = new StringBuilder();
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            messages.append(cause.getMessage()).append('\n');
        }
        return messages.toString();
    }
}
