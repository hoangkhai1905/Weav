package com.weav.workspace.application.service;

import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.valueobject.MembershipRole;

import java.util.Objects;

public final class ConnectionAuthorizationPolicy {

    public boolean canViewConfig(Membership membership, Connection connection) {
        Objects.requireNonNull(membership, "membership must not be null");
        Objects.requireNonNull(connection, "connection must not be null");

        return isInWorkspace(membership, connection)
                && (membership.getRole() == MembershipRole.OWNER
                || membership.getUserId().equals(connection.getCreatedBy()));
    }

    public boolean canAttach(Membership membership, Connection connection) {
        return canManageIgnoringUsage(membership, connection);
    }

    public boolean canManageIgnoringUsage(Membership membership, Connection connection) {
        Objects.requireNonNull(membership, "membership must not be null");
        Objects.requireNonNull(connection, "connection must not be null");

        return isInWorkspace(membership, connection)
                && (membership.getRole() == MembershipRole.OWNER
                || membership.getUserId().equals(connection.getCreatedBy()));
    }

    private boolean isInWorkspace(Membership membership, Connection connection) {
        return membership.getWorkspaceId().equals(connection.getWorkspaceId());
    }
}
