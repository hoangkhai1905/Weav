package com.weav.identity.infrastructure.persistence;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

@Testcontainers
class UserMigrationV3IntegrationTest {

    @Container
    private static final PostgreSQLContainer POSTGRES = new PostgreSQLContainer(
            DockerImageName.parse("postgres:18-alpine"));

    @Test
    void v1AndV2UsersRemainReadableWithNullableEmailVerificationAfterV3() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());

        Flyway.configure()
                .dataSource(dataSource)
                .schemas("identity")
                .defaultSchema("identity")
                .createSchemas(true)
                .locations("classpath:db/migration")
                .target("2")
                .load()
                .migrate();

        UUID id = UUID.randomUUID();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("""
                insert into identity.users
                    (id, email, password_hash, display_name, avatar_storage_key, system_role, status, created_at, updated_at)
                values (?, ?, ?, ?, ?, ?, ?, now(), now())
                """, id, "legacy@example.com", "legacy-hash", "Legacy", null, "USER", "ACTIVE");

        Flyway.configure()
                .dataSource(dataSource)
                .schemas("identity")
                .defaultSchema("identity")
                .createSchemas(true)
                .locations("classpath:db/migration")
                .load()
                .migrate();

        var row = jdbc.queryForMap("select email, password_hash, display_name, email_verified_at from identity.users where id = ?", id);
        assertEquals("legacy@example.com", row.get("email"));
        assertEquals("legacy-hash", row.get("password_hash"));
        assertEquals("Legacy", row.get("display_name"));
        assertNull(row.get("email_verified_at"));
    }
}
