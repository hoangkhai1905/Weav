package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.WorkspaceMembershipView;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceRepository {
    Workspace save(Workspace workspace);
    Optional<Workspace> findById(UUID workspaceId);
    boolean existsOwnedNameNormalized(UUID ownerId, String normalizedName, UUID excludeWorkspaceId);
    int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId);
    PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(UUID userId, WorkspaceListQuery query);
}
