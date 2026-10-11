package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.OwnerInvitationView;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

@Service
public final class ListWorkspaceInvitationsUseCase {

    private static final int LIMIT = WorkspaceInvitation.MAX_PENDING_PER_WORKSPACE;

    private final MembershipRepository memberships;
    private final WorkspaceInvitationRepository invitations;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public ListWorkspaceInvitationsUseCase(
            MembershipRepository memberships,
            WorkspaceInvitationRepository invitations,
            TransactionRunner transactionRunner,
            Clock clock) {
        this.memberships = Objects.requireNonNull(memberships);
        this.invitations = Objects.requireNonNull(invitations);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public List<OwnerInvitationView> execute(UUID workspaceId, UUID actorUserId) {
        return transactionRunner.required(() -> {
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            Instant now = clock.instant();
            return invitations.listPendingByWorkspace(workspaceId, LIMIT).stream()
                    .map(invitation -> OwnerInvitationView.from(invitation, now))
                    .toList();
        });
    }
}
