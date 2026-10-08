package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.List;
import java.util.UUID;

public interface SpringDataMembershipRepository
        extends JpaRepository<MembershipJpaEntity, UUID>, JpaSpecificationExecutor<MembershipJpaEntity> {

    // W6-D2: the choke point for "is this user in this workspace"; a DELETED workspace is not found.
    @Query("select m from MembershipJpaEntity m "
            + "where m.workspaceId = :workspaceId and m.userId = :userId "
            + "and exists (select 1 from WorkspaceJpaEntity w where w.id = m.workspaceId "
            + "and w.status = com.weav.workspace.domain.valueobject.WorkspaceStatus.ACTIVE)")
    Optional<MembershipJpaEntity> findByWorkspaceIdAndUserId(
            @Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    List<MembershipJpaEntity> findByWorkspaceIdOrderByUserIdAsc(UUID workspaceId);

    @Query("select count(m) > 0 from MembershipJpaEntity m "
            + "where m.workspaceId = :workspaceId and m.userId = :userId "
            + "and exists (select 1 from WorkspaceJpaEntity w where w.id = m.workspaceId "
            + "and w.status = com.weav.workspace.domain.valueobject.WorkspaceStatus.ACTIVE)")
    boolean existsByWorkspaceIdAndUserId(
            @Param("workspaceId") UUID workspaceId, @Param("userId") UUID userId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update MembershipJpaEntity m "
            + "set m.canPublishWorkflow = :canPublishWorkflow, "
            + "m.canManageWorkflowState = :canManageWorkflowState, "
            + "m.updatedAt = :updatedAt "
            + "where m.id = :id")
    int updateOptionalPermissions(
            @Param("id") UUID id,
            @Param("canPublishWorkflow") boolean canPublishWorkflow,
            @Param("canManageWorkflowState") boolean canManageWorkflowState,
            @Param("updatedAt") Instant updatedAt);
}
