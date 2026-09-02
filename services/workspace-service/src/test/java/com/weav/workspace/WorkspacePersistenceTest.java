package com.weav.workspace;

import tools.jackson.databind.ObjectMapper;
import com.weav.workspace.infrastructure.persistence.entity.ConnectionJpaEntity;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import com.weav.workspace.infrastructure.persistence.entity.CredentialJpaEntity;
import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import com.weav.workspace.domain.valueobject.MembershipRole;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;
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
        WorkspaceJpaEntity workspace = new WorkspaceJpaEntity("Persistence Test", ownerId);
        entityManager.persist(workspace);

        MembershipJpaEntity membership = new MembershipJpaEntity(workspace.getId(), ownerId, MembershipRole.OWNER);
        entityManager.persist(membership);

        ConnectionJpaEntity connection = new ConnectionJpaEntity(
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
        CredentialJpaEntity credential = new CredentialJpaEntity(
                connection.getId(),
                encryptedPayload,
                "v1",
                Instant.now().plusSeconds(3600)
        );
        entityManager.persist(credential);

        entityManager.flush();
        entityManager.clear();

        WorkspaceJpaEntity persistedWorkspace = entityManager.find(WorkspaceJpaEntity.class, workspace.getId());
        MembershipJpaEntity persistedMembership = entityManager.find(MembershipJpaEntity.class, membership.getId());
        ConnectionJpaEntity persistedConnection = entityManager.find(ConnectionJpaEntity.class, connection.getId());
        CredentialJpaEntity persistedCredential = entityManager.find(CredentialJpaEntity.class, credential.getId());

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
