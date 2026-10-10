package com.weav.workspace.domain.exception;

public final class EmailNotVerifiedException extends ConflictException {

    public EmailNotVerifiedException() {
        super("EMAIL_NOT_VERIFIED", "Verify your e-mail address before answering invitations");
    }
}
