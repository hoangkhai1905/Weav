package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.application.service.ConnectionViewAssembler;
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

import java.util.Objects;
import java.util.UUID;

@Service
public final class DisableConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionAuthorizationPolicy authorizationPolicy;
    private final ConnectionViewAssembler viewAssembler;
    private final ConnectionUsageProtection usageProtection;

    @Autowired
    public DisableConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionViewAssembler viewAssembler,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner) {
        this(
                connectionRepository,
                membershipRepository,
                credentialRepository,
                authorizationPolicy,
                viewAssembler,
                new ConnectionUsageProtection(
                        connectionRepository,
                        membershipRepository,
                        authorizationPolicy,
                        workflowConnectionUsagePort,
                        transactionRunner));
    }

    private DisableConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionViewAssembler viewAssembler,
            ConnectionUsageProtection usageProtection) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
        this.viewAssembler = Objects.requireNonNull(viewAssembler);
        this.usageProtection = Objects.requireNonNull(usageProtection);
    }

    public ConnectionResponse execute(UUID actorUserId, UUID workspaceId, UUID connectionId) {
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
                (membership, connection) -> {
            if (connection.getStatus() != ConnectionStatus.DISABLED) {
                connection.markDisabled();
                connectionRepository.save(connection);
            }
            Credential credential = credentialRepository.findByConnectionId(connection.getId()).orElse(null);
            return viewAssembler.assemble(connection, membership, credential);
        });
    }
}
