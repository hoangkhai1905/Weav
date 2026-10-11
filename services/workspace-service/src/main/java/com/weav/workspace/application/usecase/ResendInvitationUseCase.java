package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.OwnerInvitationView;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.exception.InvitationNotPendingException;
import com.weav.workspace.domain.exception.InvitationResendTooSoonException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Service
public final class ResendInvitationUseCase {

    private final MembershipRepository memberships;
    private final WorkspaceRepository workspaces;
    private final WorkspaceInvitationRepository invitations;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock mutationLock;
    private final WorkspaceNotificationRecorder notifications;
    private final Clock clock;

    public ResendInvitationUseCase(
            MembershipRepository memberships,
            WorkspaceRepository workspaces,
            WorkspaceInvitationRepository invitations,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock mutationLock,
            WorkspaceNotificationRecorder notifications,
            Clock clock) {
        this.memberships = Objects.requireNonNull(memberships);
        this.workspaces = Objects.requireNonNull(workspaces);
        this.invitations = Objects.requireNonNull(invitations);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.notifications = Objects.requireNonNull(notifications);
        this.clock = Objects.requireNonNull(clock);
    }

    public OwnerInvitationView execute(UUID workspaceId, UUID actorUserId, UUID invitationId) {
        transactionRunner.required(() -> {
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            return Boolean.TRUE;
        });
        String actorName = InvitationAccess.displayName(identityDirectory, actorUserId);

        return transactionRunner.required(() -> {
            mutationLock.lock(workspaceId);
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            WorkspaceInvitation invitation =
                    InvitationAccess.requireInWorkspace(invitations, workspaceId, invitationId);
            Instant now = clock.instant();
            // An expired invitation cannot be resent: the owner re-invites instead.
            if (!invitation.isLive(now)) {
                throw new InvitationNotPendingException();
            }
            if (now.isBefore(invitation.getLastSentAt().plus(WorkspaceInvitation.RESEND_COOLDOWN))) {
                throw new InvitationResendTooSoonException();
            }
            Workspace workspace = workspaces.findById(workspaceId)
                    .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
            invitation.resend(now);
            WorkspaceInvitation saved = invitations.save(invitation);
            notifications.recordInvitationCreated(workspaceId, actorUserId, workspace.getName(),
                    saved.getEmail(), actorName, saved.getExpiresAt());
            return OwnerInvitationView.from(saved, now);
        });
    }
}
