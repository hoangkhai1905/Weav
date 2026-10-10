package com.weav.workspace.application.usecase;

import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.exception.InvitationGoneException;
import com.weav.workspace.domain.exception.InvitationNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.InvitationStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Service
public final class AcceptInvitationUseCase {

    private final WorkspaceInvitationRepository invitations;
    private final MembershipRepository memberships;
    private final WorkspaceRepository workspaces;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;
    private final AfterCommitExecutor afterCommitExecutor;
    private final WorkspaceAuthorizationCache authorizationCache;
    private final WorkspaceMutationLock mutationLock;
    private final WorkspaceNotificationRecorder notifications;
    private final Clock clock;

    public AcceptInvitationUseCase(
            WorkspaceInvitationRepository invitations,
            MembershipRepository memberships,
            WorkspaceRepository workspaces,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner,
            AfterCommitExecutor afterCommitExecutor,
            WorkspaceAuthorizationCache authorizationCache,
            WorkspaceMutationLock mutationLock,
            WorkspaceNotificationRecorder notifications,
            Clock clock) {
        this.invitations = Objects.requireNonNull(invitations);
        this.memberships = Objects.requireNonNull(memberships);
        this.workspaces = Objects.requireNonNull(workspaces);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.afterCommitExecutor = Objects.requireNonNull(afterCommitExecutor);
        this.authorizationCache = Objects.requireNonNull(authorizationCache);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.notifications = Objects.requireNonNull(notifications);
        this.clock = Objects.requireNonNull(clock);
    }

    /** Returns the workspace id the caller now belongs to (idempotent). */
    public UUID execute(UUID callerId, UUID invitationId) {
        // Identity lookup runs outside any transaction or workspace lock.
        InviteeResolver caller = InviteeResolver.load(identityDirectory, callerId);

        // Resolve the workspace id first so the row lock is taken before the invitation is re-read.
        WorkspaceInvitation probe = transactionRunner.required(
                () -> invitations.findById(invitationId).orElseThrow(InvitationNotFoundException::new));
        caller.requireOwnedBy(probe);
        caller.requireVerified();

        return transactionRunner.required(() -> {
            mutationLock.lock(probe.getWorkspaceId());
            WorkspaceInvitation invitation =
                    invitations.findById(invitationId).orElseThrow(InvitationNotFoundException::new);
            caller.requireOwnedBy(invitation);
            UUID workspaceId = invitation.getWorkspaceId();
            // A soft-deleted workspace is gone for every status, accepted included.
            Workspace workspace = workspaces.findById(workspaceId).orElseThrow(InvitationGoneException::new);
            boolean member = memberships.existsByWorkspaceIdAndUserId(workspaceId, callerId);
            if (invitation.getStatus() == InvitationStatus.ACCEPTED) {
                // Idempotent only while the caller still belongs; someone who left or was removed re-joins by invite.
                if (!member) {
                    throw new InvitationGoneException();
                }
                return workspaceId;
            }
            Instant now = clock.instant();
            if (!invitation.isLive(now)) {
                throw new InvitationGoneException();
            }
            if (!member) {
                memberships.save(Membership.member(workspaceId, callerId));
                notifications.recordMemberAdded(workspaceId, invitation.getInvitedBy(), callerId,
                        workspace.getName());
                afterCommitExecutor.execute(() -> authorizationCache.evict(workspaceId, callerId));
            }
            invitation.accept(callerId, now);
            invitations.save(invitation);
            return workspaceId;
        });
    }
}
