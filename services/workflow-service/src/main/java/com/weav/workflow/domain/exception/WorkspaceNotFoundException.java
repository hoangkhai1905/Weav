package com.weav.workflow.domain.exception;

/**
 * The caller is not a member of the workspace, or the workspace is deleted or missing (workspace-service answers
 * 404 for all of these). A {@link ForbiddenException} for every denial handler, but answered over HTTP as 404
 * RESOURCE_NOT_FOUND. A member who merely lacks a capability still gets a plain 403.
 */
public final class WorkspaceNotFoundException extends ForbiddenException {

    public WorkspaceNotFoundException() {
        super("RESOURCE_NOT_FOUND", "Workspace not found");
    }
}
