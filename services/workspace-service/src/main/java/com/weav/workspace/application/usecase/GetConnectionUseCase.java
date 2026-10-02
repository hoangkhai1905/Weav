package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

@Service
public final class GetConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionViewAssembler viewAssembler;
    private final TransactionRunner transactionRunner;

    public GetConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionViewAssembler viewAssembler,
            TransactionRunner transactionRunner) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.viewAssembler = Objects.requireNonNull(viewAssembler);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public ConnectionResponse execute(UUID actorUserId, UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        return transactionRunner.required(() -> {
            Membership membership = requireMembership(actorUserId, workspaceId);
            Connection connection = findConnection(workspaceId, connectionId);
            Credential credential = credentialRepository.findByConnectionId(connection.getId()).orElse(null);
            return viewAssembler.assemble(connection, membership, credential);
        });
    }

    private Membership requireMembership(UUID actorUserId, UUID workspaceId) {
        return membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
    }

    private Connection findConnection(UUID workspaceId, UUID connectionId) {
        return connectionRepository.findByWorkspaceIdAndId(workspaceId, connectionId)
                .orElseThrow(() -> new ResourceNotFoundException("Connection not found", connectionId));
    }
}
