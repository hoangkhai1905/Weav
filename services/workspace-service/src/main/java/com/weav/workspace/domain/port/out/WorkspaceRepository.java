package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.AdminWorkspaceRow;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.PageResult;
import com.weav.workspace.domain.model.WorkspaceMembershipView;
import com.weav.workspace.domain.query.AdminWorkspaceQuery;
import com.weav.workspace.domain.query.WorkspaceListQuery;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceRepository {
    Workspace save(Workspace workspace);
    Optional<Workspace> findById(UUID workspaceId);

    /** Active workspaces among the ids (soft-deleted ones are omitted); adapters override with one query. */
    default List<Workspace> findAllByIds(Collection<UUID> workspaceIds) {
        return workspaceIds.stream().map(this::findById).flatMap(Optional::stream).toList();
    }
    boolean existsOwnedNameNormalized(UUID ownerId, String normalizedName, UUID excludeWorkspaceId);
    int findMaxDefaultWorkspaceNumberByOwner(UUID ownerId);
    PageResult<WorkspaceMembershipView> findAccessibleWorkspaces(UUID userId, WorkspaceListQuery query);

    /** Active workspaces of every owner with member counts, newest first (UC027); adapters override. */
    default PageResult<AdminWorkspaceRow> findAllForAdmin(AdminWorkspaceQuery query) {
        throw new UnsupportedOperationException("findAllForAdmin is not supported by this repository");
    }
}
