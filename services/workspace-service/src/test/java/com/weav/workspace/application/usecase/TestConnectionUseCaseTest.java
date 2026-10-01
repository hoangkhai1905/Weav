package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.notification.WorkspaceNotificationEvent;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.NotificationOutboxPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
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
import com.weav.workspace.infrastructure.config.CredentialEncryptionProperties;
import com.weav.workspace.infrastructure.credential.AesGcmCredentialCrypto;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.Clock;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

class TestConnectionUseCaseTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID OWNER = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER = UUID.fromString("20000000-0000-0000-0000-000000000002");
    private static final UUID CONNECTION_ID = UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final String KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";

    private final ConnectionAuthorizationPolicy authorizationPolicy = new ConnectionAuthorizationPolicy();
    private final ConnectionProviderPolicy providerPolicy = new ConnectionProviderPolicy();
    private final CredentialPayloadCodec codec = new CredentialPayloadCodec(
            new tools.jackson.databind.ObjectMapper(), providerPolicy);
    private final DirectTransactionRunner runner = new DirectTransactionRunner();
    private final CredentialCryptoPort crypto = new AesGcmCredentialCrypto(
            new CredentialEncryptionProperties(KEY, "v1"));

    @Test
    void verifiedOutcomeMarksDisabledConnectionActive() {
        Connection connection = connection(ConnectionStatus.DISABLED, ConnectionAuthType.NONE);
        RecordingProvider provider = provider(ConnectionTestResult.verified(), null);
        TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));

        ConnectionTestResult result = fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, result.outcome());
        assertEquals(ConnectionStatus.ACTIVE, connection.getStatus());
        assertTrue(connection.getLastVerifiedAt() != null);
        verify(fixtures.connections()).save(connection);
        assertEquals("connection.connected", fixtures.outbox().events.getFirst().eventType());
        assertEquals(OWNER, fixtures.outbox().events.getFirst().actorUserId());
        assertEquals(List.of(OWNER), fixtures.outbox().events.getFirst().recipientUserIds());
    }

    @Test
    void authInvalidOutcomeMarksActiveConnectionInvalid() {
        Connection connection = connection(ConnectionStatus.ACTIVE, ConnectionAuthType.NONE);
        RecordingProvider provider = provider(ConnectionTestResult.authInvalid(), null);
        TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));

        ConnectionTestResult result = fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, result.outcome());
        assertEquals(ConnectionStatus.INVALID, connection.getStatus());
        verify(fixtures.connections()).save(connection);
        assertEquals("connection.invalid", fixtures.outbox().events.getFirst().eventType());
        assertEquals(OWNER, fixtures.outbox().events.getFirst().actorUserId());
        assertEquals(List.of(OWNER), fixtures.outbox().events.getFirst().recipientUserIds());
    }

    @Test
    void dependencyFailurePreservesDisabledAndActiveState() {
        for (ConnectionStatus status : new ConnectionStatus[] {
                ConnectionStatus.DISABLED, ConnectionStatus.ACTIVE}) {
            Connection connection = connection(status, ConnectionAuthType.NONE);
            RecordingProvider provider = provider(ConnectionTestResult.dependencyFailure(), null);
            TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));

            assertThrows(DependencyUnavailableException.class,
                    () -> fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID));

            assertEquals(status, connection.getStatus());
            assertEquals(1, provider.testCalls);
            verify(fixtures.connections(), never()).save(any());
        }
    }

    @Test
    void decryptsAndStrictlyDecodesOnlyWhenCredentialIsRequired() {
        Connection connection = connection(ConnectionStatus.DISABLED, ConnectionAuthType.TOKEN);
        AtomicReference<Map<String, Object>> received = new AtomicReference<>();
        RecordingProvider provider = provider(ConnectionTestResult.verified(), received);
        TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));
        byte[] encrypted = crypto.encrypt(codec.encode(connection, Map.of("token", "synthetic-token")));
        when(fixtures.credentials().findByConnectionId(CONNECTION_ID)).thenReturn(Optional.of(
                Credential.createNew(CONNECTION_ID, encrypted, "v1", null)));

        ConnectionTestResult result = fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);

        assertEquals(ConnectionTestResult.ConnectionTestOutcome.VERIFIED, result.outcome());
        assertEquals(Map.of("token", "synthetic-token"), received.get());
        verify(fixtures.credentials(), org.mockito.Mockito.times(2)).findByConnectionId(CONNECTION_ID); // phase 1 + phase 3 re-check
    }

    @Test
    void credentialDecodeRejectsTrailingJsonAndUnexpectedFields() {
        Connection connection = connection(ConnectionStatus.DISABLED, ConnectionAuthType.TOKEN);

        assertThrows(BadRequestException.class, () -> codec.decode(
                connection,
                "{\"token\":\"synthetic-token\"}{\"extra\":\"value\"}"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        assertThrows(BadRequestException.class, () -> codec.decode(
                connection,
                "{\"token\":\"synthetic-token\",\"extra\":\"value\"}"
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    @Test
    void missingOrCorruptCredentialFailsClosedAsInvalidWithoutCallingProvider() {
        for (byte[] encrypted : new byte[][] {null, new byte[] {1, 2, 3}}) {
            Connection connection = connection(ConnectionStatus.ACTIVE, ConnectionAuthType.TOKEN);
            RecordingProvider provider = provider(ConnectionTestResult.verified(), null);
            TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));
            when(fixtures.credentials().findByConnectionId(CONNECTION_ID)).thenReturn(
                    encrypted == null
                            ? Optional.empty()
                            : Optional.of(Credential.createNew(CONNECTION_ID, encrypted, "v1", null)));

            ConnectionTestResult result = fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);

            assertEquals(ConnectionTestResult.ConnectionTestOutcome.AUTH_INVALID, result.outcome());
            assertEquals(ConnectionStatus.INVALID, connection.getStatus());
            assertEquals(0, provider.testCalls);
            verify(fixtures.connections()).save(connection);
            assertEquals(List.of("connection.invalid"), fixtures.outbox().events.stream()
                    .map(WorkspaceNotificationEvent::eventType).toList());
        }
    }

    @Test
    void providerIsCalledWithoutTransactionOrWorkspaceLock() {
        Connection connection = connection(ConnectionStatus.DISABLED, ConnectionAuthType.NONE);
        RecordingProvider provider = provider(ConnectionTestResult.verified(), null);
        List<String> seen = new ArrayList<>();
        provider.onTest = () -> seen.add(runner.depth + "/" + runner.lockTaken);
        TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));

        fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);

        assertEquals(List.of("0/false"), seen);
        assertEquals(ConnectionStatus.ACTIVE, connection.getStatus());
    }

    @Test
    void connectionChangedDuringProviderCallIsNotOverwritten() {
        Connection connection = connection(ConnectionStatus.DISABLED, ConnectionAuthType.NONE);
        RecordingProvider provider = provider(ConnectionTestResult.verified(), null);
        provider.onTest = () -> connection.updateConfig(Map.of("baseUrl", "https://other.example.test"));
        TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));

        assertThrows(com.weav.workspace.domain.exception.ConflictException.class,
                () -> fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID));

        assertEquals(ConnectionStatus.DISABLED, connection.getStatus());
        verify(fixtures.connections(), never()).save(any());
        assertEquals(List.of(), fixtures.outbox().events);
    }

    @Test
    void credentialReplacedDuringProviderCallIsNotOverwritten() {
        Connection connection = connection(ConnectionStatus.ACTIVE, ConnectionAuthType.TOKEN);
        RecordingProvider provider = provider(ConnectionTestResult.authInvalid(), null);
        TestFixtures fixtures = fixtures(connection, provider, Membership.owner(WORKSPACE, OWNER));
        byte[] encrypted = crypto.encrypt(codec.encode(connection, Map.of("token", "old")));
        when(fixtures.credentials().findByConnectionId(CONNECTION_ID)).thenReturn(Optional.of(
                Credential.createNew(CONNECTION_ID, encrypted, "v1", null)));
        provider.onTest = () -> when(fixtures.credentials().findByConnectionId(CONNECTION_ID))
                .thenReturn(Optional.of(Credential.createNew(CONNECTION_ID, encrypted, "v1", null)));

        assertThrows(com.weav.workspace.domain.exception.ConflictException.class,
                () -> fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID));

        assertEquals(ConnectionStatus.ACTIVE, connection.getStatus());
        verify(fixtures.connections(), never()).save(any());
    }

    @Test
    void alreadyActiveAndAlreadyInvalidOutcomesDoNotCreateDuplicateEvents() {
        TestFixtures activeFixtures = fixtures(
                connection(ConnectionStatus.ACTIVE, ConnectionAuthType.NONE),
                provider(ConnectionTestResult.verified(), null),
                Membership.owner(WORKSPACE, OWNER));
        activeFixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);
        assertEquals(List.of(), activeFixtures.outbox().events);

        TestFixtures invalidFixtures = fixtures(
                connection(ConnectionStatus.INVALID, ConnectionAuthType.NONE),
                provider(ConnectionTestResult.authInvalid(), null),
                Membership.owner(WORKSPACE, OWNER));
        invalidFixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID);
        assertEquals(List.of(), invalidFixtures.outbox().events);
    }

    @Test
    void authorizationIsWorkspaceScopedAndUsageCheckRemainsDeferred() {
        Connection connection = connection(ConnectionStatus.DISABLED, ConnectionAuthType.NONE);
        RecordingProvider provider = provider(ConnectionTestResult.verified(), null);
        TestFixtures fixtures = fixtures(connection, provider, Membership.member(WORKSPACE, MEMBER));

        assertThrows(ForbiddenException.class,
                () -> fixtures.useCase().execute(MEMBER, WORKSPACE, CONNECTION_ID));
        assertThrows(ResourceNotFoundException.class,
                () -> fixtures.useCase().execute(OWNER, OTHER_WORKSPACE, CONNECTION_ID));
        assertEquals(0, provider.testCalls);
        verify(fixtures.connections(), never()).save(any());
    }

    @Test
    void unsupportedProviderIsRejectedByStaticRegistry() {
        Connection connection = new Connection(
                CONNECTION_ID,
                WORKSPACE,
                OWNER,
                "Google fixture",
                ConnectionProvider.GMAIL,
                ConnectionAuthType.OAUTH2,
                ConnectionStatus.DISABLED,
                Map.of(),
                null,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z"));
        RecordingProvider http = provider(ConnectionTestResult.verified(), null);
        TestFixtures fixtures = fixtures(connection, http, Membership.owner(WORKSPACE, OWNER));

        assertThrows(BadRequestException.class,
                () -> fixtures.useCase().execute(OWNER, WORKSPACE, CONNECTION_ID));
    }

    private TestFixtures fixtures(
            Connection connection,
            RecordingProvider provider,
            Membership membership) {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        WorkspaceRepository workspaces = mock(WorkspaceRepository.class);
        when(workspaces.findById(WORKSPACE)).thenReturn(Optional.of(new Workspace(
                WORKSPACE,
                "Test workspace",
                OWNER,
                Instant.parse("2026-01-01T00:00:00Z"),
                Instant.parse("2026-01-01T00:00:00Z"))));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(memberships.findByWorkspaceIdAndUserId(membership.getWorkspaceId(), membership.getUserId()))
                .thenReturn(Optional.of(membership));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        RecordingOutbox outbox = new RecordingOutbox();
        ConnectionNotificationRecorder recorder = new ConnectionNotificationRecorder(
                outbox,
                workspaces,
                memberships,
                authorizationPolicy,
                Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC));
        ConnectionProviderRegistry registry = new ConnectionProviderRegistry(provider);
        TestConnectionUseCase useCase = new TestConnectionUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                registry,
                codec,
                crypto,
                (workspaceId, connectionId) -> false,
                runner,
                workspaceId -> runner.lockTaken = true,
                recorder);
        return new TestFixtures(useCase, connections, credentials, provider, outbox);
    }

    private RecordingProvider provider(
            ConnectionTestResult result,
            AtomicReference<Map<String, Object>> received) {
        return new RecordingProvider(result, received);
    }

    private Connection connection(ConnectionStatus status, ConnectionAuthType authType) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                CONNECTION_ID,
                WORKSPACE,
                OWNER,
                "HTTP test",
                ConnectionProvider.HTTP,
                authType,
                status,
                Map.of("baseUrl", "https://api.example.test"),
                null,
                now,
                now);
    }

    private record TestFixtures(
            TestConnectionUseCase useCase,
            ConnectionRepository connections,
            CredentialRepository credentials,
            RecordingProvider provider,
            RecordingOutbox outbox) {
    }

    private static final class RecordingOutbox implements NotificationOutboxPort {
        private final List<WorkspaceNotificationEvent> events = new ArrayList<>();

        @Override
        public void append(WorkspaceNotificationEvent event) {
            events.add(event);
        }
    }

    private static final class RecordingProvider implements ConnectionProviderPort {

        private final ConnectionTestResult result;
        private final AtomicReference<Map<String, Object>> received;
        private int testCalls;
        private Runnable onTest = () -> { };

        private RecordingProvider(
                ConnectionTestResult result,
                AtomicReference<Map<String, Object>> received) {
            this.result = result;
            this.received = received;
        }

        @Override
        public ConnectionProvider provider() {
            return ConnectionProvider.HTTP;
        }

        @Override
        public void validateConfig(ConnectionAuthType authType, Map<String, Object> config) {
        }

        @Override
        public ConnectionTestResult test(
                Connection connection,
                Map<String, Object> decryptedCredential) {
            testCalls++;
            onTest.run();
            if (received != null) {
                received.set(decryptedCredential);
            }
            return result;
        }
    }

    private static final class DirectTransactionRunner implements TransactionRunner {
        private int depth;
        private boolean lockTaken;

        @Override
        public <T> T required(Supplier<T> work) {
            depth++;
            try {
                return work.get();
            } finally {
                if (--depth == 0) {
                    lockTaken = false;
                }
            }
        }

        @Override
        public <T> T requiresNew(Supplier<T> work) {
            return required(work);
        }
    }
}
