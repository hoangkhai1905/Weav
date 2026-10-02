package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.valueobject.MembershipRole;
import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceJpaEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface SpringDataWorkspaceRepository
        extends JpaRepository<WorkspaceJpaEntity, UUID>, JpaSpecificationExecutor<WorkspaceJpaEntity> {

    @Query(value = "select workspace as workspace, membership.role as role "
            + "from WorkspaceJpaEntity workspace "
            + "join MembershipJpaEntity membership on membership.workspaceId = workspace.id "
            + "where membership.userId = :userId "
            + "and (:role is null or membership.role = :role) "
            + "and (:searchPattern is null or "
            + "lower(workspace.nameNormalized) like :searchPattern escape '!')",
            countQuery = "select count(workspace.id) "
                    + "from WorkspaceJpaEntity workspace "
                    + "join MembershipJpaEntity membership on membership.workspaceId = workspace.id "
                    + "where membership.userId = :userId "
                    + "and (:role is null or membership.role = :role) "
                    + "and (:searchPattern is null or "
                    + "lower(workspace.nameNormalized) like :searchPattern escape '!')")
    Page<WorkspaceMembershipProjection> findAccessibleWorkspaces(
            @Param("userId") UUID userId,
            @Param("role") MembershipRole role,
            @Param("searchPattern") String searchPattern,
            Pageable pageable);

    @Query("select case when count(workspace) > 0 then true else false end "
            + "from WorkspaceJpaEntity workspace "
            + "where workspace.createdBy = :ownerId "
            + "and workspace.nameNormalized = :normalizedName "
            + "and (:excludeWorkspaceId is null or workspace.id <> :excludeWorkspaceId)")
    boolean existsOwnedNameNormalized(
            @Param("ownerId") UUID ownerId,
            @Param("normalizedName") String normalizedName,
            @Param("excludeWorkspaceId") UUID excludeWorkspaceId);

    @Query("select workspace.nameNormalized from WorkspaceJpaEntity workspace "
            + "where workspace.createdBy = :ownerId")
    List<String> findNormalizedNamesByOwner(@Param("ownerId") UUID ownerId);
}
