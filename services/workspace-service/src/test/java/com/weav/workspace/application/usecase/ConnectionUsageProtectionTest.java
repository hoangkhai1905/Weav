package com.weav.workspace.application.usecase;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.weav.workspace.application.dto.SaveCredentialCommand;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionConfigPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.ConflictException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import com.weav.workspace.infrastructure.config.WorkflowServiceProperties;
import com.weav.workspace.infrastructure.workflow.WorkflowConnectionUsageClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

class ConnectionUsageProtectionTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OWNER = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER = UUID.fromString("20000000-0000-0000-0000-000000000002");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final String SERVICE_KEY = "synthetic-workflow-key";
    private static final String KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

    private final ConnectionAuthorizationPolicy authorizationPolicy = new ConnectionAuthorizationPolicy();
    private final ConnectionProviderPolicy providerPolicy = new ConnectionProviderPolicy();
    private final CredentialPayloadCodec payloadCodec = new CredentialPayloadCodec(
            new ObjectMapper(), providerPolicy);
    private final CredentialCryptoPort crypto = new com.weav.workspace.infrastructure.credential.AesGcmCredentialCrypto(
            new com.weav.workspace.infrastructure.config.CredentialEncryptionProperties(KEY, "v1"));
    private HttpServer server;

    @AfterEach
    void stopServer() {
        if (server != null) {
            server.stop(0);
            server = null;
        }
    }

    @Test
    void memberOwnUpdateIsAllowedWhenWorkflowReportsUnused() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(connections.existsByWorkspaceIdAndNameNormalized(WORKSPACE, "renamed", CONNECTION_ID))
                .thenReturn(false);
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> false,
                new DirectTransactionRunner());

        assertThat(useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Renamed", null)).name()).isEqualTo("Renamed");
        verify(connections).save(connection);
    }

    @Test
    void memberOwnUpdateIsRejectedBeforeMutationWhenReferenced() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());

        assertThatThrownBy(() -> useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Rejected", null)))
                .isInstanceOf(ConflictException.class);
        verify(connections, never()).save(any());
    }

    @Test
    void ownerMayUpdateReferencedConnectionWithoutUsageCall() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        AtomicInteger usageCalls = new AtomicInteger();
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> {
                    usageCalls.incrementAndGet();
                    return true;
                },
                new DirectTransactionRunner());

        useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                WORKSPACE, OWNER, CONNECTION_ID, "Owner update", null));
        assertThat(usageCalls).hasValue(0);
        verify(connections).save(connection);
    }

    @Test
    void memberCredentialSaveAndEveryCredentialDeleteFailClosedWhenReferenced() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        var save = new SaveCredentialUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                payloadCodec,
                crypto,
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());
        assertThatThrownBy(() -> save.execute(new SaveCredentialCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, Map.of("apiKey", "synthetic"), null)))
                .isInstanceOf(ConflictException.class);

        var delete = new DeleteCredentialUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());
        assertThatThrownBy(() -> delete.execute(MEMBER, WORKSPACE, CONNECTION_ID))
                .isInstanceOf(ConflictException.class);
        verify(credentials, never()).save(any());
        verify(credentials, never()).deleteByConnectionId(CONNECTION_ID);
    }

    @Test
    void ownerCredentialRotationAndDeletionSkipUsageCheckEvenWhenWorkflowIsUnavailable() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());
        when(credentials.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        var save = new SaveCredentialUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                payloadCodec,
                crypto,
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());
        save.execute(new SaveCredentialCommand(
                WORKSPACE, OWNER, CONNECTION_ID, Map.of("apiKey", "synthetic"), null));
        verify(credentials).save(any());

        var usageCalls = new AtomicInteger();
        var delete = new DeleteCredentialUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> {
                    usageCalls.incrementAndGet();
                    throw new DependencyUnavailableException();
                },
                new DirectTransactionRunner());
        delete.execute(OWNER, WORKSPACE, CONNECTION_ID);
        assertThat(usageCalls).hasValue(0);
        verify(credentials).deleteByConnectionId(CONNECTION_ID);
    }

    @Test
    void connectionDeletionRequiresUnusedForOwnerAndMemberAndCascadesThroughRepositoryContract() {
        for (Membership membership : new Membership[] {
                Membership.owner(WORKSPACE, OWNER),
                Membership.member(WORKSPACE, MEMBER)}) {
            ConnectionRepository connections = mock(ConnectionRepository.class);
            MembershipRepository memberships = mock(MembershipRepository.class);
            Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
            when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, membership.getUserId()))
                    .thenReturn(Optional.of(membership));
            when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                    .thenReturn(Optional.of(connection));

            var delete = new DeleteConnectionUseCase(
                    connections,
                    new ConnectionUsageProtection(
                            connections,
                            memberships,
                            authorizationPolicy,
                            (workspaceId, connectionId) -> true,
                            new DirectTransactionRunner()));

            assertThatThrownBy(() -> delete.execute(
                    membership.getUserId(), WORKSPACE, CONNECTION_ID))
                    .isInstanceOf(ConflictException.class);
            verify(connections, never()).delete(any());
        }
    }

    @Test
    void unavailableWorkflowPreventsMutationAndDoesNotExposeDependencyCause() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        RuntimeException downstream = new RuntimeException("secret downstream payload");

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> {
                    throw new DependencyUnavailableException();
                },
                new DirectTransactionRunner());

        assertThatThrownBy(() -> useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Unavailable", null)))
                .isInstanceOf(DependencyUnavailableException.class)
                .hasMessageNotContaining(downstream.getMessage());
        verify(connections, never()).save(any());
    }

    @Test
    void memberDisableAndProviderTestAreAlsoProtected() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());
        AtomicInteger providerCalls = new AtomicInteger();
        ConnectionProviderPort provider = new ConnectionProviderPort() {
            @Override
            public ConnectionProvider provider() {
                return ConnectionProvider.HTTP;
            }

            @Override
            public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
            }

            @Override
            public com.weav.workspace.application.dto.ConnectionTestResult test(
                    Connection tested, Map<String, Object> credential) {
                providerCalls.incrementAndGet();
                return com.weav.workspace.application.dto.ConnectionTestResult.verified();
            }
        };

        var disable = new DisableConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());
        assertThatThrownBy(() -> disable.execute(MEMBER, WORKSPACE, CONNECTION_ID))
                .isInstanceOf(ConflictException.class);

        var test = new TestConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionProviderRegistry(provider),
                payloadCodec,
                crypto,
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());
        assertThatThrownBy(() -> test.execute(MEMBER, WORKSPACE, CONNECTION_ID))
                .isInstanceOf(ConflictException.class);
        assertThat(providerCalls).hasValue(0);
        verify(connections, never()).save(any());
    }

    @Test
    void ownerMayDisableAndTestReferencedConnection() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER, ConnectionAuthType.NONE);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());
        AtomicInteger usageCalls = new AtomicInteger();
        WorkflowConnectionUsagePort usage = (workspaceId, connectionId) -> {
            usageCalls.incrementAndGet();
            return true;
        };
        ConnectionProviderPort provider = new ConnectionProviderPort() {
            @Override
            public ConnectionProvider provider() {
                return ConnectionProvider.HTTP;
            }

            @Override
            public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
            }

            @Override
            public com.weav.workspace.application.dto.ConnectionTestResult test(
                    Connection tested, Map<String, Object> credential) {
                return com.weav.workspace.application.dto.ConnectionTestResult.verified();
            }
        };

        var disable = new DisableConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                usage,
                new DirectTransactionRunner());
        assertThat(disable.execute(OWNER, WORKSPACE, CONNECTION_ID).status())
                .isEqualTo(ConnectionStatus.DISABLED);

        var test = new TestConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionProviderRegistry(provider),
                payloadCodec,
                crypto,
                usage,
                new DirectTransactionRunner());
        assertThat(test.execute(OWNER, WORKSPACE, CONNECTION_ID).outcome())
                .isEqualTo(com.weav.workspace.application.dto.ConnectionTestResult.ConnectionTestOutcome.VERIFIED);
        assertThat(usageCalls).hasValue(0);
    }

    @Test
    void freshMembershipIsRecheckedAfterWorkflowWaitAndRemoteRunsOutsideTransaction() {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Membership initial = Membership.member(WORKSPACE, MEMBER);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(initial), Optional.empty());
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        TrackingTransactionRunner runner = new TrackingTransactionRunner();
        AtomicReference<Boolean> transactionAtRemote = new AtomicReference<>();

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> {
                    transactionAtRemote.set(runner.active());
                    return false;
                },
                runner);

        assertThatThrownBy(() -> useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Fresh auth", null)))
                .isInstanceOf(ResourceNotFoundException.class);
        assertThat(transactionAtRemote).hasValue(false);
        verify(connections, never()).save(any());
    }

    @Test
    void ownerDowngradeDuringWorkflowWaitFailsClosedBeforeMemberMutation() {
        Connection connection = connection(ConnectionStatus.ACTIVE, OWNER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        Membership member = Membership.member(WORKSPACE, OWNER);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(owner), Optional.of(member));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                (workspaceId, connectionId) -> true,
                new DirectTransactionRunner());

        assertThatThrownBy(() -> useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                WORKSPACE, OWNER, CONNECTION_ID, "Downgraded", null)))
                .isInstanceOf(ConflictException.class);
        verify(connections, never()).save(any());
    }

    @Test
    void workflowClientUsesInternalHeaderAndStrictBooleanPayload() throws Exception {
        UUID workspaceId = UUID.randomUUID();
        UUID connectionId = UUID.randomUUID();
        AtomicReference<String> path = new AtomicReference<>();
        AtomicReference<String> header = new AtomicReference<>();
        startServer(exchange -> {
            path.set(exchange.getRequestURI().getPath());
            header.set(exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"));
            respond(exchange, 200, "{\"inUse\":true}");
        });

        boolean inUse = client(Duration.ofSeconds(1), Duration.ofSeconds(1), SERVICE_KEY)
                .isInUse(workspaceId, connectionId);

        assertThat(inUse).isTrue();
        assertThat(path).hasValue("/internal/workspaces/" + workspaceId
                + "/connections/" + connectionId + "/usage");
        assertThat(header).hasValue(SERVICE_KEY);
    }

    @Test
    void workflowClientFailsClosedForInvalidStatusesBodiesAndMissingKey() throws Exception {
        for (int status : new int[] {401, 404, 429, 500}) {
            stopServer();
            int responseStatus = status;
            startServer(exchange -> respond(exchange, responseStatus, "downstream body"));
            assertThatThrownBy(() -> client(Duration.ofSeconds(1), Duration.ofSeconds(1), SERVICE_KEY)
                    .isInUse(WORKSPACE, CONNECTION_ID))
                    .isInstanceOf(DependencyUnavailableException.class);
        }

        for (String body : new String[] {
                "{}", "{\"inUse\":\"true\"}", "{\"inUse\":1}", "null",
                "{\"inUse\":true,\"extra\":false}", "{\"inUse\":true}{\"extra\":false}"}) {
            stopServer();
            String responseBody = body;
            startServer(exchange -> respond(exchange, 200, responseBody));
            assertThatThrownBy(() -> client(Duration.ofSeconds(1), Duration.ofSeconds(1), SERVICE_KEY)
                    .isInUse(WORKSPACE, CONNECTION_ID))
                    .isInstanceOf(DependencyUnavailableException.class);
        }

        stopServer();
        startServer(exchange -> respond(exchange, 200, "{\"inUse\":false}"));
        assertThatThrownBy(() -> client(Duration.ofSeconds(1), Duration.ofSeconds(1), "")
                .isInUse(WORKSPACE, CONNECTION_ID))
                .isInstanceOf(DependencyUnavailableException.class);
    }

    @Test
    void workflowClientDoesNotFollowRedirectOrForwardInternalKey() throws Exception {
        AtomicReference<String> redirectedHeader = new AtomicReference<>();
        startServer(exchange -> {
            if (exchange.getRequestURI().getPath().contains("/usage")) {
                exchange.getResponseHeaders().set("Location", "/redirect");
                respond(exchange, 302, "");
            } else {
                redirectedHeader.set(exchange.getRequestHeaders().getFirst("X-Internal-Service-Key"));
                respond(exchange, 200, "{\"inUse\":false}");
            }
        });

        assertThatThrownBy(() -> client(Duration.ofSeconds(1), Duration.ofSeconds(1), SERVICE_KEY)
                .isInUse(WORKSPACE, CONNECTION_ID))
                .isInstanceOf(DependencyUnavailableException.class);
        assertThat(redirectedHeader).hasValue(null);
    }

    @Test
    void workflowClientTimeoutFailsClosed() throws Exception {
        startServer(exchange -> {
            try {
                Thread.sleep(250);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            respond(exchange, 200, "{\"inUse\":false}");
        });

        assertThatThrownBy(() -> client(Duration.ofSeconds(1), Duration.ofMillis(40), SERVICE_KEY)
                .isInUse(WORKSPACE, CONNECTION_ID))
                .isInstanceOf(DependencyUnavailableException.class);
    }

    @Test
    void partialWorkflowBodyReadIsBoundedAndCannotReachMutation() throws Exception {
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));

        AtomicBoolean releaseBody = new AtomicBoolean();
        startServer(exchange -> {
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, 0);
            try (var output = exchange.getResponseBody()) {
                output.write("{\"inUse\":".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                output.flush();
                while (!releaseBody.get()) {
                    try {
                        Thread.sleep(10);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        });

        var useCase = new UpdateConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                new ConnectionConfigPolicy(),
                new com.weav.workspace.application.service.ConnectionViewAssembler(authorizationPolicy),
                client(Duration.ofSeconds(1), Duration.ofMillis(120), SERVICE_KEY),
                new DirectTransactionRunner());

        long started = System.nanoTime();
        try {
            assertThatThrownBy(() -> useCase.execute(new com.weav.workspace.application.dto.UpdateConnectionCommand(
                    WORKSPACE, MEMBER, CONNECTION_ID, "Should not persist", null)))
                    .isInstanceOf(DependencyUnavailableException.class);
            assertThat((System.nanoTime() - started) / 1_000_000L).isLessThan(2_000L);
            verify(connections, never()).save(any());
        } finally {
            releaseBody.set(true);
            stopServer();
        }
    }

    @Test
    void workflowPropertiesRedactInternalServiceKey() {
        WorkflowServiceProperties properties = new WorkflowServiceProperties(
                URI.create("http://127.0.0.1:8082"),
                Duration.ofSeconds(1),
                Duration.ofSeconds(1),
                SERVICE_KEY);

        assertThat(properties.toString()).doesNotContain(SERVICE_KEY);
    }

    private WorkflowConnectionUsageClient client(
            Duration connectTimeout,
            Duration readTimeout,
            String key) {
        WorkflowServiceProperties properties = new WorkflowServiceProperties(
                URI.create(baseUrl()), connectTimeout, readTimeout, key);
        HttpClient httpClient = HttpClient.newBuilder()
                .connectTimeout(connectTimeout)
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        JdkClientHttpRequestFactory requestFactory = new JdkClientHttpRequestFactory(httpClient);
        requestFactory.setReadTimeout(readTimeout);
        return new WorkflowConnectionUsageClient(
                RestClient.builder().requestFactory(requestFactory).build(),
                properties,
                new ObjectMapper());
    }

    private void startServer(Handler handler) throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> handler.handle(exchange));
        server.start();
    }

    private String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static Connection connection(ConnectionStatus status, UUID createdBy) {
        return connection(status, createdBy, ConnectionAuthType.API_KEY);
    }

    private static Connection connection(
            ConnectionStatus status,
            UUID createdBy,
            ConnectionAuthType authType) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                CONNECTION_ID,
                WORKSPACE,
                createdBy,
                "Connection",
                ConnectionProvider.HTTP,
                authType,
                status,
                Map.of("baseUrl", "https://example.test"),
                null,
                now,
                now);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static final class DirectTransactionRunner implements TransactionRunner {
        @Override
        public <T> T required(Supplier<T> work) {
            return work.get();
        }

        @Override
        public <T> T requiresNew(Supplier<T> work) {
            return work.get();
        }
    }

    private static final class TrackingTransactionRunner implements TransactionRunner {
        private boolean active;

        @Override
        public <T> T required(Supplier<T> work) {
            boolean previous = active;
            active = true;
            try {
                return work.get();
            } finally {
                active = previous;
            }
        }

        @Override
        public <T> T requiresNew(Supplier<T> work) {
            return required(work);
        }

        private boolean active() {
            return active;
        }
    }

    @FunctionalInterface
    private interface Handler {
        void handle(HttpExchange exchange) throws IOException;
    }
}
