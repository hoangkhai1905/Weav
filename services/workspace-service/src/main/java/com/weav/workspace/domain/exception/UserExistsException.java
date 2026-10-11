package com.weav.workspace.domain.exception;

public final class UserExistsException extends ConflictException {

    public UserExistsException() {
        super("USER_EXISTS", "A Weav account already exists for this e-mail; add the member directly");
    }
}
