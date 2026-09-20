package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Service
public final class ListConnectionsUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionViewAssembler viewAssembler;
    private final TransactionRunner transactionRunner;

    public ListConnectionsUseCase(
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

    public List<ConnectionResponse> execute(UUID actorUserId, UUID workspaceId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        return transactionRunner.required(() -> {
            Membership membership = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                    .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
            return connectionRepository.findAllByWorkspaceId(workspaceId).stream()
                    .map(connection -> {
                        Credential credential = credentialRepository.findByConnectionId(connection.getId())
                                .orElse(null);
                        return viewAssembler.assemble(connection, membership, credential);
                    })
                    .toList();
        });
    }
}
