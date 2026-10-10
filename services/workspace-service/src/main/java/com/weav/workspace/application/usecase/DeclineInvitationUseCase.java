package com.weav.workspace.application.usecase;

import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.exception.InvitationGoneException;
import com.weav.workspace.domain.exception.InvitationNotFoundException;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.valueobject.InvitationStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

@Service
public final class DeclineInvitationUseCase {

    private final WorkspaceInvitationRepository invitations;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;
    private final WorkspaceMutationLock mutationLock;
    private final Clock clock;

    public DeclineInvitationUseCase(
            WorkspaceInvitationRepository invitations,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner,
            WorkspaceMutationLock mutationLock,
            Clock clock) {
        this.invitations = Objects.requireNonNull(invitations);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.mutationLock = Objects.requireNonNull(mutationLock);
        this.clock = Objects.requireNonNull(clock);
    }

    public void execute(UUID callerId, UUID invitationId) {
        InviteeResolver caller = InviteeResolver.load(identityDirectory, callerId);
        WorkspaceInvitation probe = transactionRunner.required(
                () -> invitations.findById(invitationId).orElseThrow(InvitationNotFoundException::new));
        caller.requireOwnedBy(probe);
        caller.requireVerified();

        transactionRunner.required(() -> {
            mutationLock.lock(probe.getWorkspaceId());
            WorkspaceInvitation invitation =
                    invitations.findById(invitationId).orElseThrow(InvitationNotFoundException::new);
            caller.requireOwnedBy(invitation);
            Instant now = clock.instant();
            // Declining something already declined is a no-op; accepted/revoked/expired are gone.
            if (invitation.getStatus() == InvitationStatus.DECLINED) {
                return Boolean.TRUE;
            }
            if (!invitation.isLive(now)) {
                throw new InvitationGoneException();
            }
            invitation.decline(callerId, now);
            invitations.save(invitation);
            return Boolean.TRUE;
        });
    }
}
