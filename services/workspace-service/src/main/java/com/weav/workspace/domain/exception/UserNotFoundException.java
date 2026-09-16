package com.weav.workspace.domain.exception;

public final class UserNotFoundException extends DomainException {

    public UserNotFoundException() {
        super("USER_NOT_FOUND", "Identity user was not found");
    }
}
