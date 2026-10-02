package com.weav.workspace.application.service;

import com.weav.workspace.application.dto.ConnectionResponse;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.model.Membership;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.Optional;

@Service
public final class ConnectionViewAssembler {

    private final ConnectionAuthorizationPolicy authorizationPolicy;

    public ConnectionViewAssembler(ConnectionAuthorizationPolicy authorizationPolicy) {
        this.authorizationPolicy = Objects.requireNonNull(authorizationPolicy);
    }

    public ConnectionResponse assemble(
            Connection connection,
            Membership membership,
            Credential credential) {
        Objects.requireNonNull(connection, "connection must not be null");
        Objects.requireNonNull(membership, "membership must not be null");

        boolean canViewConfig = authorizationPolicy.canViewConfig(membership, connection);
        boolean canManage = authorizationPolicy.canManageIgnoringUsage(membership, connection);
        boolean canAttach = authorizationPolicy.canAttach(membership, connection);
        return new ConnectionResponse(
                connection.getId(),
                connection.getWorkspaceId(),
                connection.getCreatedBy(),
                connection.getName(),
                connection.getProvider(),
                connection.getAuthType(),
                connection.getStatus(),
                canViewConfig ? connection.getConfig() : null,
                credential != null,
                credential == null ? null : credential.getExpiresAt(),
                connection.getLastVerifiedAt(),
                canManage,
                canAttach,
                connection.getCreatedAt(),
                connection.getUpdatedAt());
    }

    public ConnectionResponse assemble(
            Connection connection,
            Membership membership,
            Optional<Credential> credential) {
        return assemble(connection, membership, credential == null ? null : credential.orElse(null));
    }

    public ConnectionResponse from(
            Connection connection,
            Membership membership,
            Credential credential) {
        return assemble(connection, membership, credential);
    }
}
