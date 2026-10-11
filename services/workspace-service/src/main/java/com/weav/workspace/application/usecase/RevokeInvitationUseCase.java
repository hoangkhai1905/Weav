package com.weav.workspace.application.usecase;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

@Service
public final class RevokeInvitationUseCase {

    private final MembershipRepository memberships;
    private final WorkspaceInvitationRepository invitations;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock mutationLock;
    private final Clock clock;

    public RevokeInvitationUseCase(
            MembershipRepository memberships,
            WorkspaceInvitationRepository invitations,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock mutationLock,
            Clock clock) {
        this.memberships = Objects.requireNonNull(memberships);
        this.invitations = Objects.requireNonNull(invitations);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.clock = Objects.requireNonNull(clock);
    }

    /** PENDING (live or expired) becomes REVOKED; any other status is INVITATION_NOT_PENDING. */
    public void execute(UUID workspaceId, UUID actorUserId, UUID invitationId) {
        // Owner pre-check without the lock, like Create/Resend, so non-owners never queue on it.
        transactionRunner.required(() -> {
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            return Boolean.TRUE;
        });
        transactionRunner.required(() -> {
            mutationLock.lock(workspaceId);
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            WorkspaceInvitation invitation =
                    InvitationAccess.requireInWorkspace(invitations, workspaceId, invitationId);
            invitation.revoke(clock.instant());
            invitations.save(invitation);
            return Boolean.TRUE;
        });
    }
}
