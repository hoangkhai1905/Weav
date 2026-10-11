package com.weav.workspace.application.usecase;

import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.InvitationNotFoundException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.List;
import java.util.UUID;

/** Shared owner/identity helpers for the invitation use cases (package-private). */
final class InvitationAccess {

    private InvitationAccess() {
    }

    /** Same rule as AddMemberUseCase: non-members get 404, non-owners 403. */
    static void requireOwner(MembershipRepository memberships, UUID workspaceId, UUID actorUserId) {
        Membership actor = memberships.findByWorkspaceIdAndUserId(workspaceId, actorUserId)
                .orElseThrow(() -> new ResourceNotFoundException("Workspace not found", workspaceId));
        if (actor.getRole() != MembershipRole.OWNER) {
            throw new ForbiddenException();
        }
    }

    /** Invitation of another workspace is reported as not found. */
    static WorkspaceInvitation requireInWorkspace(
            WorkspaceInvitationRepository invitations, UUID workspaceId, UUID invitationId) {
        return invitations.findById(invitationId)
                .filter(invitation -> invitation.getWorkspaceId().equals(workspaceId))
                .orElseThrow(InvitationNotFoundException::new);
    }

    /** Display name, falling back to the e-mail, then to a neutral label. */
    static String displayName(IdentityDirectoryPort identity, UUID userId) {
        List<IdentityUserSummary> found = identity.getUsersByIds(List.of(userId));
        if (found.isEmpty()) {
            return "Weav";
        }
        IdentityUserSummary user = found.get(0);
        return user.displayName() != null && !user.displayName().isBlank() ? user.displayName() : user.email();
    }
}
