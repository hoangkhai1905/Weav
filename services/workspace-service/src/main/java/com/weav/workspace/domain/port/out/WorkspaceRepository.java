package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Workspace;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceRepository {
    Workspace save(Workspace workspace);
    Optional<Workspace> findById(UUID id);
}
