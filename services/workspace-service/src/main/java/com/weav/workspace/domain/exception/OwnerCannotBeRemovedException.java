package com.weav.workspace.domain.exception;

public final class OwnerCannotBeRemovedException extends ConflictException {

    public OwnerCannotBeRemovedException() {
        super("OWNER_CANNOT_REMOVE", "Owner cannot be removed from the workspace");
    }
}
