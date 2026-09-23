package com.weav.workflow.application.port.out;

/** Sanitized failure raised when Workspace cannot supply a valid response. */
public final class WorkspaceDependencyUnavailableException extends RuntimeException {

    public WorkspaceDependencyUnavailableException() {
        super("Workspace authorization service is unavailable");
    }
}
