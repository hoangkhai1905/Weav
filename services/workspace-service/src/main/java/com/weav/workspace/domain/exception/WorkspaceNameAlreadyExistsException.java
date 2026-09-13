package com.weav.workspace.domain.exception;

public final class WorkspaceNameAlreadyExistsException extends ConflictException {

    public WorkspaceNameAlreadyExistsException() {
        super("WORKSPACE_NAME_ALREADY_EXISTS", "A workspace with this name already exists");
    }
}
