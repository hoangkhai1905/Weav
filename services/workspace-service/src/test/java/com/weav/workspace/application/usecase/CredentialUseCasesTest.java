package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.SaveCredentialCommand;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.BadRequestException;
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
import org.mockito.ArgumentCaptor;

import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class CredentialUseCasesTest {

    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OTHER_WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-000000000002");
    private static final UUID OWNER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID CREATOR_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID OTHER_MEMBER_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID CONNECTION_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final String KEY = Base64.getEncoder().encodeToString(new byte[] {
            0, 1, 2, 3, 4, 5, 6, 7,
            8, 9, 10, 11, 12, 13, 14, 15,
            16, 17, 18, 19, 20, 21, 22, 23,
            24, 25, 26, 27, 28, 29, 30, 31});

    private final ConnectionAuthorizationPolicy authorizationPolicy = new ConnectionAuthorizationPolicy();
    private final ConnectionProviderPolicy providerPolicy = new ConnectionProviderPolicy();
    private final CredentialPayloadCodec codec = new CredentialPayloadCodec(
            new tools.jackson.databind.ObjectMapper(), providerPolicy);
    private final CredentialCryptoPort crypto = new AesGcmCredentialCrypto(
            new CredentialEncryptionProperties(KEY, "v1"));
    private final ConnectionViewAssembler viewAssembler = new ConnectionViewAssembler(authorizationPolicy);

    @Test
    void validatesTheManualProviderPayloadMatrixAndRejectsUnsupportedAuth() {
        assertThat(codec.encode(
                ConnectionProvider.TELEGRAM,
                ConnectionAuthType.TOKEN,
                Map.of("token", "telegram-secret"))).isNotEmpty();
        assertThat(codec.encode(
                ConnectionProvider.HTTP,
                ConnectionAuthType.TOKEN,
                Map.of("token", "http-secret"))).isNotEmpty();
        assertThat(codec.encode(
                ConnectionProvider.HTTP,
                ConnectionAuthType.API_KEY,
                Map.of("apiKey", "api-key-secret"))).isNotEmpty();
        assertThat(codec.encode(
                ConnectionProvider.HTTP,
                ConnectionAuthType.BASIC,
                Map.of("username", "basic-user", "password", "basic-password"))).isNotEmpty();

        assertInvalidPayload(ConnectionProvider.GMAIL, ConnectionAuthType.OAUTH2,
                Map.of("token", "oauth-secret"), "oauth-secret");
        assertInvalidPayload(ConnectionProvider.GOOGLE_SHEETS, ConnectionAuthType.OAUTH2,
                Map.of("token", "oauth-secret"), "oauth-secret");
        assertInvalidPayload(ConnectionProvider.HTTP, ConnectionAuthType.NONE,
                Map.of("token", "none-secret"), "none-secret");
        assertInvalidPayload(ConnectionProvider.HTTP, ConnectionAuthType.API_KEY,
                Map.of("apiKey", "api-key-secret", "extra", "extra-secret"), "extra-secret");
        assertInvalidPayload(ConnectionProvider.HTTP, ConnectionAuthType.BASIC,
                Map.of("username", "basic-user", "password", " "), "basic-user");
    }

    @Test
    void ownerAndCreatorCanSaveButOtherMemberAndOtherWorkspaceCannot() {
        Connection connection = connection(WORKSPACE_ID, CREATOR_ID, ConnectionStatus.ACTIVE,
                ConnectionProvider.HTTP, ConnectionAuthType.API_KEY);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(connections.findByWorkspaceIdAndId(WORKSPACE_ID, CONNECTION_ID)).thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());
        when(credentials.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        SaveCredentialUseCase useCase = saveUseCase(connections, memberships, credentials);

        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, OWNER_ID))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE_ID, OWNER_ID)));
        ConnectionResponse ownerResult = useCase.execute(new SaveCredentialCommand(
                WORKSPACE_ID, OWNER_ID, CONNECTION_ID, Map.of("apiKey", "owner-secret"), null));
        assertThat(ownerResult.status()).isEqualTo(ConnectionStatus.DISABLED);

        Connection creatorConnection = connection(WORKSPACE_ID, CREATOR_ID, ConnectionStatus.ACTIVE,
                ConnectionProvider.HTTP, ConnectionAuthType.API_KEY);
        when(connections.findByWorkspaceIdAndId(WORKSPACE_ID, CONNECTION_ID)).thenReturn(Optional.of(creatorConnection));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, CREATOR_ID))
                .thenReturn(Optional.of(Membership.member(WORKSPACE_ID, CREATOR_ID)));
        assertThat(useCase.execute(new SaveCredentialCommand(
                WORKSPACE_ID, CREATOR_ID, CONNECTION_ID, Map.of("apiKey", "creator-secret"), null)).status())
                .isEqualTo(ConnectionStatus.DISABLED);

        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, OTHER_MEMBER_ID))
                .thenReturn(Optional.of(Membership.member(WORKSPACE_ID, OTHER_MEMBER_ID)));
        assertThatThrownBy(() -> useCase.execute(new SaveCredentialCommand(
                WORKSPACE_ID, OTHER_MEMBER_ID, CONNECTION_ID, Map.of("apiKey", "other-secret"), null)))
                .isInstanceOf(ForbiddenException.class)
                .hasMessageNotContaining("other-secret");

        when(memberships.findByWorkspaceIdAndUserId(OTHER_WORKSPACE_ID, OWNER_ID))
                .thenReturn(Optional.of(Membership.owner(OTHER_WORKSPACE_ID, OWNER_ID)));
        when(connections.findByWorkspaceIdAndId(OTHER_WORKSPACE_ID, CONNECTION_ID)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> useCase.execute(new SaveCredentialCommand(
                OTHER_WORKSPACE_ID, OWNER_ID, CONNECTION_ID, Map.of("apiKey", "cross-workspace-secret"), null)))
                .isInstanceOf(ResourceNotFoundException.class)
                .hasMessageNotContaining("cross-workspace-secret");
    }

    @Test
    void replacingCredentialRetainsIdentityEncryptsPayloadAndDisablesConnection() {
        Connection connection = connection(WORKSPACE_ID, CREATOR_ID, ConnectionStatus.ACTIVE,
                ConnectionProvider.HTTP, ConnectionAuthType.API_KEY);
        Instant createdAt = Instant.parse("2026-01-01T00:00:00Z");
        Credential existing = new Credential(
                UUID.fromString("30000000-0000-0000-0000-000000000001"),
                CONNECTION_ID,
                new byte[] {1, 2, 3},
                "old-v1",
                null,
                createdAt,
                createdAt);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, CREATOR_ID))
                .thenReturn(Optional.of(Membership.member(WORKSPACE_ID, CREATOR_ID)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE_ID, CONNECTION_ID)).thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.of(existing));
        when(credentials.save(any())).thenAnswer(invocation -> invocation.getArgument(0));

        SaveCredentialUseCase useCase = saveUseCase(connections, memberships, credentials);
        Instant expiresAt = Instant.parse("2026-12-01T00:00:00Z");
        ConnectionResponse result = useCase.execute(new SaveCredentialCommand(
                WORKSPACE_ID,
                CREATOR_ID,
                CONNECTION_ID,
                Map.of("apiKey", "replacement-secret"),
                expiresAt));

        ArgumentCaptor<Credential> captor = ArgumentCaptor.forClass(Credential.class);
        verify(credentials).save(captor.capture());
        Credential replacement = captor.getValue();
        assertThat(replacement.getId()).isEqualTo(existing.getId());
        assertThat(replacement.getCreatedAt()).isEqualTo(createdAt);
        assertThat(replacement.getExpiresAt()).isEqualTo(expiresAt);
        assertThat(replacement.getEncryptionKeyVersion()).isEqualTo("v1");
        assertThat(crypto.decrypt(replacement.getEncryptedPayload()))
                .contains(new byte[] {'"', 'a', 'p', 'i', 'K', 'e', 'y'});
        assertThat(result.status()).isEqualTo(ConnectionStatus.DISABLED);
        assertThat(result.hasCredential()).isTrue();
        verify(connections).save(connection);
    }

    @Test
    void deleteDisablesConnectionAndIsIdempotentWithoutLeakingCredentialData() {
        Connection connection = connection(WORKSPACE_ID, CREATOR_ID, ConnectionStatus.ACTIVE,
                ConnectionProvider.HTTP, ConnectionAuthType.TOKEN);
        Credential existing = Credential.createNew(
                CONNECTION_ID,
                crypto.encrypt("{\"token\":\"delete-secret\"}".getBytes()),
                "v1",
                null);
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, CREATOR_ID))
                .thenReturn(Optional.of(Membership.member(WORKSPACE_ID, CREATOR_ID)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE_ID, CONNECTION_ID)).thenReturn(Optional.of(connection));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.of(existing), Optional.empty());
        DeleteCredentialUseCase useCase = new DeleteCredentialUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                viewAssembler,
                (workspaceId, connectionId) -> false,
                new DirectTransactionRunner());

        assertThat(useCase.execute(CREATOR_ID, WORKSPACE_ID, CONNECTION_ID).status())
                .isEqualTo(ConnectionStatus.DISABLED);
        assertThat(useCase.execute(CREATOR_ID, WORKSPACE_ID, CONNECTION_ID).hasCredential()).isFalse();
        verify(credentials, times(2)).deleteByConnectionId(CONNECTION_ID);
        verify(connections).save(connection);
        verify(credentials, never()).save(any());
    }

    @Test
    void invalidPayloadFailuresDoNotContainSecretValues() {
        assertThatThrownBy(() -> codec.encode(
                ConnectionProvider.HTTP,
                ConnectionAuthType.TOKEN,
                Map.of("token", "token-secret", "extra", "encrypted-bytes")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageNotContaining("token-secret")
                .hasMessageNotContaining("encrypted-bytes")
                .hasMessageNotContaining("apiKey value")
                .hasMessageNotContaining("password value");
    }

    @Test
    void diagnosticStringsRedactCredentialPayloadAndEncryptionKey() {
        String payloadSecret = "diagnostic-api-key-secret";
        SaveCredentialCommand command = new SaveCredentialCommand(
                WORKSPACE_ID,
                OWNER_ID,
                CONNECTION_ID,
                Map.of("apiKey", payloadSecret),
                null);
        String commandDiagnostics = command.toString();

        assertThat(commandDiagnostics)
                .contains("payload=<redacted>")
                .doesNotContain(payloadSecret);

        String encryptionKey = KEY;
        String propertiesDiagnostics = new CredentialEncryptionProperties(encryptionKey, "v1").toString();
        assertThat(propertiesDiagnostics)
                .contains("encryptionKey=<redacted>")
                .doesNotContain(encryptionKey);
    }

    private SaveCredentialUseCase saveUseCase(
            ConnectionRepository connections,
            MembershipRepository memberships,
            CredentialRepository credentials) {
        return new SaveCredentialUseCase(
                connections,
                memberships,
                credentials,
                authorizationPolicy,
                codec,
                crypto,
                viewAssembler,
                (workspaceId, connectionId) -> false,
                new DirectTransactionRunner());
    }

    private static Connection connection(
            UUID workspaceId,
            UUID createdBy,
            ConnectionStatus status,
            ConnectionProvider provider,
            ConnectionAuthType authType) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                CONNECTION_ID,
                workspaceId,
                createdBy,
                "Credential Connection",
                provider,
                authType,
                status,
                Map.of(),
                null,
                now,
                now);
    }

    private void assertInvalidPayload(
            ConnectionProvider provider,
            ConnectionAuthType authType,
            Map<String, Object> payload,
            String secret) {
        assertThatThrownBy(() -> codec.encode(provider, authType, payload))
                .isInstanceOf(BadRequestException.class)
                .hasMessage("Credential payload is invalid")
                .hasMessageNotContaining(secret);
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
