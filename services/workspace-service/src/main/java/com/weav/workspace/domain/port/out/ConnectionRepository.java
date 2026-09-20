package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Connection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ConnectionRepository {
    Connection save(Connection connection);

    Optional<Connection> findById(UUID id);

    Optional<Connection> findByWorkspaceIdAndId(UUID workspaceId, UUID connectionId);

    List<Connection> findAllByWorkspaceId(UUID workspaceId);

    boolean existsByWorkspaceIdAndNameNormalized(
            UUID workspaceId,
            String normalizedName,
            UUID excludingConnectionId);

    void delete(Connection connection);
}
