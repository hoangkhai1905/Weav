package com.weav.workspace.domain.exception;

public final class InvitationGoneException extends GoneException {

    public InvitationGoneException() {
        super("INVITATION_GONE", "The invitation has expired or was revoked");
    }
}
