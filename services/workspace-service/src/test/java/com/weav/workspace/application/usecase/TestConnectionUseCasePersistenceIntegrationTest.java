package com.weav.workspace.application.usecase;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
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
    private EntityManager entityManager;

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
                        "apiKey", "synthetic-api-key"))),
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
                transactionRunner);
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
