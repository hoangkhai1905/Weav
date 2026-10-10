package com.weav.workspace.domain.exception;

public final class InvitationLimitException extends TooManyRequestsException {

    public InvitationLimitException() {
        super("INVITATION_LIMIT", "Too many pending invitations in this workspace");
    }
}
