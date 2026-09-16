package com.weav.workspace.domain.exception;

public final class UserInactiveException extends ConflictException {

    public UserInactiveException() {
        super("USER_INACTIVE", "Identity user is inactive");
    }
}
