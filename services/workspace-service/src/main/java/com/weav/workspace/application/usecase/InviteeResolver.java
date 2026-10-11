package com.weav.workspace.application.usecase;

import com.weav.workspace.application.validation.IdentityEmailNormalizer;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.EmailNotVerifiedException;
import com.weav.workspace.domain.exception.InvitationNotFoundException;
import com.weav.workspace.domain.exception.UserInactiveException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;

import java.util.List;
import java.util.UUID;

/** The calling user as Identity sees them, plus the invitee-side checks (package-private). */
record InviteeResolver(UUID userId, String canonicalEmail, boolean emailVerified) {

    static InviteeResolver load(IdentityDirectoryPort identity, UUID callerId) {
        List<IdentityUserSummary> found = identity.getUsersByIds(List.of(callerId));
        if (found.isEmpty()) {
            throw new InvitationNotFoundException();
        }
        IdentityUserSummary caller = found.get(0);
        if (!caller.active()) {
            throw new UserInactiveException();
        }
        String email;
        try {
            email = IdentityEmailNormalizer.canonicalize(caller.email());
        } catch (BadRequestException exception) {
            // An identity address we cannot canonicalize can never match an invitation.
            throw new InvitationNotFoundException();
        }
        return new InviteeResolver(callerId, email, caller.emailVerified());
    }

    /** Another e-mail's invitation is indistinguishable from a missing one (404). */
    void requireOwnedBy(WorkspaceInvitation invitation) {
        if (!invitation.getEmail().equals(canonicalEmail)) {
            throw new InvitationNotFoundException();
        }
    }

    void requireVerified() {
        if (!emailVerified) {
            throw new EmailNotVerifiedException();
        }
    }
}
