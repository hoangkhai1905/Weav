package com.weav.workspace.application.usecase;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.CreateConnectionCommand;
import com.weav.workspace.application.dto.UpdateConnectionCommand;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionConfigPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.ConnectionNameAlreadyExistsException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ConnectionUseCasesPersistenceIntegrationTest {

    private static final String WORKFLOW_KEY = "connection-usage-test-key";
    private static final AtomicBoolean WORKFLOW_IN_USE = new AtomicBoolean(false);
    private static final AtomicInteger WORKFLOW_CALLS = new AtomicInteger();
    private static HttpServer workflowServer;

    @DynamicPropertySource
    static void workflowProperties(DynamicPropertyRegistry registry) {
        ensureWorkflowServer();
        registry.add("weav.workflow.base-url", ConnectionUseCasesPersistenceIntegrationTest::workflowBaseUrl);
        registry.add("weav.workflow.internal-service-key", () -> WORKFLOW_KEY);
        registry.add("weav.workflow.connect-timeout", () -> "1s");
        registry.add("weav.workflow.read-timeout", () -> "1s");
    }

    @AfterAll
    static void stopWorkflowServer() {
        WORKFLOW_IN_USE.set(false);
        WORKFLOW_CALLS.set(0);
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
    private ConnectionProviderPolicy providerPolicy;

    @Autowired
    private ConnectionConfigPolicy configPolicy;

    @Autowired
    private ConnectionViewAssembler viewAssembler;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Autowired
    private CreateConnectionUseCase createConnectionUseCase;

    @Autowired
    private GetConnectionUseCase getConnectionUseCase;

    @Autowired
    private ListConnectionsUseCase listConnectionsUseCase;

    @Autowired
    private UpdateConnectionUseCase updateConnectionUseCase;

    @Autowired
    private DisableConnectionUseCase disableConnectionUseCase;

    @Autowired
    private DeleteConnectionUseCase deleteConnectionUseCase;

    @BeforeEach
    void resetWorkflowUsageFixture() {
        WORKFLOW_IN_USE.set(false);
        WORKFLOW_CALLS.set(0);
    }

    @Test
    void databaseUniqueConstraintIsTranslatedAfterPrecheckMiss() {
        // This deliberately forces two inserts in one transaction. It verifies
        // typed adapter translation; it is not a concurrent-race test.
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew("Connection race workspace", ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));

        ConnectionRepository collisionRepository = mock(ConnectionRepository.class);
        when(collisionRepository.existsByWorkspaceIdAndNameNormalized(
                workspace.getId(), "http api", null)).thenReturn(false);
        when(collisionRepository.save(any())).thenAnswer(invocation -> {
            Connection candidate = invocation.getArgument(0);
            connectionRepository.save(Connection.createNew(
                    candidate.getWorkspaceId(),
                    candidate.getCreatedBy(),
                    candidate.getName(),
                    candidate.getProvider(),
                    candidate.getAuthType(),
                    candidate.getConfig()));
            return connectionRepository.save(candidate);
        });

        CreateConnectionUseCase useCase = new CreateConnectionUseCase(
                collisionRepository,
                membershipRepository,
                credentialRepository,
                providerPolicy,
                configPolicy,
                viewAssembler,
                transactionRunner);

        assertThrows(ConnectionNameAlreadyExistsException.class, () -> useCase.execute(
                new CreateConnectionCommand(
                        workspace.getId(),
                        ownerId,
                        "HTTP API",
                        ConnectionProvider.HTTP,
                        ConnectionAuthType.NONE,
                        Map.of("baseUrl", "https://example.test"))));
    }

    @Test
    void springWiredCrudFlowPersistsAndEnforcesVisibilityAndMutationIsolation() {
        UUID ownerId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        UUID otherMemberId = UUID.randomUUID();
        String suffix = UUID.randomUUID().toString();
        Workspace workspace = workspaceRepository.save(
                Workspace.createNew("Connection CRUD " + suffix, ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        membershipRepository.save(Membership.member(workspace.getId(), creatorId));
        membershipRepository.save(Membership.member(workspace.getId(), otherMemberId));

        Map<String, Object> initialConfig = Map.of(
                "baseUrl", "https://api.example.test",
                "testPath", "/health",
                "apiKeyHeaderName", "X-Api-Key",
                "providerMode", "metadata");
        ConnectionResponse created = createConnectionUseCase.execute(new CreateConnectionCommand(
                workspace.getId(),
                creatorId,
                "  Primary\tConnection  ",
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                initialConfig));

        assertEquals(ConnectionStatus.DISABLED, created.status());
        assertEquals("Primary Connection", created.name());
        assertEquals(initialConfig, created.config());
        assertTrue(created.canManage());
        assertTrue(created.canAttach());

        ConnectionResponse ownerView = getConnectionUseCase.execute(
                ownerId, workspace.getId(), created.id());
        ConnectionResponse creatorView = getConnectionUseCase.execute(
                creatorId, workspace.getId(), created.id());
        ConnectionResponse otherView = getConnectionUseCase.execute(
                otherMemberId, workspace.getId(), created.id());
        assertEquals(initialConfig, ownerView.config());
        assertEquals(initialConfig, creatorView.config());
        assertNull(otherView.config());
        assertFalse(otherView.canManage());
        assertFalse(otherView.canAttach());
        assertEquals(1, listConnectionsUseCase.execute(otherMemberId, workspace.getId()).size());
        assertNull(listConnectionsUseCase.execute(otherMemberId, workspace.getId()).getFirst().config());

        // Verification is set directly as test state; no provider verification is in Task 3.
        Connection persisted = connectionRepository
                .findByWorkspaceIdAndId(workspace.getId(), created.id())
                .orElseThrow();
        persisted.markVerified(Instant.parse("2026-09-15T00:00:00Z"));
        connectionRepository.save(persisted);

        ConnectionResponse renamed = updateConnectionUseCase.execute(new UpdateConnectionCommand(
                workspace.getId(), creatorId, created.id(), "Renamed\tConnection", null));
        assertEquals("Renamed Connection", renamed.name());
        assertEquals(ConnectionStatus.ACTIVE, renamed.status());
        assertEquals(initialConfig, renamed.config());

        ConnectionResponse manuallyDisabled = disableConnectionUseCase.execute(
                ownerId, workspace.getId(), created.id());
        assertEquals(ConnectionStatus.DISABLED, manuallyDisabled.status());

        persisted = connectionRepository.findByWorkspaceIdAndId(workspace.getId(), created.id())
                .orElseThrow();
        persisted.markVerified(Instant.parse("2026-09-15T00:01:00Z"));
        connectionRepository.save(persisted);
        Map<String, Object> replacementConfig = Map.of(
                "baseUrl", "https://api.example.test/v2",
                "testPath", "/ready",
                "apiKeyHeaderName", "X-Api-Key",
                "providerMode", "metadata");
        ConnectionResponse configChanged = updateConnectionUseCase.execute(new UpdateConnectionCommand(
                workspace.getId(), creatorId, created.id(), null, replacementConfig));
        assertEquals(ConnectionStatus.DISABLED, configChanged.status());
        assertEquals(replacementConfig, configChanged.config());

        assertThrows(ForbiddenException.class, () -> updateConnectionUseCase.execute(
                new UpdateConnectionCommand(
                        workspace.getId(),
                        otherMemberId,
                        created.id(),
                        "Unauthorized Rename",
                        Map.of("baseUrl", "https://attacker.example.test"))));

        ConnectionResponse ownerAfterDeniedUpdate = getConnectionUseCase.execute(
                ownerId, workspace.getId(), created.id());
        assertEquals("Renamed Connection", ownerAfterDeniedUpdate.name());
        assertEquals(replacementConfig, ownerAfterDeniedUpdate.config());
        assertEquals(ConnectionStatus.DISABLED, ownerAfterDeniedUpdate.status());

        ConnectionResponse otherAfterDeniedUpdate = getConnectionUseCase.execute(
                otherMemberId, workspace.getId(), created.id());
        assertNull(otherAfterDeniedUpdate.config());
        assertFalse(otherAfterDeniedUpdate.canManage());
        assertTrue(listConnectionsUseCase.execute(ownerId, workspace.getId()).stream()
                .map(ConnectionResponse::name)
                .toList()
                .contains("Renamed Connection"));

        // Manual disable is idempotent after the persisted config update.
        assertEquals(ConnectionStatus.DISABLED, disableConnectionUseCase.execute(
                creatorId, workspace.getId(), created.id()).status());
        assertEquals(ConnectionStatus.DISABLED, getConnectionUseCase.execute(
                ownerId, workspace.getId(), created.id()).status());
    }

    @Test
    void injectedMemberMutationDoesNotWriteWhenWorkflowReportsConnectionInUse() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(
                Workspace.createNew("Connection usage protection " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        membershipRepository.save(Membership.member(workspace.getId(), memberId));
        Connection connection = connectionRepository.save(Connection.createNew(
                workspace.getId(),
                memberId,
                "Protected connection",
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                Map.of("baseUrl", "https://protected.example.test")));

        WORKFLOW_IN_USE.set(true);
        try {
            assertThrows(ConflictException.class, () -> updateConnectionUseCase.execute(
                    new UpdateConnectionCommand(
                            workspace.getId(), memberId, connection.getId(), "Rejected rename", null)));
        } finally {
            WORKFLOW_IN_USE.set(false);
        }

        Connection persisted = connectionRepository.findById(connection.getId()).orElseThrow();
        assertEquals("Protected connection", persisted.getName());
        assertEquals(Map.of("baseUrl", "https://protected.example.test"), persisted.getConfig());
        assertEquals(ConnectionStatus.DISABLED, persisted.getStatus());
    }

    @Test
    void protectedMutationRejectsAmbientTransactionBeforeWorkflowCallOrDatabaseWrite() {
        UUID ownerId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(
                Workspace.createNew("Ambient transaction protection " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        membershipRepository.save(Membership.member(workspace.getId(), memberId));
        Connection connection = connectionRepository.save(Connection.createNew(
                workspace.getId(),
                memberId,
                "Ambient transaction connection",
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                Map.of("baseUrl", "https://ambient.example.test")));

        TransactionTemplate ambientTransaction = new TransactionTemplate(transactionManager);
        assertThrows(InvalidStateException.class, () -> ambientTransaction.execute(status -> {
            updateConnectionUseCase.execute(new UpdateConnectionCommand(
                    workspace.getId(), memberId, connection.getId(), "Should not persist", null));
            return null;
        }));

        assertEquals(0, WORKFLOW_CALLS.get());
        Connection persisted = connectionRepository.findById(connection.getId()).orElseThrow();
        assertEquals("Ambient transaction connection", persisted.getName());
        assertEquals(Map.of("baseUrl", "https://ambient.example.test"), persisted.getConfig());
        assertEquals(ConnectionStatus.DISABLED, persisted.getStatus());
    }

    @Test
    void injectedDeleteChecksWorkflowAndDatabaseCascadeRemovesCredential() {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(
                Workspace.createNew("Connection delete " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        Connection connection = connectionRepository.save(Connection.createNew(
                workspace.getId(),
                ownerId,
                "Delete with credential",
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                Map.of("baseUrl", "https://delete.example.test")));
        credentialRepository.save(new com.weav.workspace.domain.model.Credential(
                UUID.randomUUID(),
                connection.getId(),
                new byte[] {1, 2, 3},
                "v1",
                null,
                Instant.parse("2026-09-16T00:00:00Z"),
                Instant.parse("2026-09-16T00:00:00Z")));

        deleteConnectionUseCase.execute(ownerId, workspace.getId(), connection.getId());

        assertTrue(connectionRepository.findById(connection.getId()).isEmpty());
        assertTrue(credentialRepository.findByConnectionId(connection.getId()).isEmpty());
    }

    private static void ensureWorkflowServer() {
        if (workflowServer != null) {
            return;
        }
        try {
            workflowServer = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            workflowServer.createContext("/internal/workspaces", ConnectionUseCasesPersistenceIntegrationTest::handleUsage);
            workflowServer.start();
        } catch (IOException exception) {
            throw new IllegalStateException("Could not start local Workflow usage fixture", exception);
        }
    }

    private static String workflowBaseUrl() {
        return "http://127.0.0.1:" + workflowServer.getAddress().getPort();
    }

    private static void handleUsage(HttpExchange exchange) throws IOException {
        WORKFLOW_CALLS.incrementAndGet();
        if (!WORKFLOW_KEY.equals(exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"))) {
            respondUsage(exchange, 401, "{}");
            return;
        }
        respondUsage(exchange, 200, "{\"inUse\":" + WORKFLOW_IN_USE.get() + "}");
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
