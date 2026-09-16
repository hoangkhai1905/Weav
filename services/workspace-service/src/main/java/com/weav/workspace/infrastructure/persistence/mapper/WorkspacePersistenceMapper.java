package com.weav.workspace.infrastructure.persistence.mapper;

import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;

public class WorkspacePersistenceMapper {

    public WorkspaceJpaEntity toEntity(Workspace workspace) {
        return new WorkspaceJpaEntity(
                workspace.getId(),
                workspace.getName(),
                workspace.getNameNormalized(),
                workspace.getCreatedBy(),
                workspace.getCreatedAt(),
                workspace.getUpdatedAt());
    }

    public Workspace toDomain(WorkspaceJpaEntity entity) {
        return new Workspace(
                entity.getId(),
                entity.getName(),
                entity.getNameNormalized(),
                entity.getCreatedBy(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }

    public MembershipJpaEntity toEntity(Membership membership) {
        return new MembershipJpaEntity(
                membership.getId(),
                membership.getWorkspaceId(),
                membership.getUserId(),
                membership.getRole(),
                membership.isCanPublishWorkflow(),
                membership.isCanManageWorkflowState(),
                membership.getJoinedAt(),
                membership.getUpdatedAt());
    }

    public Membership toDomain(MembershipJpaEntity entity) {
        return new Membership(
                entity.getId(),
                entity.getWorkspaceId(),
                entity.getUserId(),
                entity.getRole(),
                entity.isCanPublishWorkflow(),
                entity.isCanManageWorkflowState(),
                entity.getJoinedAt(),
                entity.getUpdatedAt());
    }
}
