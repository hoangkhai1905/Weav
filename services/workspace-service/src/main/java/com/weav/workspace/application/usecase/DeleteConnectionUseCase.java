package com.weav.workspace.application.usecase;

import com.weav.workspace.application.service.ConnectionUsageProtection;
import com.weav.workspace.domain.model.Connection;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import org.springframework.stereotype.Service;

import java.util.Objects;
import java.util.UUID;

/** Deletes a connection after Workflow confirms that no workflow references it. */
@Service
public final class DeleteConnectionUseCase {

    private final ConnectionRepository connectionRepository;
    private final ConnectionUsageProtection usageProtection;

    public DeleteConnectionUseCase(
            ConnectionRepository connectionRepository,
            ConnectionUsageProtection usageProtection) {
        this.connectionRepository = Objects.requireNonNull(connectionRepository);
        this.usageProtection = Objects.requireNonNull(usageProtection);
    }

    public void execute(UUID actorUserId, UUID workspaceId, UUID connectionId) {
        Objects.requireNonNull(actorUserId, "actorUserId must not be null");
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        ConnectionUsageProtection.Authorization authorization = usageProtection.authorize(
                actorUserId, workspaceId, connectionId);
        usageProtection.requireUnused(authorization, ConnectionUsageProtection.UsageScope.ALL_ROLES);
        usageProtection.reauthorizeAndMutate(
                actorUserId,
                workspaceId,
                connectionId,
                authorization,
                ConnectionUsageProtection.UsageScope.ALL_ROLES,
                (Membership membership, Connection connection) -> {
                    connectionRepository.delete(connection);
                    return Boolean.TRUE;
                });
    }
}
