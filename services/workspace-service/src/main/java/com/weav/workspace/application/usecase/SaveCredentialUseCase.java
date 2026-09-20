package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.SaveCredentialCommand;
import com.weav.workspace.application.port.out.CredentialCryptoPort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.CredentialPayloadCodec;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.valueobject.ConnectionStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

@Service
public final class SaveCredentialUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionAuthorizationPolicy authorizationPolicy;
    private final CredentialPayloadCodec payloadCodec;
    private final CredentialCryptoPort crypto;
    private final ConnectionViewAssembler viewAssembler;
    private final ConnectionUsageProtection usageProtection;

    @Autowired
    public SaveCredentialUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            CredentialPayloadCodec payloadCodec,
            CredentialCryptoPort crypto,
            ConnectionViewAssembler viewAssembler,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner) {
        this(
                connectionRepository,
                membershipRepository,
                credentialRepository,
                authorizationPolicy,
                payloadCodec,
                crypto,
                viewAssembler,
                new ConnectionUsageProtection(
                        connectionRepository,
                        membershipRepository,
                        authorizationPolicy,
                        workflowConnectionUsagePort,
                        transactionRunner));
    }

    private SaveCredentialUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            CredentialPayloadCodec payloadCodec,
            CredentialCryptoPort crypto,
            ConnectionViewAssembler viewAssembler,
            ConnectionUsageProtection usageProtection) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
        this.payloadCodec = Objects.requireNonNull(payloadCodec);
        this.crypto = Objects.requireNonNull(crypto);
        this.viewAssembler = Objects.requireNonNull(viewAssembler);
        this.usageProtection = Objects.requireNonNull(usageProtection);
    }

    public ConnectionResponse execute(SaveCredentialCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        ConnectionUsageProtection.Authorization authorization = usageProtection.authorize(
                command.actorUserId(), command.workspaceId(), command.connectionId());
        usageProtection.requireUnused(
                authorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY);
        return usageProtection.reauthorizeAndMutate(
                command.actorUserId(),
                command.workspaceId(),
                command.connectionId(),
                authorization,
                ConnectionUsageProtection.UsageScope.MEMBER_ONLY,
                (membership, connection) -> saveInTransaction(command, membership, connection));
    }

    public ConnectionResponse execute(
            UUID actorUserId,
            UUID workspaceId,
            UUID connectionId,
            Map<String, Object> payload,
            Instant expiresAt) {
        return execute(new SaveCredentialCommand(workspaceId, actorUserId, connectionId, payload, expiresAt));
    }

    private ConnectionResponse saveInTransaction(
            SaveCredentialCommand command,
            Membership membership,
            Connection connection) {
        byte[] serialized = payloadCodec.encode(connection, command.payload());
        byte[] encrypted = crypto.encrypt(serialized);
        Credential current = credentialRepository.findByConnectionId(connection.getId()).orElse(null);
        Instant now = Instant.now();
        Credential replacement = current == null
                ? new Credential(
                UUID.randomUUID(),
                connection.getId(),
                encrypted,
                crypto.currentKeyVersion(),
                command.expiresAt(),
                now,
                now)
                : new Credential(
                current.getId(),
                connection.getId(),
                encrypted,
                crypto.currentKeyVersion(),
                command.expiresAt(),
                current.getCreatedAt(),
                now);

        Credential savedCredential = credentialRepository.save(replacement);
        if (connection.getStatus() != ConnectionStatus.DISABLED) {
            connection.markDisabled();
            connectionRepository.save(connection);
        }
        return viewAssembler.assemble(connection, membership, savedCredential);
    }
}
