package com.weav.workspace;

import tools.jackson.databind.ObjectMapper;
import com.weav.workspace.infrastructure.persistence.entity.Connection;
import com.weav.workspace.infrastructure.persistence.entity.ConnectionAuthType;
import com.weav.workspace.infrastructure.persistence.entity.ConnectionProvider;
import com.weav.workspace.infrastructure.persistence.entity.ConnectionStatus;
import com.weav.workspace.infrastructure.persistence.entity.Credential;
import com.weav.workspace.infrastructure.persistence.entity.Membership;
import com.weav.workspace.infrastructure.persistence.entity.MembershipRole;
import com.weav.workspace.infrastructure.persistence.entity.Workspace;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkspacePersistenceTest {

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void flywayMigrationCreatesWorkspaceSchema() {
        Integer appliedMigrations = jdbcTemplate.queryForObject(
                "select count(*) from workspace.flyway_schema_history where version = '1' and success = true",
                Integer.class
        );

        assertEquals(1, appliedMigrations);
        assertTrue(Boolean.TRUE.equals(jdbcTemplate.queryForObject(
                "select exists (select 1 from information_schema.tables where table_schema = 'workspace' and table_name = 'credentials')",
                Boolean.class
        )));
    }

    @Test
    @Transactional
    void jpaPersistsAndReadsWorkspaceEntitiesWithInstantTimestamps() throws Exception {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = new Workspace("Persistence Test", ownerId);
        entityManager.persist(workspace);

        Membership membership = new Membership(workspace.getId(), ownerId, MembershipRole.OWNER);
        entityManager.persist(membership);

        Connection connection = new Connection(
                workspace.getId(),
                ownerId,
                "HTTP API",
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                ConnectionStatus.ACTIVE,
                objectMapper.readTree("{\"baseUrl\":\"https://example.test\"}")
        );
        entityManager.persist(connection);

        byte[] encryptedPayload = new byte[] {1, 2, 3, 4};
        Credential credential = new Credential(
                connection.getId(),
                encryptedPayload,
                "v1",
                Instant.now().plusSeconds(3600)
        );
        entityManager.persist(credential);

        entityManager.flush();
        entityManager.clear();

        Workspace persistedWorkspace = entityManager.find(Workspace.class, workspace.getId());
        Membership persistedMembership = entityManager.find(Membership.class, membership.getId());
        Connection persistedConnection = entityManager.find(Connection.class, connection.getId());
        Credential persistedCredential = entityManager.find(Credential.class, credential.getId());

        assertNotNull(persistedWorkspace);
        assertEquals("Persistence Test", persistedWorkspace.getName());
        assertEquals(ownerId, persistedWorkspace.getCreatedBy());
        assertNotNull(persistedWorkspace.getCreatedAt());
        assertNotNull(persistedWorkspace.getUpdatedAt());

        assertNotNull(persistedMembership);
        assertEquals(MembershipRole.OWNER, persistedMembership.getRole());
        assertEquals(ownerId, persistedMembership.getUserId());

        assertNotNull(persistedConnection);
        assertEquals(ConnectionProvider.HTTP, persistedConnection.getProvider());
        assertEquals(ConnectionAuthType.API_KEY, persistedConnection.getAuthType());
        assertEquals("https://example.test", persistedConnection.getConfig().get("baseUrl").asString());

        assertNotNull(persistedCredential);
        assertArrayEquals(encryptedPayload, persistedCredential.getEncryptedPayload());
        assertEquals("v1", persistedCredential.getEncryptionKeyVersion());
        assertNotNull(persistedCredential.getCreatedAt());
        assertNotNull(persistedCredential.getUpdatedAt());
    }
}