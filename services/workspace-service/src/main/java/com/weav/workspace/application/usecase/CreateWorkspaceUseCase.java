package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.CreateWorkspaceCommand;
import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.InvalidStateException;
import com.weav.workspace.domain.exception.WorkspaceNameAlreadyExistsException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class CreateWorkspaceUseCase {

    private static final int MAX_GENERATED_NAME_ATTEMPTS = 3;

    private final WorkspaceRepository workspaceRepository;
    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;

    public CreateWorkspaceUseCase(
            WorkspaceRepository workspaceRepository,
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
    }

    public WorkspaceResponse execute(CreateWorkspaceCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        validateExplicitName(command.name());

        int attempts = command.hasExplicitName() ? 1 : MAX_GENERATED_NAME_ATTEMPTS;
        for (int attempt = 0; attempt < attempts; attempt++) {
            try {
                return transactionRunner.requiresNew(() -> createInTransaction(command));
            } catch (WorkspaceNameAlreadyExistsException exception) {
                if (!command.hasExplicitName() && attempt + 1 < attempts) {
                    continue;
                }
                throw exception;
            }
        }
        throw new WorkspaceNameAlreadyExistsException();
    }

    private WorkspaceResponse createInTransaction(CreateWorkspaceCommand command) {
        String name = chooseName(command);
        String normalizedName;
        try {
            name = Workspace.normalizeDisplayName(name);
            normalizedName = Workspace.normalizeName(name);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException(exception.getMessage());
        }

        if (workspaceRepository.existsOwnedNameNormalized(
                command.actorUserId(), normalizedName, null)) {
            throw new WorkspaceNameAlreadyExistsException();
        }

        Workspace workspace = Workspace.createNew(name, command.actorUserId());
        Workspace persisted = workspaceRepository.save(workspace);
        membershipRepository.save(Membership.owner(persisted.getId(), command.actorUserId()));
        return WorkspaceResponse.from(persisted);
    }

    private String chooseName(CreateWorkspaceCommand command) {
        if (command.hasExplicitName()) {
            return command.name();
        }
        int max = workspaceRepository.findMaxDefaultWorkspaceNumberByOwner(command.actorUserId());
        if (max < 0 || max == Integer.MAX_VALUE) {
            throw new InvalidStateException("Workspace default name numbering exhausted");
        }
        return "My workspace " + (max + 1);
    }

    private void validateExplicitName(String name) {
        if (name != null && name.isBlank()) {
            throw new BadRequestException("Workspace name must not be blank");
        }
    }
}
