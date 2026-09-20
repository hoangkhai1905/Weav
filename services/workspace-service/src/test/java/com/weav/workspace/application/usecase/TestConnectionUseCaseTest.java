package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
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
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import com.weav.workspace.infrastructure.config.CredentialEncryptionProperties;
import com.weav.workspace.infrastructure.credential.AesGcmCredentialCrypto;
import org.junit.jupiter.api.Test;

import java.time.Instant;
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
        verify(fixtures.credentials()).findByConnectionId(CONNECTION_ID);
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
        }
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
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));
        when(memberships.findByWorkspaceIdAndUserId(membership.getWorkspaceId(), membership.getUserId()))
                .thenReturn(Optional.of(membership));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
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
                new DirectTransactionRunner());
        return new TestFixtures(useCase, connections, credentials, provider);
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
            RecordingProvider provider) {
    }

    private static final class RecordingProvider implements ConnectionProviderPort {

        private final ConnectionTestResult result;
        private final AtomicReference<Map<String, Object>> received;
        private int testCalls;

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
            if (received != null) {
                received.set(decryptedCredential);
            }
            return result;
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
}
