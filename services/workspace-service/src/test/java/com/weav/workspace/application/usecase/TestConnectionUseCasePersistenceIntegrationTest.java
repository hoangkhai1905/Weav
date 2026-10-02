package com.weav.workspace.application.usecase;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.notification.NotificationOutboxWriteException;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
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
import com.weav.workspace.infrastructure.provider.http.HttpConnectionProvider;
import com.weav.workspace.infrastructure.provider.http.HttpTargetValidator;
import com.weav.workspace.infrastructure.provider.http.PinnedHttpTransport;
import jakarta.persistence.EntityManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.assertThrows;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class TestConnectionUseCasePersistenceIntegrationTest {

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private MembershipRepository membershipRepository;

    @Autowired
    private ConnectionRepository connectionRepository;

    @Autowired
    private CredentialRepository credentialRepository;

    @Autowired
    private CredentialCryptoPort credentialCrypto;

    @Autowired
    private CredentialPayloadCodec payloadCodec;

    @Autowired
    private ConnectionProviderPolicy providerPolicy;

    @Autowired
    private ConnectionAuthorizationPolicy authorizationPolicy;

    @Autowired
    private TransactionRunner transactionRunner;

    @Autowired
    private WorkspaceMutationLock workspaceMutationLock;

    @Autowired
    private ConnectionNotificationRecorder notificationRecorder;

    @Autowired
    private EntityManager entityManager;

    @Autowired
    private JdbcTemplate jdbc;

    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    @Test
    void realHttpVerificationPersistsVerifiedStateThroughPostgres() throws Exception {
        AtomicReference<String> requestPath = new AtomicReference<>();
        startServer(exchange -> {
            requestPath.set(exchange.getRequestURI().getPath());
            respond(exchange, 204, "");
        });

        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Provider verification " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        Connection connection = connectionRepository.save(Connection.createNew(
                workspace.getId(),
                ownerId,
                "Local HTTP health",
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                Map.of("baseUrl", baseUrl(), "testPath", "/health")));

        ConnectionTestResult result = localUseCase().execute(
                ownerId, workspace.getId(), connection.getId());

        assertThat(result.outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
        assertThat(requestPath).hasValue("/health");

        entityManager.clear();
        Connection persisted = connectionRepository.findById(connection.getId()).orElseThrow();
        assertThat(persisted.getStatus()).isEqualTo(ConnectionStatus.ACTIVE);
        assertThat(persisted.getLastVerifiedAt()).isNotNull();
    }

    @Test
    void realHttpVerificationDecryptsCredentialAndSendsOnlyConfiguredHeader() throws Exception {
        AtomicReference<String> apiKey = new AtomicReference<>();
        startServer(exchange -> {
            apiKey.set(exchange.getRequestHeaders().getFirst("X-Api-Key"));
            respond(exchange, 200, "ok");
        });

        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Provider credential verification " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        Connection connection = connectionRepository.save(Connection.createNew(
                workspace.getId(),
                ownerId,
                "Local HTTP API key",
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                Map.of(
                        "baseUrl", baseUrl(),
                        "testPath", "/health",
                        "apiKeyHeaderName", "X-Api-Key")));

        providerPolicy.validate(connection.getProvider(), connection.getAuthType());
        credentialRepository.save(Credential.createNew(
                connection.getId(),
                credentialCrypto.encrypt(payloadCodec.encode(connection, Map.of(
                        "apiKey", "synthetic-api-key")), connection.getId()),
                credentialCrypto.currentKeyVersion(),
                null));

        ConnectionTestResult result = localUseCase().execute(
                ownerId, workspace.getId(), connection.getId());

        assertThat(result.outcome())
                .isEqualTo(ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
        assertThat(apiKey).hasValue("synthetic-api-key");
        entityManager.clear();
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.ACTIVE);
    }

    @Test
    void genericHttpErrorsPreserveActiveAndDisabledState() throws Exception {
        for (int responseStatus : List.of(404, 405)) {
            for (ConnectionStatus initialStatus : List.of(
                    ConnectionStatus.DISABLED, ConnectionStatus.ACTIVE)) {
                stopServer();
                startServer(exchange -> respond(exchange, responseStatus, "generic request error"));

                UUID ownerId = UUID.randomUUID();
                Workspace workspace = workspaceRepository.save(Workspace.createNew(
                        "Provider generic error " + UUID.randomUUID(), ownerId));
                membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
                Connection connection = Connection.createNew(
                        workspace.getId(),
                        ownerId,
                        "Local HTTP generic error",
                        ConnectionProvider.HTTP,
                        ConnectionAuthType.NONE,
                        Map.of("baseUrl", baseUrl(), "testPath", "/health"));
                if (initialStatus == ConnectionStatus.ACTIVE) {
                    connection.markVerified(Instant.now());
                }
                connectionRepository.save(connection);

                assertThrows(DependencyUnavailableException.class,
                        () -> localUseCase().execute(ownerId, workspace.getId(), connection.getId()));

                entityManager.clear();
                Connection persisted = connectionRepository.findById(connection.getId()).orElseThrow();
                assertThat(persisted.getStatus()).isEqualTo(initialStatus);
                if (initialStatus == ConnectionStatus.ACTIVE) {
                    assertThat(persisted.getLastVerifiedAt()).isNotNull();
                }
            }
        }
    }

    @Test
    void confirmedHttpRejectionInvalidatesButTransientResponsesAndTimeoutDoNot() throws Exception {
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Provider auth classification " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));

        startServer(exchange -> respond(exchange, 401, "provider response must not be persisted"));
        Connection rejected = saveHttpConnection(workspace, ownerId, "auth-rejected");
        ConnectionTestResult rejectedResult = localUseCase().execute(ownerId, workspace.getId(), rejected.getId());
        assertThat(rejectedResult.outcome()).isEqualTo(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID);
        entityManager.clear();
        assertThat(connectionRepository.findById(rejected.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.INVALID);
        assertThat(notificationCount(rejected.getId(), "connection.invalid")).isEqualTo(1);

        for (int responseStatus : List.of(429, 500)) {
            stopServer();
            startServer(exchange -> respond(exchange, responseStatus, "transient provider failure"));
            Connection connection = saveHttpConnection(workspace, ownerId, "transient-" + responseStatus);
            assertThatThrownBy(() -> localUseCase().execute(ownerId, workspace.getId(), connection.getId()))
                    .isInstanceOf(DependencyUnavailableException.class);
            entityManager.clear();
            assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                    .isEqualTo(ConnectionStatus.DISABLED);
            assertThat(notificationCount(connection.getId(), "connection.invalid")).isZero();
        }

        stopServer();
        startServer(exchange -> {
            try {
                Thread.sleep(1_500);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            respond(exchange, 200, "late response");
        });
        Connection timeout = saveHttpConnection(workspace, ownerId, "timeout");
        assertThatThrownBy(() -> localUseCase().execute(ownerId, workspace.getId(), timeout.getId()))
                .isInstanceOf(DependencyUnavailableException.class);
        entityManager.clear();
        assertThat(connectionRepository.findById(timeout.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(notificationCount(timeout.getId(), "connection.invalid")).isZero();
    }

    @Test
    void connectionOutboxFailureRollsBackTheStatusTransition() throws Exception {
        startServer(exchange -> respond(exchange, 204, ""));
        UUID ownerId = UUID.randomUUID();
        Workspace workspace = workspaceRepository.save(Workspace.createNew(
                "Connection outbox rollback " + UUID.randomUUID(), ownerId));
        membershipRepository.save(Membership.owner(workspace.getId(), ownerId));
        Connection connection = saveHttpConnection(workspace, ownerId, "rollback");
        String suffix = UUID.randomUUID().toString().replace("-", "");
        String triggerName = "task5_reject_trigger_" + suffix;
        String functionName = "task5_reject_function_" + suffix;
        jdbc.execute("create function workspace." + functionName + "() returns trigger language plpgsql as $$ "
                + "begin if new.event_type = 'connection.connected' then "
                + "raise exception 'forced task5 outbox failure'; end if; return new; end $$");
        jdbc.execute("create trigger " + triggerName + " before insert on workspace.notification_outbox "
                + "for each row execute function workspace." + functionName + "()");
        try {
            assertThatThrownBy(() -> localUseCase().execute(ownerId, workspace.getId(), connection.getId()))
                    .isInstanceOf(NotificationOutboxWriteException.class)
                    .hasMessage("Could not persist Workspace notification outbox event")
                    .hasNoCause();
        } finally {
            jdbc.execute("drop trigger if exists " + triggerName + " on workspace.notification_outbox");
            jdbc.execute("drop function if exists workspace." + functionName + "()");
        }

        entityManager.clear();
        assertThat(connectionRepository.findById(connection.getId()).orElseThrow().getStatus())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(notificationCount(connection.getId(), "connection.connected")).isZero();
    }

    private Connection saveHttpConnection(Workspace workspace, UUID ownerId, String suffix) {
        return connectionRepository.save(Connection.createNew(
                workspace.getId(), ownerId, "Local HTTP " + suffix, ConnectionProvider.HTTP,
                ConnectionAuthType.NONE, Map.of("baseUrl", baseUrl(), "testPath", "/health")));
    }

    private int notificationCount(UUID connectionId, String eventType) {
        return jdbc.queryForObject("select count(*) from workspace.notification_outbox "
                + "where event_type = ? and payload -> 'entity' ->> 'id' = ?",
                Integer.class, eventType, connectionId.toString());
    }

    private TestConnectionUseCase localUseCase() {
        HttpConnectionProvider localProvider = new HttpConnectionProvider(
                new HttpTargetValidator(true),
                new PinnedHttpTransport(Duration.ofSeconds(1), Duration.ofSeconds(1)));
        return new TestConnectionUseCase(
                connectionRepository,
                membershipRepository,
                credentialRepository,
                authorizationPolicy,
                new ConnectionProviderRegistry(localProvider),
                payloadCodec,
                credentialCrypto,
                (workspaceId, connectionId) -> false,
                transactionRunner,
                workspaceMutationLock,
                notificationRecorder);
    }

    private void startServer(Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> handler.handle(exchange));
        server.start();
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    @FunctionalInterface
    private interface Handler {
        void handle(HttpExchange exchange) throws IOException;
    }
}
