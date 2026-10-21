package com.weav.workspace.domain.model;

import java.util.Objects;

public record AdminWorkspaceRow(Workspace workspace, long memberCount) {

    public AdminWorkspaceRow {
        Objects.requireNonNull(workspace, "workspace must not be null");
    }
}
