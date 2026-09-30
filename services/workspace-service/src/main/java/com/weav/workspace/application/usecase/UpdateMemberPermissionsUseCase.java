package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.UpdateMemberPermissionsCommand;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.OwnerPermissionsImmutableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class UpdateMemberPermissionsUseCase {

    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;
    private final AfterCommitExecutor afterCommitExecutor;
    private final WorkspaceAuthorizationCache authorizationCache;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMutationLock mutationLock;
    private final WorkspaceNotificationRecorder notifications;

    public UpdateMemberPermissionsUseCase(
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner,
            AfterCommitExecutor afterCommitExecutor,
            WorkspaceAuthorizationCache authorizationCache,
            WorkspaceRepository workspaceRepository,
            WorkspaceMutationLock mutationLock,
            WorkspaceNotificationRecorder notifications) {
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
        this.workspaceRepository = Objects.requireNonNull(workspaceRepository);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.notifications = Objects.requireNonNull(notifications);
    }

    public Membership execute(UpdateMemberPermissionsCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        return transactionRunner.required(() -> {
            mutationLock.lock(command.workspaceId());
            Membership actor = membershipRepository.findByWorkspaceIdAndUserId(
                            command.workspaceId(), command.actorUserId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Workspace not found", command.workspaceId()));
            if (actor.getRole() != MembershipRole.OWNER) {
                throw new ForbiddenException();
            }
            Membership target = membershipRepository.findByWorkspaceIdAndUserId(
                            command.workspaceId(), command.targetUserId())
                    .orElseThrow(() -> new ResourceNotFoundException(
                            "Member not found", command.targetUserId()));
            if (target.getRole() == MembershipRole.OWNER) {
                throw new OwnerPermissionsImmutableException();
            }
            boolean changed = target.isCanPublishWorkflow() != command.canPublishWorkflow()
                    || target.isCanManageWorkflowState() != command.canManageWorkflowState();
            target.updateOptionalPermissions(
                    command.canPublishWorkflow(), command.canManageWorkflowState());
            Membership saved = membershipRepository.updateOptionalPermissions(target);
            if (changed) {
                Workspace workspace = workspaceRepository.findById(command.workspaceId())
                        .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", command.workspaceId()));
                notifications.recordMemberPermissionsUpdated(command.workspaceId(), command.actorUserId(),
                        command.targetUserId(), workspace.getName());
            }
            afterCommitExecutor.execute(() -> authorizationCache.evict(
                    command.workspaceId(), command.targetUserId()));
            return saved;
        });
    }
}
