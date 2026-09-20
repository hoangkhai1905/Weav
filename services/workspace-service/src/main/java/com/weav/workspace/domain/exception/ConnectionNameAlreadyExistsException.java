package com.weav.workspace.domain.exception;

public final class ConnectionNameAlreadyExistsException extends ConflictException {

    public ConnectionNameAlreadyExistsException() {
        super("CONNECTION_NAME_ALREADY_EXISTS", "A connection with this name already exists in the workspace");
    }
}
