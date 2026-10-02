package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.valueobject.MembershipRole;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;

/**
 * Joined workspace and actor membership projection used by the accessible page.
 * Keeping the actor role in the same query avoids a membership reread per row.
 */
public interface WorkspaceMembershipProjection {

    WorkspaceJpaEntity getWorkspace();

    MembershipRole getRole();
}
