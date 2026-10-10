package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.OwnerInvitationView;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.application.validation.IdentityEmailNormalizer;
import com.weav.workspace.domain.exception.InvitationExistsException;
import com.weav.workspace.domain.exception.InvitationLimitException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.exception.UserExistsException;
import com.weav.workspace.domain.exception.UserInactiveException;
import com.weav.workspace.domain.model.IdentityUserSummary;
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
import java.util.Optional;
import java.util.UUID;

@Service
public final class CreateInvitationUseCase {

    private final MembershipRepository memberships;
    private final WorkspaceRepository workspaces;
    private final WorkspaceInvitationRepository invitations;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock mutationLock;
    private final WorkspaceNotificationRecorder notifications;
    private final Clock clock;

    public CreateInvitationUseCase(
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

    public OwnerInvitationView execute(UUID workspaceId, UUID actorUserId, String rawEmail) {
        // Owner pre-check first so non-owners cannot probe which e-mails have accounts.
        transactionRunner.required(() -> {
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            return Boolean.TRUE;
        });
        String email = IdentityEmailNormalizer.canonicalize(rawEmail);
        // Remote Identity lookups run outside any transaction or workspace lock.
        Optional<IdentityUserSummary> existing = identityDirectory.findByEmail(email);
        if (existing.isPresent()) {
            throw existing.get().active() ? new UserExistsException() : new UserInactiveException();
        }
        String inviterName = InvitationAccess.displayName(identityDirectory, actorUserId);

        return transactionRunner.required(() -> {
            mutationLock.lock(workspaceId);
            InvitationAccess.requireOwner(memberships, workspaceId, actorUserId);
            Instant now = clock.instant();
            Optional<WorkspaceInvitation> pending = invitations.findPendingByWorkspaceAndEmail(workspaceId, email);
            if (pending.isPresent()) {
                if (pending.get().isLive(now)) {
                    throw new InvitationExistsException();
                }
                pending.get().revoke(now);
                invitations.save(pending.get());
            }
            if (invitations.countLivePendingByWorkspace(workspaceId, now)
                    >= WorkspaceInvitation.MAX_PENDING_PER_WORKSPACE
                    || invitations.countCreatedSince(workspaceId, now.minus(WorkspaceInvitation.CREATE_WINDOW))
                    >= WorkspaceInvitation.MAX_CREATED_PER_WINDOW) {
                throw new InvitationLimitException();
            }
            Workspace workspace = workspaces.findById(workspaceId)
                    .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
            WorkspaceInvitation saved = invitations.save(
                    WorkspaceInvitation.pending(workspaceId, email, actorUserId, now));
            notifications.recordInvitationCreated(workspaceId, actorUserId, workspace.getName(), email,
                    inviterName, saved.getExpiresAt());
            return OwnerInvitationView.from(saved, now);
        });
    }
}
