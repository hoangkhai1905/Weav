package com.weav.workspace.domain.model;

import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.Objects;

public record WorkspaceMembershipView(Workspace workspace, MembershipRole role) {

    public WorkspaceMembershipView {
        Objects.requireNonNull(workspace, "workspace must not be null");
        Objects.requireNonNull(role, "role must not be null");
    }
}
