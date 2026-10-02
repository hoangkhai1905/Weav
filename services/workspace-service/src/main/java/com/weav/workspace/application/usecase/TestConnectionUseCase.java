package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.notification.ConnectionNotificationRecorder;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.ConflictException;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Workspace-scoped provider verification flow.
 *
 * <p>MEMBER state changes are protected by the Workflow usage contract before
 * provider verification. Provider dependency failures never mutate state.</p>
 */
@Service
public final class TestConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionAuthorizationPolicy authorizationPolicy;
    private final ConnectionProviderRegistry providerRegistry;
    private final CredentialPayloadCodec payloadCodec;
    private final CredentialCryptoPort crypto;
    private final ConnectionUsageProtection usageProtection;
    private final ConnectionNotificationRecorder notificationRecorder;
    private final TransactionRunner transactionRunner;

    @Autowired
    public TestConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionProviderRegistry providerRegistry,
            CredentialPayloadCodec payloadCodec,
            CredentialCryptoPort crypto,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock workspaceMutationLock,
            ConnectionNotificationRecorder notificationRecorder) {
        this(
                connectionRepository,
                membershipRepository,
                credentialRepository,
                authorizationPolicy,
                providerRegistry,
                payloadCodec,
                crypto,
                new ConnectionUsageProtection(
                        connectionRepository,
                        membershipRepository,
                        authorizationPolicy,
                        workflowConnectionUsagePort,
                        transactionRunner,
                        workspaceMutationLock),
                notificationRecorder,
                transactionRunner);
    }

    private TestConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionProviderRegistry providerRegistry,
            CredentialPayloadCodec payloadCodec,
            CredentialCryptoPort crypto,
            ConnectionUsageProtection usageProtection,
            ConnectionNotificationRecorder notificationRecorder,
            TransactionRunner transactionRunner) {
        this.transactionRunner = Objects.requireNonNull(
                transactionRunner, "transactionRunner must not be null");
        this.connectionRepository = Objects.requireNonNull(
                connectionRepository, "connectionRepository must not be null");
        this.membershipRepository = Objects.requireNonNull(
                membershipRepository, "membershipRepository must not be null");
        this.credentialRepository = Objects.requireNonNull(
                credentialRepository, "credentialRepository must not be null");
        this.authorizationPolicy = Objects.requireNonNull(
                authorizationPolicy, "authorizationPolicy must not be null");
        this.providerRegistry = Objects.requireNonNull(
                providerRegistry, "providerRegistry must not be null");
        this.payloadCodec = Objects.requireNonNull(payloadCodec, "payloadCodec must not be null");
        this.crypto = Objects.requireNonNull(crypto, "crypto must not be null");
        this.usageProtection = Objects.requireNonNull(
                usageProtection, "usageProtection must not be null");
        this.notificationRecorder = Objects.requireNonNull(notificationRecorder, "notificationRecorder must not be null");
    }

    public ConnectionTestResult execute(
            UUID actorUserId,
            UUID workspaceId,
            UUID connectionId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        ConnectionUsageProtection.Authorization authorization = usageProtection.authorize(
                actorUserId, workspaceId, connectionId);
        usageProtection.requireUnused(authorization, ConnectionUsageProtection.UsageScope.MEMBER_ONLY);
        // Phase 1: short read transaction. Snapshot what the provider needs plus
        // a staleness marker; no workspace lock is taken.
        Prepared prepared = transactionRunner.required(() -> prepare(workspaceId, connectionId));

        // Phase 2: provider I/O with no transaction, no DB connection, no lock.
        ConnectionTestResult result = null; // null = stored credential unusable, no provider call
        if (prepared.credential() != null) {
            result = prepared.provider().test(prepared.connection(), prepared.credential());
            if (result == null || result.outcome() == null
                    || result.outcome() == ConnectionTestResult.ConnectionTestOutcome.DEPENDENCY_FAILURE) {
                throw new DependencyUnavailableException();
            }
        }

        // Phase 3: short write transaction under the workspace lock. If the
        // connection or its credential changed since phase 1 the verdict is
        // stale and is not written (409) instead of overwriting newer state.
        ConnectionTestResult outcome = result;
        return usageProtection.reauthorizeAndMutate(
                actorUserId,
                workspaceId,
                connectionId,
                authorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, connection) -> {
                    if (!prepared.marker().equals(marker(connection, storedCredential(connection)))) {
                        throw new ConflictException("Connection changed while it was being tested");
                    }
                    return apply(actorUserId, connection, outcome);
                });
    }

    private Prepared prepare(UUID workspaceId, UUID connectionId) {
        Connection connection = connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found", connectionId));
        ConnectionProviderPort provider = providerRegistry.resolve(connection.getProvider());
        provider.validateConfig(connection.getAuthType(), connection.getConfig());
        Credential stored = storedCredential(connection);
        Marker marker = marker(connection, stored);
        try {
            return new Prepared(connection, provider, decryptCredential(connection, stored), marker);
        } catch (InvalidStoredCredentialException exception) {
            return new Prepared(connection, provider, null, marker);
        }
    }

    private Credential storedCredential(Connection connection) {
        return connection.getAuthType() == ConnectionAuthType.NONE ? null
                : credentialRepository.findByConnectionId(connection.getId()).orElse(null);
    }

    // Staleness = what the provider call depends on (auth type, config, credential).
    // Status/updatedAt are excluded so concurrent test runs still both apply.
    private Marker marker(Connection connection, Credential stored) {
        return new Marker(connection.getAuthType(), connection.getConfig(),
                stored == null ? null : stored.getId(),
                stored == null ? null : stored.getUpdatedAt());
    }

    private record Marker(ConnectionAuthType authType, Map<String, Object> config,
                          UUID credentialId, Instant credentialUpdatedAt) {
    }

    private record Prepared(Connection connection, ConnectionProviderPort provider,
                            Map<String, Object> credential, Marker marker) {
    }

    private ConnectionTestResult apply(UUID actorUserId, Connection connection, ConnectionTestResult result) {
        if (result == null) {
            markInvalid(connection, actorUserId);
            return ConnectionTestResult.authInvalid();
        }
        return switch (result.outcome()) {
            case VERIFIED -> {
                boolean newlyConnected = connection.getStatus()
                        != com.weav.workspace.domain.valueobject.ConnectionStatus.ACTIVE;
                connection.markVerified(Instant.now());
                connectionRepository.save(connection);
                if (newlyConnected) {
                    notificationRecorder.recordConnected(connection, actorUserId);
                }
                yield result;
            }
            case AUTH_INVALID -> {
                markInvalid(connection, actorUserId);
                yield result;
            }
            case DEPENDENCY_FAILURE -> throw new DependencyUnavailableException();
        };
    }

    private Map<String, Object> decryptCredential(Connection connection, Credential stored) {
        if (connection.getAuthType() == ConnectionAuthType.NONE) {
            return Map.of();
        }

        if (stored == null) {
            throw new InvalidStoredCredentialException();
        }
        try {
            byte[] plaintext = crypto.decrypt(stored.getEncryptedPayload(), stored.getEncryptionKeyVersion(), connection.getId());
            return payloadCodec.decode(connection, plaintext);
        } catch (RuntimeException exception) {
            // Missing/corrupt credentials fail closed as a confirmed invalid
            // local credential. The original exception may contain provider
            // or crypto diagnostics, so it never leaves this boundary.
            throw new InvalidStoredCredentialException();
        }
    }

    private void markInvalid(Connection connection, UUID actorUserId) {
        if (connection.getStatus() != com.weav.workspace.domain.valueobject.ConnectionStatus.INVALID) {
            connection.markInvalid();
            connectionRepository.save(connection);
            notificationRecorder.recordInvalid(connection, actorUserId);
        }
    }

    private static final class InvalidStoredCredentialException extends RuntimeException {
    }
}
