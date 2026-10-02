package com.weav.workspace.domain.exception;

public final class UserAlreadyMemberException extends ConflictException {

    public UserAlreadyMemberException() {
        super("USER_ALREADY_MEMBER", "Identity user is already a workspace member");
    }
}
