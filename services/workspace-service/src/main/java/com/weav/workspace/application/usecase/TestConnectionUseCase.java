package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionTestResult;
import com.weav.workspace.application.port.out.ConnectionProviderPort;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionProviderRegistry;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.CredentialPayloadCodec;
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
            TransactionRunner transactionRunner) {
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
                        transactionRunner));
    }

    private TestConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionProviderRegistry providerRegistry,
            CredentialPayloadCodec payloadCodec,
            CredentialCryptoPort crypto,
            ConnectionUsageProtection usageProtection) {
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
        return usageProtection.reauthorizeAndMutate(
                actorUserId,
                workspaceId,
                connectionId,
                authorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, connection) -> testInTransaction(membership, connection));
    }

    private ConnectionTestResult testInTransaction(
            Membership membership,
            Connection connection) {

        ConnectionProviderPort provider = providerRegistry.resolve(connection.getProvider());
        provider.validateConfig(connection.getAuthType(), connection.getConfig());
        final Map<String, Object> credential;
        try {
            credential = decryptCredential(connection);
        } catch (InvalidStoredCredentialException exception) {
            markInvalid(connection);
            return ConnectionTestResult.authInvalid();
        }
        ConnectionTestResult result = provider.test(connection, credential);
        if (result == null || result.outcome() == null) {
            throw new DependencyUnavailableException();
        }

        return switch (result.outcome()) {
            case VERIFIED -> {
                connection.markVerified(Instant.now());
                connectionRepository.save(connection);
                yield result;
            }
            case AUTH_INVALID -> {
                connection.markInvalid();
                connectionRepository.save(connection);
                yield result;
            }
            case DEPENDENCY_FAILURE -> throw new DependencyUnavailableException();
        };
    }

    private Map<String, Object> decryptCredential(Connection connection) {
        if (connection.getAuthType() == ConnectionAuthType.NONE) {
            return Map.of();
        }

        Credential stored = credentialRepository.findByConnectionId(connection.getId()).orElse(null);
        if (stored == null) {
            throw new InvalidStoredCredentialException();
        }
        try {
            byte[] plaintext = crypto.decrypt(stored.getEncryptedPayload());
            return payloadCodec.decode(connection, plaintext);
        } catch (RuntimeException exception) {
            // Missing/corrupt credentials fail closed as a confirmed invalid
            // local credential. The original exception may contain provider
            // or crypto diagnostics, so it never leaves this boundary.
            throw new InvalidStoredCredentialException();
        }
    }

    private void markInvalid(Connection connection) {
        connection.markInvalid();
        connectionRepository.save(connection);
    }

    private static final class InvalidStoredCredentialException extends RuntimeException {
    }
}
