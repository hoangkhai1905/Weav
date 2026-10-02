package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.CreateConnectionCommand;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionConfigPolicy;
import com.weav.workspace.application.service.ConnectionProviderPolicy;
import com.weav.workspace.application.service.ConnectionViewAssembler;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ConnectionNameAlreadyExistsException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class CreateConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionProviderPolicy providerPolicy;
    private final ConnectionConfigPolicy configPolicy;
    private final ConnectionViewAssembler viewAssembler;
    private final TransactionRunner transactionRunner;

    public CreateConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionProviderPolicy providerPolicy,
            ConnectionConfigPolicy configPolicy,
            ConnectionViewAssembler viewAssembler,
            TransactionRunner transactionRunner) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.providerPolicy = Objects.requireNonNull(providerPolicy);
        this.configPolicy = Objects.requireNonNull(configPolicy);
        this.viewAssembler = Objects.requireNonNull(viewAssembler);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public ConnectionResponse execute(CreateConnectionCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        return transactionRunner.required(() -> createInTransaction(command));
    }

    private ConnectionResponse createInTransaction(CreateConnectionCommand command) {
        Membership membership = requireMembership(command);
        providerPolicy.validate(command.provider(), command.authType());
        String normalizedName = normalizeName(command.name());
        configPolicy.validate(command.config());

        if (connectionRepository.existsByWorkspaceIdAndNameNormalized(
                command.workspaceId(), normalizedName, null)) {
            throw new ConnectionNameAlreadyExistsException();
        }

        Connection connection = Connection.createNew(
                command.workspaceId(),
                command.actorUserId(),
                command.name(),
                command.provider(),
                command.authType(),
                command.config());
        Connection saved = save(connection);
        Credential credential = credentialRepository.findByConnectionId(saved.getId()).orElse(null);
        return viewAssembler.assemble(saved, membership, credential);
    }

    private Membership requireMembership(CreateConnectionCommand command) {
        return membershipRepository.findByWorkspaceIdAndUserId(
                        command.workspaceId(), command.actorUserId())
                .orElseThrow(() -> new ResourceNotFoundException(
                        "Workspace not found", command.workspaceId()));
    }

    private String normalizeName(String name) {
        try {
            return Connection.normalizeName(name);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException(exception.getMessage());
        }
    }

    private Connection save(Connection connection) {
        return connectionRepository.save(connection);
    }
}
