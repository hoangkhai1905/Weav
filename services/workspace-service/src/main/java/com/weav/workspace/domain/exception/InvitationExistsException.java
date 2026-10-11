package com.weav.workspace.domain.exception;

public final class InvitationExistsException extends ConflictException {

    public InvitationExistsException() {
        super("INVITATION_EXISTS", "A pending invitation already exists for this e-mail");
    }
}
