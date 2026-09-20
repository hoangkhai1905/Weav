package com.weav.workspace;

import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.exception.ConnectionNameAlreadyExistsException;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ConnectionPersistenceTest {

    private static final UUID CREATOR_ID = UUID.randomUUID();

    @Autowired
    private ConnectionRepository connectionRepository;

    @Autowired
    private CredentialRepository credentialRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EntityManager entityManager;

    @Test
    @Transactional
    void sameNormalizedNameInSameWorkspaceConflicts() {
        UUID workspaceId = insertWorkspace("Connection Conflict");
        connectionRepository.save(newConnection(workspaceId, "HTTP API"));

        assertThatThrownBy(() -> connectionRepository.save(
                newConnection(workspaceId, "  http\tapi ")))
                .isInstanceOf(ConnectionNameAlreadyExistsException.class);
    }

    @Test
    @Transactional
    void sameNormalizedNameInDifferentWorkspacesIsAllowed() {
        UUID firstWorkspaceId = insertWorkspace("First Connection Workspace");
        UUID secondWorkspaceId = insertWorkspace("Second Connection Workspace");

        Connection first = connectionRepository.save(newConnection(firstWorkspaceId, "HTTP API"));
        Connection second = connectionRepository.save(newConnection(secondWorkspaceId, "  http\tapi "));
        entityManager.clear();

        assertThat(first.getId()).isNotEqualTo(second.getId());
        assertThat(connectionRepository.findAllByWorkspaceId(firstWorkspaceId))
                .extracting(Connection::getName)
                .containsExactly("HTTP API");
        assertThat(connectionRepository.findAllByWorkspaceId(secondWorkspaceId))
                .extracting(Connection::getName)
                .containsExactly("http api");
    }

    @Test
    @Transactional
    void credentialConnectionIdIsUnique() {
        UUID workspaceId = insertWorkspace("Credential Uniqueness");
        Connection connection = connectionRepository.save(newConnection(workspaceId, "Credential"));
        credentialRepository.save(Credential.createNew(connection.getId(), new byte[] {1, 2, 3}, "v1", null));

        assertThatThrownBy(() -> credentialRepository.save(
                Credential.createNew(connection.getId(), new byte[] {4, 5, 6}, "v1", null)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    @Transactional
    void credentialMappingPreservesFieldsAndTimestamps() {
        UUID workspaceId = insertWorkspace("Credential Mapping");
        Connection connection = connectionRepository.save(newConnection(workspaceId, "Credential Mapping"));
        UUID credentialId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-02-01T00:00:00Z");
        Instant updatedAt = Instant.parse("2026-02-02T00:00:00Z");
        Instant expiresAt = Instant.parse("2026-03-01T00:00:00Z");
        Credential source = new Credential(
                credentialId,
                connection.getId(),
                new byte[] {10, 20, 30},
                "key-v2",
                expiresAt,
                createdAt,
                updatedAt);

        credentialRepository.save(source);
        entityManager.clear();
        Credential restored = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();

        assertThat(restored.getId()).isEqualTo(credentialId);
        assertThat(restored.getConnectionId()).isEqualTo(connection.getId());
        assertThat(restored.getEncryptedPayload()).containsExactly(10, 20, 30);
        assertThat(restored.getEncryptionKeyVersion()).isEqualTo("key-v2");
        assertThat(restored.getExpiresAt()).isEqualTo(expiresAt);
        assertThat(restored.getCreatedAt()).isEqualTo(createdAt);
        assertThat(restored.getUpdatedAt()).isEqualTo(updatedAt);
    }

    @Test
    @Transactional
    void deletingConnectionCascadesToCredential() {
        UUID workspaceId = insertWorkspace("Credential Cascade");
        Connection connection = connectionRepository.save(newConnection(workspaceId, "Cascade"));
        credentialRepository.save(Credential.createNew(connection.getId(), new byte[] {7, 8, 9}, "v1", null));

        connectionRepository.delete(connection);
        entityManager.clear();

        assertThat(connectionRepository.findById(connection.getId())).isEmpty();
        assertThat(credentialRepository.findByConnectionId(connection.getId())).isEmpty();
    }

    @Test
    @Transactional
    void deleteByConnectionIdRemovesOnlyTargetCredential() {
        UUID workspaceId = insertWorkspace("Credential Delete");
        Connection target = connectionRepository.save(newConnection(workspaceId, "Target"));
        Connection unrelated = connectionRepository.save(newConnection(workspaceId, "Unrelated"));
        Credential targetCredential = credentialRepository.save(
                Credential.createNew(target.getId(), new byte[] {1, 2}, "v1", null));
        Credential unrelatedCredential = credentialRepository.save(
                Credential.createNew(unrelated.getId(), new byte[] {3, 4}, "v1", null));

        credentialRepository.deleteByConnectionId(target.getId());
        entityManager.clear();

        assertThat(credentialRepository.findByConnectionId(target.getId())).isEmpty();
        assertThat(credentialRepository.findByConnectionId(unrelated.getId()))
                .hasValueSatisfying(found -> {
                    assertThat(found.getId()).isEqualTo(unrelatedCredential.getId());
                    assertThat(found.getEncryptedPayload()).containsExactly(3, 4);
                });
        assertThat(connectionRepository.findById(target.getId())).isPresent();
        assertThat(connectionRepository.findById(unrelated.getId())).isPresent();
        assertThat(targetCredential.getId()).isNotEqualTo(unrelatedCredential.getId());
    }

    @Test
    @Transactional
    void mappingPreservesConnectionFieldsTimestampsLifecycleAndConfig() {
        UUID workspaceId = insertWorkspace("Connection Mapping");
        UUID connectionId = UUID.randomUUID();
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        Instant updatedAt = Instant.parse("2026-01-02T00:00:00Z");
        Instant lastVerifiedAt = Instant.parse("2026-01-03T00:00:00Z");
        Map<String, Object> config = Map.of(
                "baseUrl", "https://example.test",
                "enabled", true,
                "scopes", List.of("read", "write"));
        Connection source = new Connection(
                connectionId,
                workspaceId,
                CREATOR_ID,
                "  Mixed\tCase  ",
                ConnectionProvider.HTTP,
                ConnectionAuthType.BASIC,
                ConnectionStatus.INVALID,
                config,
                lastVerifiedAt,
                createdAt,
                updatedAt);

        connectionRepository.save(source);
        entityManager.clear();
        Connection restored = connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId).orElseThrow();

        assertThat(restored.getId()).isEqualTo(connectionId);
        assertThat(restored.getWorkspaceId()).isEqualTo(workspaceId);
        assertThat(restored.getCreatedBy()).isEqualTo(CREATOR_ID);
        assertThat(restored.getName()).isEqualTo("Mixed Case");
        assertThat(restored.getProvider()).isEqualTo(ConnectionProvider.HTTP);
        assertThat(restored.getAuthType()).isEqualTo(ConnectionAuthType.BASIC);
        assertThat(restored.getStatus()).isEqualTo(ConnectionStatus.INVALID);
        assertThat(restored.getConfig()).isEqualTo(config);
        assertThat(restored.getLastVerifiedAt()).isEqualTo(lastVerifiedAt);
        assertThat(restored.getCreatedAt()).isEqualTo(createdAt);
        assertThat(restored.getUpdatedAt()).isEqualTo(updatedAt);
        assertThat(jdbcTemplate.queryForObject(
                "select name_normalized from workspace.connections where id = ?",
                String.class,
                connectionId)).isEqualTo(Connection.normalizeName(source.getName()));
    }

    @Test
    @Transactional
    void repositorySupportsScopedAndUnscopedFindsListingAndExclusionAwareUniqueness() {
        UUID firstWorkspaceId = insertWorkspace("Repository First");
        UUID secondWorkspaceId = insertWorkspace("Repository Second");
        Connection first = connectionRepository.save(newConnection(firstWorkspaceId, "First"));
        Connection second = connectionRepository.save(newConnection(firstWorkspaceId, "Second"));
        Connection otherWorkspace = connectionRepository.save(newConnection(secondWorkspaceId, "First"));
        entityManager.clear();

        assertThat(connectionRepository.findById(first.getId()))
                .hasValueSatisfying(found -> assertThat(found.getId()).isEqualTo(first.getId()));
        assertThat(connectionRepository.findByWorkspaceIdAndId(firstWorkspaceId, first.getId()))
                .hasValueSatisfying(found -> assertThat(found.getId()).isEqualTo(first.getId()));
        assertThat(connectionRepository.findByWorkspaceIdAndId(secondWorkspaceId, first.getId())).isEmpty();
        assertThat(connectionRepository.findAllByWorkspaceId(firstWorkspaceId))
                .extracting(Connection::getId)
                .containsExactlyInAnyOrder(first.getId(), second.getId());
        assertThat(connectionRepository.existsByWorkspaceIdAndNameNormalized(
                firstWorkspaceId, Connection.normalizeName(" first "), null)).isTrue();
        assertThat(connectionRepository.existsByWorkspaceIdAndNameNormalized(
                firstWorkspaceId, Connection.normalizeName(" first "), first.getId())).isFalse();
        assertThat(connectionRepository.existsByWorkspaceIdAndNameNormalized(
                secondWorkspaceId, Connection.normalizeName(" first "), otherWorkspace.getId())).isFalse();
    }

    @Test
    @Transactional
    void savingExistingRowsUpdatesNormalizedNameAndCredentialPayload() {
        UUID workspaceId = insertWorkspace("Existing Row Update");
        Connection connection = connectionRepository.save(newConnection(workspaceId, "Original"));
        Instant connectionCreatedAt = connection.getCreatedAt();
        Instant connectionUpdatedAt = connection.getUpdatedAt();

        Credential credential = credentialRepository.save(
                Credential.createNew(connection.getId(), new byte[] {1, 2, 3}, "v1", null));
        Instant credentialCreatedAt = credential.getCreatedAt();
        Instant credentialUpdatedAt = credential.getUpdatedAt();

        connection.rename("\tRenamed\nConnection ");
        connectionRepository.save(connection);
        Instant replacementExpiry = Instant.parse("2026-10-01T00:00:00Z");
        credentialRepository.save(new Credential(
                credential.getId(),
                connection.getId(),
                new byte[] {9, 8, 7},
                "v2",
                replacementExpiry,
                credential.getCreatedAt(),
                credential.getUpdatedAt()));
        entityManager.clear();

        Connection restoredConnection = connectionRepository.findById(connection.getId()).orElseThrow();
        Credential restoredCredential = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();

        assertThat(restoredConnection.getName()).isEqualTo("Renamed Connection");
        assertThat(jdbcTemplate.queryForObject(
                "select name_normalized from workspace.connections where id = ?",
                String.class,
                connection.getId())).isEqualTo(Connection.normalizeName(connection.getName()));
        assertThat(restoredConnection.getCreatedAt())
                .isCloseTo(connectionCreatedAt, within(1, ChronoUnit.MICROS));
        assertThat(restoredConnection.getUpdatedAt())
                .isAfterOrEqualTo(connectionUpdatedAt.minus(1, ChronoUnit.MICROS));

        assertThat(restoredCredential.getId()).isEqualTo(credential.getId());
        assertThat(restoredCredential.getEncryptedPayload()).containsExactly(9, 8, 7);
        assertThat(restoredCredential.getEncryptionKeyVersion()).isEqualTo("v2");
        assertThat(restoredCredential.getExpiresAt()).isEqualTo(replacementExpiry);
        assertThat(restoredCredential.getCreatedAt())
                .isCloseTo(credentialCreatedAt, within(1, ChronoUnit.MICROS));
        assertThat(restoredCredential.getUpdatedAt())
                .isAfterOrEqualTo(credentialUpdatedAt.minus(1, ChronoUnit.MICROS));
    }

    private Connection newConnection(UUID workspaceId, String name) {
        return Connection.createNew(
                workspaceId,
                CREATOR_ID,
                name,
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                Map.of("baseUrl", "https://example.test"));
    }

    private UUID insertWorkspace(String name) {
        UUID workspaceId = UUID.randomUUID();
        jdbcTemplate.update(
                "insert into workspace.workspaces "
                        + "(id, name, name_normalized, created_by, created_at, updated_at) "
                        + "values (?, ?, lower(btrim(?)), ?, now(), now())",
                workspaceId,
                name,
                name,
                CREATOR_ID);
        return workspaceId;
    }
}
