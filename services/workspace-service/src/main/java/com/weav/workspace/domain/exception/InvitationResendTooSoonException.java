package com.weav.workspace.domain.exception;

public final class InvitationResendTooSoonException extends TooManyRequestsException {

    public InvitationResendTooSoonException() {
        super("INVITATION_RESEND_TOO_SOON", "The invitation was sent recently; try again later");
    }
}
