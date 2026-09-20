package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.CreateConnectionCommand;
import com.weav.workspace.application.dto.UpdateConnectionCommand;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionConfigPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ConnectionNameAlreadyExistsException;
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
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ConnectionUseCasesTest {

    private static final UUID WORKSPACE = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID MEMBER = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID OTHER_MEMBER = UUID.fromString("00000000-0000-0000-0000-000000000003");
    private static final UUID CONNECTION_ID = UUID.fromString("20000000-0000-0000-0000-000000000001");

    private final ConnectionAuthorizationPolicy authorizationPolicy = new ConnectionAuthorizationPolicy();
    private final ConnectionProviderPolicy providerPolicy = new ConnectionProviderPolicy();
    private final ConnectionConfigPolicy configPolicy = new ConnectionConfigPolicy();
    private final ConnectionViewAssembler assembler = new ConnectionViewAssembler(authorizationPolicy);

    @Test
    void createVerifiesMembershipNormalizesNameAndStartsDisabled() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER)).thenReturn(Optional.of(owner));
        when(connections.existsByWorkspaceIdAndNameNormalized(WORKSPACE, "http api", null)).thenReturn(false);
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(any())).thenReturn(Optional.empty());

        ConnectionResponse response = new CreateConnectionUseCase(
                connections, memberships, credentials, providerPolicy, configPolicy, assembler,
                new RecordingTransactionRunner())
                .execute(new CreateConnectionCommand(
                        WORKSPACE, OWNER, "  HTTP\tAPI  ", ConnectionProvider.HTTP,
                        ConnectionAuthType.NONE, Map.of("baseUrl", "https://example.test")));

        assertEquals("HTTP API", response.name());
        assertEquals(ConnectionStatus.DISABLED, response.status());
        assertEquals(Map.of("baseUrl", "https://example.test"), response.config());
        assertTrue(response.canManage());
        assertTrue(response.canAttach());
        verify(connections).save(any(Connection.class));
    }

    @Test
    void createRejectsInvalidProviderAuthAndDuplicateNormalizedName() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));

        CreateConnectionUseCase useCase = new CreateConnectionUseCase(
                connections, memberships, credentials, providerPolicy, configPolicy, assembler,
                new RecordingTransactionRunner());
        assertThrows(BadRequestException.class, () -> useCase.execute(new CreateConnectionCommand(
                WORKSPACE, OWNER, "Gmail", ConnectionProvider.GMAIL, ConnectionAuthType.TOKEN, Map.of())));
        verify(connections, never()).existsByWorkspaceIdAndNameNormalized(any(), any(), any());

        when(connections.existsByWorkspaceIdAndNameNormalized(WORKSPACE, "http api", null)).thenReturn(true);
        assertThrows(ConnectionNameAlreadyExistsException.class, () -> useCase.execute(new CreateConnectionCommand(
                WORKSPACE, OWNER, " HTTP  API ", ConnectionProvider.HTTP, ConnectionAuthType.NONE, Map.of())));
        verify(connections, never()).save(any());
    }

    @Test
    void createRejectsCredentialMaterialInConfigWithoutLeakingValue() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));

        BadRequestException exception = assertThrows(BadRequestException.class, () -> new CreateConnectionUseCase(
                connections, memberships, credentials, providerPolicy, configPolicy, assembler,
                new RecordingTransactionRunner()).execute(new CreateConnectionCommand(
                WORKSPACE, OWNER, "HTTP", ConnectionProvider.HTTP, ConnectionAuthType.API_KEY,
                Map.of("apiKey", "opaque-value"))));

        assertFalse(exception.getMessage().contains("opaque-value"));
        verify(connections, never()).save(any());
    }

    @Test
    void createRejectsHeaderAndUrlCredentialMaterialWithoutSaving() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));

        List<Map<String, Object>> invalidConfigs = List.of(
                Map.of("headers", Map.of("Authorization", "Bearer fixture-value")),
                Map.of("request", Map.of("headers", List.of(
                        Map.of("name", "Cookie", "value", "fixture-cookie")))),
                Map.of("baseUrl", "https://user:fixture-password@example.test"));

        CreateConnectionUseCase useCase = new CreateConnectionUseCase(
                connections, memberships, credentials, providerPolicy, configPolicy, assembler,
                new RecordingTransactionRunner());
        for (Map<String, Object> invalidConfig : invalidConfigs) {
            BadRequestException exception = assertThrows(BadRequestException.class, () -> useCase.execute(
                    new CreateConnectionCommand(
                            WORKSPACE, OWNER, "HTTP", ConnectionProvider.HTTP,
                            ConnectionAuthType.NONE, invalidConfig)));
            assertFalse(exception.getMessage().contains("fixture"));
        }

        verify(connections, never()).save(any());
        verify(connections, never()).existsByWorkspaceIdAndNameNormalized(any(), any(), any());
    }

    @Test
    void getAndListHideConfigFromOtherMemberButKeepCredentialMetadata() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Connection connection = connection(ConnectionStatus.ACTIVE, OWNER, Map.of("baseUrl", "https://example.test"));
        Membership otherMember = Membership.member(WORKSPACE, OTHER_MEMBER);
        Credential credential = Credential.createNew(
                CONNECTION_ID, new byte[] {1, 2, 3}, "key-v1", Instant.parse("2026-10-01T00:00:00Z"));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OTHER_MEMBER))
                .thenReturn(Optional.of(otherMember));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(connection));
        when(connections.findAllByWorkspaceId(WORKSPACE)).thenReturn(List.of(connection));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.of(credential));

        GetConnectionUseCase get = new GetConnectionUseCase(
                connections, memberships, credentials, assembler, new RecordingTransactionRunner());
        ListConnectionsUseCase list = new ListConnectionsUseCase(
                connections, memberships, credentials, assembler, new RecordingTransactionRunner());

        ConnectionResponse single = get.execute(OTHER_MEMBER, WORKSPACE, CONNECTION_ID);
        ConnectionResponse listed = list.execute(OTHER_MEMBER, WORKSPACE).getFirst();

        assertNull(single.config());
        assertFalse(single.canManage());
        assertFalse(single.canAttach());
        assertTrue(single.hasCredential());
        assertEquals(credential.getExpiresAt(), single.credentialExpiresAt());
        assertNull(listed.config());
        assertFalse(List.of(ConnectionResponse.class.getRecordComponents()).stream()
                .map(RecordComponent::getName)
                .anyMatch(name -> name.equals("credentialId")
                        || name.equals("encryptedPayload")
                        || name.equals("encryptionKeyVersion")));
    }

    @Test
    void nonMemberUsesWorkspaceNotFoundSemantics() {
        MembershipRepository memberships = mock(MembershipRepository.class);
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OTHER_MEMBER)).thenReturn(Optional.empty());
        ResourceNotFoundException exception = assertThrows(ResourceNotFoundException.class, () -> new GetConnectionUseCase(
                mock(ConnectionRepository.class), memberships, mock(CredentialRepository.class), assembler,
                new RecordingTransactionRunner()).execute(OTHER_MEMBER, WORKSPACE, CONNECTION_ID));
        assertTrue(exception.getMessage().contains("Workspace not found"));
    }

    @Test
    void ownerCanUpdateAnyConnectionAndConfigChangeDisablesIt() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER, Map.of("baseUrl", "https://old.test"));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE, OWNER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(connection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        ConnectionResponse response = new UpdateConnectionUseCase(
                connections, memberships, credentials, authorizationPolicy, configPolicy, assembler,
                (workspaceId, connectionId) -> false,
                new RecordingTransactionRunner()).execute(new UpdateConnectionCommand(
                WORKSPACE, OWNER, CONNECTION_ID, null, Map.of("baseUrl", "https://new.test")));

        assertEquals(ConnectionStatus.DISABLED, response.status());
        assertEquals(Map.of("baseUrl", "https://new.test"), response.config());
        assertTrue(response.canManage());
        verify(connections).save(connection);
    }

    @Test
    void nameOnlyUpdatePreservesActiveStatusAndProviderAuthAreNotUpdateFields() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER, Map.of("baseUrl", "https://example.test"));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(connection));
        when(connections.existsByWorkspaceIdAndNameNormalized(WORKSPACE, "renamed", CONNECTION_ID))
                .thenReturn(false);
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        ConnectionResponse response = new UpdateConnectionUseCase(
                connections, memberships, credentials, authorizationPolicy, configPolicy, assembler,
                (workspaceId, connectionId) -> false,
                new RecordingTransactionRunner()).execute(new UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Renamed", null));

        assertEquals(ConnectionStatus.ACTIVE, response.status());
        assertEquals("Renamed", response.name());
        assertEquals(ConnectionProvider.HTTP, response.provider());
        assertEquals(ConnectionAuthType.NONE, response.authType());
        assertTrue(response.canManage());
    }

    @Test
    void memberCanUpdateOwnButCannotUpdateAnotherMembersConnection() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Connection otherConnection = connection(ConnectionStatus.ACTIVE, OWNER, Map.of());
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(otherConnection));

        UpdateConnectionUseCase useCase = new UpdateConnectionUseCase(
                connections, memberships, credentials, authorizationPolicy, configPolicy, assembler,
                (workspaceId, connectionId) -> false,
                new RecordingTransactionRunner());
        assertThrows(ForbiddenException.class, () -> useCase.execute(new UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Nope", null)));
        verify(connections, never()).save(any());

        Connection ownConnection = connection(ConnectionStatus.ACTIVE, MEMBER, Map.of());
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(ownConnection));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());
        ConnectionResponse response = useCase.execute(new UpdateConnectionCommand(
                WORKSPACE, MEMBER, CONNECTION_ID, "Own", null));
        assertTrue(response.canManage());
    }

    @Test
    void rejectedConfigUpdateDoesNotMutateOrSaveConnection() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Connection connection = connection(ConnectionStatus.ACTIVE, MEMBER,
                Map.of("baseUrl", "https://example.test"));
        Instant originalUpdatedAt = connection.getUpdatedAt();
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE, MEMBER)));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID))
                .thenReturn(Optional.of(connection));

        UpdateConnectionUseCase useCase = new UpdateConnectionUseCase(
                connections, memberships, credentials, authorizationPolicy, configPolicy, assembler,
                (workspaceId, connectionId) -> false,
                new RecordingTransactionRunner());
        List<Map<String, Object>> invalidConfigs = List.of(
                Map.of("headers", Map.of("Authorization", "Bearer fixture-update-value")),
                Map.of("nested", Map.of("headers", List.of(
                        Map.of("headerName", "Cookie", "value", "fixture-update-cookie")))),
                Map.of("baseUrl", "https://user:fixture-update-password@example.test"));
        for (Map<String, Object> invalidConfig : invalidConfigs) {
            BadRequestException exception = assertThrows(BadRequestException.class, () -> useCase.execute(
                    new UpdateConnectionCommand(
                            WORKSPACE, MEMBER, CONNECTION_ID, null, invalidConfig)));
            assertFalse(exception.getMessage().contains("fixture-update"));
        }

        assertEquals("Connection", connection.getName());
        assertEquals(ConnectionStatus.ACTIVE, connection.getStatus());
        assertEquals(Map.of("baseUrl", "https://example.test"), connection.getConfig());
        assertEquals(originalUpdatedAt, connection.getUpdatedAt());
        verify(connections, never()).save(any());
    }

    @Test
    void disableIsAuthorizedAndIdempotent() {
        ConnectionRepository connections = mock(ConnectionRepository.class);
        MembershipRepository memberships = mock(MembershipRepository.class);
        CredentialRepository credentials = mock(CredentialRepository.class);
        Membership owner = Membership.owner(WORKSPACE, OWNER);
        Connection active = connection(ConnectionStatus.ACTIVE, MEMBER, Map.of());
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE, OWNER)).thenReturn(Optional.of(owner));
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(active));
        when(connections.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(credentials.findByConnectionId(CONNECTION_ID)).thenReturn(Optional.empty());

        DisableConnectionUseCase useCase = new DisableConnectionUseCase(
                connections, memberships, credentials, authorizationPolicy, assembler,
                (workspaceId, connectionId) -> false,
                new RecordingTransactionRunner());
        assertEquals(ConnectionStatus.DISABLED, useCase.execute(OWNER, WORKSPACE, CONNECTION_ID).status());
        verify(connections).save(active);

        Connection disabled = connection(ConnectionStatus.DISABLED, MEMBER, Map.of());
        when(connections.findByWorkspaceIdAndId(WORKSPACE, CONNECTION_ID)).thenReturn(Optional.of(disabled));
        assertEquals(ConnectionStatus.DISABLED, useCase.execute(OWNER, WORKSPACE, CONNECTION_ID).status());
        verify(connections, org.mockito.Mockito.times(1)).save(active);
    }

    private static Connection connection(
            ConnectionStatus status,
            UUID createdBy,
            Map<String, Object> config) {
        Instant now = Instant.parse("2026-01-01T00:00:00Z");
        return new Connection(
                CONNECTION_ID,
                WORKSPACE,
                createdBy,
                "Connection",
                ConnectionProvider.HTTP,
                ConnectionAuthType.NONE,
                status,
                config,
                Instant.parse("2025-12-01T00:00:00Z"),
                now,
                now);
    }

    private static final class RecordingTransactionRunner implements TransactionRunner {
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
