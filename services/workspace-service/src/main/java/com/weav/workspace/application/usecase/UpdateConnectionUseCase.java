package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.application.dto.UpdateConnectionCommand;
import com.weav.workspace.application.port.out.WorkflowConnectionUsagePort;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.service.ConnectionAuthorizationPolicy;
import com.weav.workspace.application.service.ConnectionConfigPolicy;
import com.weav.workspace.application.service.ConnectionUsageProtection;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class UpdateConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final MembershipRepository membershipRepository;
    private final CredentialRepository credentialRepository;
    private final ConnectionAuthorizationPolicy authorizationPolicy;
    private final ConnectionConfigPolicy configPolicy;
    private final ConnectionViewAssembler viewAssembler;
    private final ConnectionUsageProtection usageProtection;

    @Autowired
    public UpdateConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionConfigPolicy configPolicy,
            ConnectionViewAssembler viewAssembler,
            WorkflowConnectionUsagePort workflowConnectionUsagePort,
            TransactionRunner transactionRunner) {
        this(
                connectionRepository,
                membershipRepository,
                credentialRepository,
                authorizationPolicy,
                configPolicy,
                viewAssembler,
                new ConnectionUsageProtection(
                        connectionRepository,
                        membershipRepository,
                        authorizationPolicy,
                        workflowConnectionUsagePort,
                        transactionRunner));
    }

    private UpdateConnectionUseCase(
            ConnectionRepository connectionRepository,
            MembershipRepository membershipRepository,
            CredentialRepository credentialRepository,
            ConnectionAuthorizationPolicy authorizationPolicy,
            ConnectionConfigPolicy configPolicy,
            ConnectionViewAssembler viewAssembler,
            ConnectionUsageProtection usageProtection) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.credentialRepository = Objects.requireNonNull(credentialRepository);
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
        this.configPolicy = Objects.requireNonNull(configPolicy);
        this.viewAssembler = Objects.requireNonNull(viewAssembler);
        this.usageProtection = Objects.requireNonNull(usageProtection);
    }

    public ConnectionResponse execute(UpdateConnectionCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        if (command.hasConfig()) {
            configPolicy.validate(command.config());
        }
        String normalizedName = command.hasName() ? normalizeName(command.name()) : null;
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
                (membership, connection) -> updateInTransaction(
                        command, membership, connection, normalizedName));
    }

    private ConnectionResponse updateInTransaction(
            UpdateConnectionCommand command,
            Membership membership,
            Connection connection,
            String normalizedName) {
        boolean changed = false;
        if (command.hasName()) {
            if (!normalizedName.equals(Connection.normalizeName(connection.getName()))) {
                if (connectionRepository.existsByWorkspaceIdAndNameNormalized(
                        command.workspaceId(), normalizedName, connection.getId())) {
                    throw new ConnectionNameAlreadyExistsException();
                }
            }
            if (!command.name().equals(connection.getName())) {
                connection.rename(command.name());
                changed = true;
            }
        }

        if (command.hasConfig()) {
            if (!Objects.equals(connection.getConfig(), command.config())) {
                connection.updateConfig(command.config());
                connection.markDisabled();
                changed = true;
            }
        }

        Connection saved = changed ? save(connection) : connection;
        Credential credential = credentialRepository.findByConnectionId(saved.getId()).orElse(null);
        return viewAssembler.assemble(saved, membership, credential);
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
