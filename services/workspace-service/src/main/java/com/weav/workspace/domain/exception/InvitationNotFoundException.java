package com.weav.workspace.domain.exception;

public final class InvitationNotFoundException extends ResourceNotFoundException {

    public InvitationNotFoundException() {
        super("INVITATION_NOT_FOUND", "Invitation not found", true);
    }
}
