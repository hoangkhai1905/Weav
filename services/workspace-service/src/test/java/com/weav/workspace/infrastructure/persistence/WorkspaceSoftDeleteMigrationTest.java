package com.weav.workspace.infrastructure.persistence;

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

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** W6-D2: V7 is additive for existing rows and only ACTIVE workspaces compete for an owner's name. */
@Testcontainers
class WorkspaceSoftDeleteMigrationTest {

    @Container
    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(DockerImageName.parse("postgres:latest"));

    @Test
    void v7KeepsExistingWorkspacesActiveAndFreesTheNameOfDeletedOnes() {
        configuredFlyway().target(MigrationVersion.fromVersion("6")).load().migrate();
        JdbcTemplate jdbc = jdbcTemplate();
        UUID owner = UUID.randomUUID();
        UUID legacy = UUID.randomUUID();
        insertWorkspace(jdbc, legacy, owner, "Legacy");

        configuredFlyway().load().migrate();

        assertThat(jdbc.queryForObject(
                "select status from workspace.workspaces where id = ?", String.class, legacy)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject(
                "select deleted_at is null and deleted_by is null from workspace.workspaces where id = ?",
                Boolean.class, legacy)).isTrue();
        assertThatThrownBy(() -> insertWorkspace(jdbc, UUID.randomUUID(), owner, "Legacy"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ux_workspaces_owner_name_normalized");
        assertThatThrownBy(() -> jdbc.update(
                "update workspace.workspaces set status = 'GONE' where id = ?", legacy))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_workspaces_status");

        jdbc.update("update workspace.workspaces set status = 'DELETED', deleted_at = now(), deleted_by = ? "
                + "where id = ?", owner, legacy);
        insertWorkspace(jdbc, UUID.randomUUID(), owner, "Legacy");

        assertThat(jdbc.queryForObject(
                "select count(*) from workspace.workspaces where created_by = ? and name_normalized = 'legacy'",
                Integer.class, owner)).isEqualTo(2);
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
        return new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()));
    }

    private void insertWorkspace(JdbcTemplate jdbc, UUID id, UUID owner, String name) {
        jdbc.update("insert into workspace.workspaces (id, name, name_normalized, created_by, created_at, updated_at) "
                + "values (?, ?, lower(btrim(?)), ?, now(), now())", id, name, name, owner);
    }
}
