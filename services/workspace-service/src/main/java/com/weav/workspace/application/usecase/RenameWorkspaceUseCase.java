package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.WorkspaceResponse;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.exception.WorkspaceNameAlreadyExistsException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

@Service
public final class RenameWorkspaceUseCase {

    private final WorkspaceRepository workspaceRepository;
    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock mutationLock;
    private final WorkspaceNotificationRecorder notifications;

    public RenameWorkspaceUseCase(
            WorkspaceRepository workspaceRepository,
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock mutationLock,
            WorkspaceNotificationRecorder notifications) {
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.notifications = Objects.requireNonNull(notifications);
    }

    public WorkspaceResponse execute(UUID actorUserId, UUID workspaceId, String name) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        if (name == null || name.isBlank()) {
            throw new BadRequestException("Workspace name must not be blank");
        }
        return transactionRunner.required(() -> renameInTransaction(actorUserId, workspaceId, name));
    }

    private WorkspaceResponse renameInTransaction(UUID actorUserId, UUID workspaceId, String name) {
        mutationLock.lock(workspaceId);
        Membership membership = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
        if (membership.getRole() != MembershipRole.OWNER) {
            throw new ForbiddenException();
        }

        Workspace workspace = workspaceRepository.findById(workspaceId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
        String displayName;
        String normalizedName;
        try {
            displayName = Workspace.normalizeDisplayName(name);
            normalizedName = Workspace.normalizeName(displayName);
        } catch (IllegalArgumentException exception) {
            throw new BadRequestException(exception.getMessage());
        }
        if (workspaceRepository.existsOwnedNameNormalized(actorUserId, normalizedName, workspaceId)) {
            throw new WorkspaceNameAlreadyExistsException();
        }
        boolean displayNameChanged = !workspace.getName().equals(displayName);
        workspace.rename(displayName);
        Workspace persisted = workspaceRepository.save(workspace);
        if (displayNameChanged) {
            notifications.recordRenamed(workspaceId, actorUserId, persisted.getName(),
                    membershipRepository.findUserIdsByWorkspaceId(workspaceId));
        }
        return WorkspaceResponse.from(persisted);
    }
}
