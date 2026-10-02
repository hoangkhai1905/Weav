package com.weav.workspace.domain.exception;

public final class OwnerPermissionsImmutableException extends ConflictException {

    public OwnerPermissionsImmutableException() {
        super("OWNER_PERMISSIONS_IMMUTABLE", "Owner permissions cannot be changed");
    }
}
