package com.weav.identity;

import com.weav.identity.infrastructure.persistence.entity.SystemRole;
import com.weav.identity.infrastructure.persistence.entity.User;
import com.weav.identity.infrastructure.persistence.entity.UserStatus;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class IdentityServiceApplicationTests {

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void contextLoads() {
    }

    @Test
    void flywayMigrationCreatesIdentitySchema() {
        Integer appliedMigrations = jdbcTemplate.queryForObject(
                "select count(*) from identity.flyway_schema_history where version = '1' and success = true",
                Integer.class
        );

        assertEquals(1, appliedMigrations);
        assertTrue(Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "select exists (select 1 from information_schema.tables where table_schema = 'identity' and table_name = 'users')",
                Boolean.class
        )));
    }

    @Test
    @Transactional
    void jpaPersistsAndReadsUserWithInstantTimestamps() {
        User user = new User(
                "jpa-test@example.com",
                null,
                "JPA Test User",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE
        );

        entityManager.persist(user);
        entityManager.flush();
        entityManager.clear();

        User persisted = entityManager.find(User.class, user.getId());

        assertNotNull(persisted);
        assertEquals("jpa-test@example.com", persisted.getEmail());
        assertEquals(SystemRole.USER, persisted.getSystemRole());
        assertEquals(UserStatus.ACTIVE, persisted.getStatus());
        assertNotNull(persisted.getCreatedAt());
        assertNotNull(persisted.getUpdatedAt());
    }
}