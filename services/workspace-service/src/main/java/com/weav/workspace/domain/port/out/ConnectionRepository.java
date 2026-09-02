package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Connection;
import java.util.Optional;
import java.util.UUID;

public interface ConnectionRepository {
    Connection save(Connection connection);
    Optional<Connection> findById(UUID id);
    boolean existsByWorkspaceIdAndName(UUID workspaceId, String name);
}
