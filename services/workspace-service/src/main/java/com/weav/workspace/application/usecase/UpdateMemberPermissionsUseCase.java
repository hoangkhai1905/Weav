package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.UpdateMemberPermissionsCommand;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.OwnerPermissionsImmutableException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.springframework.stereotype.Service;

import java.util.Objects;

@Service
public final class UpdateMemberPermissionsUseCase {

    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;
    private final AfterCommitExecutor afterCommitExecutor;
    private final WorkspaceAuthorizationCache authorizationCache;

    public UpdateMemberPermissionsUseCase(
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner,
            AfterCommitExecutor afterCommitExecutor,
            WorkspaceAuthorizationCache authorizationCache) {
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
    }

    public Membership execute(UpdateMemberPermissionsCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        return transactionRunner.required(() -> {
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
            target.updateOptionalPermissions(
                    command.canPublishWorkflow(), command.canManageWorkflowState());
            Membership saved = membershipRepository.updateOptionalPermissions(target);
            afterCommitExecutor.execute(() -> authorizationCache.evict(
                    command.workspaceId(), command.targetUserId()));
            return saved;
        });
    }
}
