package com.weav.workspace.domain.exception;

public final class OwnerCannotLeaveException extends ConflictException {

    public OwnerCannotLeaveException() {
        super("OWNER_CANNOT_LEAVE", "Owner cannot leave the workspace");
    }
}
