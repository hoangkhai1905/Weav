package com.weav.workspace.infrastructure.persistence;

import com.weav.workspace.domain.model.Connection;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.flywaydb.core.api.configuration.FluentConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers
class ConnectionMigrationTest {

    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(DockerImageName.parse("postgres:latest"));

    @Test
    void v3BackfillsExistingNamesWithJavaNormalizationAndRejectsCanonicalCollision() {
        Flyway targetV2 = configuredFlyway()
                .target(MigrationVersion.fromVersion("2"))
                .load();
        targetV2.migrate();
        JdbcTemplate jdbcTemplate = jdbcTemplate();

        UUID workspaceId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        insertWorkspace(jdbcTemplate, workspaceId, creatorId);

        Map<UUID, String> seededNames = new LinkedHashMap<>();
        seededNames.put(UUID.randomUUID(), "\tLegacy\n");
        seededNames.put(UUID.randomUUID(), "\t \nMixed\u000bASCII\f Connection\r\n");
        seededNames.put(UUID.randomUUID(), "\u001fControl\tName\u001e");
        seededNames.put(UUID.randomUUID(), "  Ordinary Name  ");
        seededNames.forEach((connectionId, name) ->
                insertLegacyConnection(jdbcTemplate, connectionId, workspaceId, creatorId, name));

        configuredFlyway().load().migrate();

        seededNames.forEach((connectionId, name) -> assertThat(jdbcTemplate.queryForObject(
                "select name_normalized from workspace.connections where id = ?",
                String.class,
                connectionId)).isEqualTo(Connection.normalizeName(name)));
        assertThat(jdbcTemplate.queryForObject(
                "select count(*) from workspace.flyway_schema_history "
                        + "where version = '3' and success = true",
                Integer.class)).isEqualTo(1);

        assertThatThrownBy(() -> insertCanonicalConnection(
                jdbcTemplate,
                UUID.randomUUID(),
                workspaceId,
                creatorId,
                "legacy"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uk_connections_workspace_name_normalized");
    }

    private FluentConfiguration configuredFlyway() {
        return Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas("workspace")
                .defaultSchema("workspace")
                .createSchemas(true)
                .locations("classpath:db/migration");
    }

    private JdbcTemplate jdbcTemplate() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(),
                POSTGRES.getPassword());
        return new JdbcTemplate(dataSource);
    }

    private void insertWorkspace(JdbcTemplate jdbcTemplate, UUID workspaceId, UUID creatorId) {
        jdbcTemplate.update(
                "insert into workspace.workspaces "
                        + "(id, name, name_normalized, created_by, created_at, updated_at) "
                        + "values (?, ?, lower(btrim(?)), ?, now(), now())",
                workspaceId,
                "Migration Workspace",
                "Migration Workspace",
                creatorId);
    }

    private void insertLegacyConnection(
            JdbcTemplate jdbcTemplate,
            UUID connectionId,
            UUID workspaceId,
            UUID creatorId,
            String name) {
        jdbcTemplate.update(
                "insert into workspace.connections "
                        + "(id, workspace_id, created_by, name, provider, auth_type, status, config, created_at, updated_at) "
                        + "values (?, ?, ?, ?, 'HTTP', 'API_KEY', 'DISABLED', '{}'::jsonb, now(), now())",
                connectionId,
                workspaceId,
                creatorId,
                name);
    }

    private void insertCanonicalConnection(
            JdbcTemplate jdbcTemplate,
            UUID connectionId,
            UUID workspaceId,
            UUID creatorId,
            String name) {
        jdbcTemplate.update(
                "insert into workspace.connections "
                        + "(id, workspace_id, created_by, name, name_normalized, provider, auth_type, status, config, created_at, updated_at) "
                        + "values (?, ?, ?, ?, ?, 'HTTP', 'API_KEY', 'DISABLED', '{}'::jsonb, now(), now())",
                connectionId,
                workspaceId,
                creatorId,
                name,
                Connection.normalizeName(name));
    }
}
