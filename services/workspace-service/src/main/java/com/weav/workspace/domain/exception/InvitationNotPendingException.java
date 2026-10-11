package com.weav.workspace.domain.exception;

public final class InvitationNotPendingException extends ConflictException {

    public InvitationNotPendingException() {
        super("INVITATION_NOT_PENDING", "The invitation is not pending");
    }
}
