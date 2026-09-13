package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.repository.query.Param;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface SpringDataMembershipRepository
        extends JpaRepository<MembershipJpaEntity, UUID>, JpaSpecificationExecutor<MembershipJpaEntity> {

    Optional<MembershipJpaEntity> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

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
