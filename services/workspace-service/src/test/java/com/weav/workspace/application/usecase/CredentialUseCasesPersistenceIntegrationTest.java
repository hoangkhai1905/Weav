package com.weav.workspace.application.usecase;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.SaveCredentialCommand;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.mockito.Mockito;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.Arrays;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class CredentialUseCasesPersistenceIntegrationTest {

    private static final String WORKFLOW_KEY = "credential-usage-test-key";
    private static HttpServer workflowServer;

    @DynamicPropertySource
    static void workflowProperties(DynamicPropertyRegistry registry) {
        ensureWorkflowServer();
        registry.add("weav.workflow.base-url", CredentialUseCasesPersistenceIntegrationTest::workflowBaseUrl);
        registry.add("weav.workflow.internal-service-key", () -> WORKFLOW_KEY);
        registry.add("weav.workflow.connect-timeout", () -> "1s");
        registry.add("weav.workflow.read-timeout", () -> "1s");
    }

    @AfterAll
    static void stopWorkflowServer() {
        if (workflowServer != null) {
            workflowServer.stop(0);
            workflowServer = null;
        }
    }

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private ConnectionRepository connectionRepository;

    @Autowired
    private CredentialRepository credentialRepository;

    @Autowired
    private SaveCredentialUseCase saveCredentialUseCase;

    @Autowired
    private DeleteCredentialUseCase deleteCredentialUseCase;

    @Autowired
    private CredentialCryptoPort credentialCrypto;

    @Autowired
    private CredentialPayloadCodec payloadCodec;

    @Autowired
    private ConnectionAuthorizationPolicy authorizationPolicy;

    @Autowired
    private ConnectionViewAssembler viewAssembler;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private tools.jackson.databind.ObjectMapper objectMapper;

    @Test
    void injectedUseCasesPersistEncryptedPayloadReplaceBySameIdAndDeleteIdempotently() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Credential lifecycle " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));

        Connection connection = Connection.createNew(
                workspace.getId(),
                ownerId,
                "HTTP credential",
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                Map.of("baseUrl", "https://api.example.test"));
        connection.markVerified(Instant.parse("2026-09-15T00:00:00Z"));
        connection = connectionRepository.save(connection);

        Map<String, Object> firstPayload = Map.of("apiKey", "first-api-key");
        Instant firstExpiry = Instant.parse("2026-10-01T00:00:00Z");
        ConnectionResponse firstResult = saveCredentialUseCase.execute(new SaveCredentialCommand(
                workspace.getId(), ownerId, connection.getId(), firstPayload, firstExpiry));
        assertThat(firstResult.status()).isEqualTo(ConnectionStatus.DISABLED);
        assertThat(firstResult.hasCredential()).isTrue();

        entityManager.clear();
        Credential first = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        byte[] firstRaw = rawPayload(connection.getId());
        byte[] firstPlaintext = objectMapper.writeValueAsBytes(firstPayload);
        assertThat(Arrays.equals(firstRaw, firstPlaintext)).isFalse();
        assertThat(credentialCrypto.decrypt(firstRaw)).containsExactly(firstPlaintext);
        assertThat(first.getEncryptedPayload()).containsExactly(firstRaw);

        Map<String, Object> replacementPayload = Map.of("apiKey", "replacement-api-key");
        Instant replacementExpiry = Instant.parse("2026-11-01T00:00:00Z");
        ConnectionResponse replacementResult = saveCredentialUseCase.execute(new SaveCredentialCommand(
                workspace.getId(), ownerId, connection.getId(), replacementPayload, replacementExpiry));
        assertThat(replacementResult.status()).isEqualTo(ConnectionStatus.DISABLED);

        entityManager.clear();
        Credential replacement = credentialRepository.findByConnectionId(connection.getId()).orElseThrow();
        assertThat(replacement.getId()).isEqualTo(first.getId());
        assertThat(replacement.getCreatedAt()).isEqualTo(first.getCreatedAt());
        assertThat(replacement.getUpdatedAt()).isAfterOrEqualTo(first.getUpdatedAt());
        assertThat(replacement.getExpiresAt()).isEqualTo(replacementExpiry);
        assertThat(credentialCrypto.decrypt(rawPayload(connection.getId())))
                .containsExactly(objectMapper.writeValueAsBytes(replacementPayload));

        ConnectionResponse deleted = deleteCredentialUseCase.execute(ownerId, workspace.getId(), connection.getId());
        assertThat(deleted.status()).isEqualTo(ConnectionStatus.DISABLED);
        assertThat(deleted.hasCredential()).isFalse();
        entityManager.clear();
        assertThat(credentialRepository.findByConnectionId(connection.getId())).isEmpty();
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);

        assertThat(deleteCredentialUseCase.execute(ownerId, workspace.getId(), connection.getId()).hasCredential())
                .isFalse();
    }

    @Test
    void saveRollsBackCredentialWhenConnectionPersistenceFails() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Credential connection rollback " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        Connection active = connectionRepository.save(activeConnection(workspace.getId(), ownerId));

        ConnectionRepository failingConnections = Mockito.mock(ConnectionRepository.class);
        when(failingConnections.findByWorkspaceIdAndId(workspace.getId(), active.getId()))
                .thenAnswer(invocation -> connectionRepository.findByWorkspaceIdAndId(
                        workspace.getId(), active.getId()));
        doAnswer(invocation -> {
            connectionRepository.save(invocation.getArgument(0));
            throw new IllegalStateException("forced connection failure");
        }).when(failingConnections).save(any(Connection.class));

        SaveCredentialUseCase useCase = new SaveCredentialUseCase(
                failingConnections,
                membershipRepository,
                credentialRepository,
                authorizationPolicy,
                payloadCodec,
                credentialCrypto,
                viewAssembler,
                (workspaceId, connectionId) -> false,
                transactionRunner);

        assertThatThrownBy(() -> useCase.execute(new SaveCredentialCommand(
                workspace.getId(), ownerId, active.getId(), Map.of("apiKey", "rollback-api-key"), null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("forced connection failure");

        entityManager.clear();
        assertThat(credentialRepository.findByConnectionId(active.getId())).isEmpty();
        assertThat(connectionRepository.findById(active.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
    }

    @Test
    void saveRollsBackConnectionWhenCredentialPersistenceFails() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Credential credential rollback " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        Connection active = connectionRepository.save(activeConnection(workspace.getId(), ownerId));

        CredentialRepository failingCredentials = Mockito.mock(CredentialRepository.class);
        when(failingCredentials.findByConnectionId(active.getId())).thenReturn(Optional.empty());
        when(failingCredentials.save(any(Credential.class)))
                .thenThrow(new IllegalStateException("forced credential failure"));

        SaveCredentialUseCase useCase = new SaveCredentialUseCase(
                connectionRepository,
                membershipRepository,
                failingCredentials,
                authorizationPolicy,
                payloadCodec,
                credentialCrypto,
                viewAssembler,
                (workspaceId, connectionId) -> false,
                transactionRunner);

        assertThatThrownBy(() -> useCase.execute(new SaveCredentialCommand(
                workspace.getId(), ownerId, active.getId(), Map.of("apiKey", "rollback-api-key"), null)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("forced credential failure");

        entityManager.clear();
        assertThat(connectionRepository.findById(active.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
    }

    private Connection activeConnection(UUID workspaceId, UUID ownerId) {
        Connection connection = Connection.createNew(
                workspaceId,
                ownerId,
                "Rollback connection",
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                Map.of("baseUrl", "https://rollback.example.test"));
        connection.markVerified(Instant.parse("2026-09-15T00:00:00Z"));
        return connection;
    }

    private byte[] rawPayload(UUID connectionId) {
        return jdbcTemplate.queryForObject(
                "select encrypted_payload from workspace.credentials where connection_id = ?",
                (resultSet, rowNum) -> resultSet.getBytes(1),
                connectionId);
    }

    private static void ensureWorkflowServer() {
        if (workflowServer != null) {
            return;
        }
        try {
            workflowServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            workflowServer.createContext("/internal/workspaces", CredentialUseCasesPersistenceIntegrationTest::handleUsage);
            workflowServer.start();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not start local Workflow usage fixture", exception);
        }
    }

    private static String workflowBaseUrl() {
        return "http://127.0.0.1:" + workflowServer.getAddress().getPort();
    }

    private static void handleUsage(HttpExchange exchange) throws IOException {
        if (!WORKFLOW_KEY.equals(exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"))) {
            respondUsage(exchange, 401, "{}");
            return;
        }
        respondUsage(exchange, 200, "{\"inUse\":false}");
    }

    private static void respondUsage(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }
}
