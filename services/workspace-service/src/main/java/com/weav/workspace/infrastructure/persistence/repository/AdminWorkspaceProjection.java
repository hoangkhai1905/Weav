package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;

/** Workspace plus its membership count for the admin listing (one query, no per-row count). */
public interface AdminWorkspaceProjection {

    WorkspaceJpaEntity getWorkspace();

    long getMemberCount();
}
