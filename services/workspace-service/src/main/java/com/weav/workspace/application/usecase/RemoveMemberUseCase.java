package com.weav.workspace.application.usecase;

import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.OwnerCannotBeRemovedException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.valueobject.MembershipRole;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

@Service
public final class RemoveMemberUseCase {

    private final MembershipRepository membershipRepository;
    private final TransactionRunner transactionRunner;
    private final AfterCommitExecutor afterCommitExecutor;
    private final WorkspaceAuthorizationCache authorizationCache;

    public RemoveMemberUseCase(
            MembershipRepository membershipRepository,
            TransactionRunner transactionRunner,
            AfterCommitExecutor afterCommitExecutor,
            WorkspaceAuthorizationCache authorizationCache) {
        this.membershipRepository = Objects.requireNonNull(membershipRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
    }

    public void execute(UUID workspaceId, UUID actorUserId, UUID targetUserId) {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(targetUserId, "targetUserId must not be null");
        transactionRunner.required(() -> {
            Membership actor = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                    .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
            if (actor.getRole() != MembershipRole.OWNER) {
                throw new ForbiddenException();
            }
            Membership target = membershipRepository.findByWorkspaceIdAndUserId(workspaceId, targetUserId)
                    .orElseThrow(() -> new ResourceNotFoundException("Member not found", targetUserId));
            if (target.getRole() == MembershipRole.OWNER) {
                throw new OwnerCannotBeRemovedException();
            }
            membershipRepository.delete(target);
            afterCommitExecutor.execute(() -> authorizationCache.evict(workspaceId, targetUserId));
            return Boolean.TRUE;
        });
    }
}
