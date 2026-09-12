package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.MembershipJpaEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;
import java.util.UUID;

public interface SpringDataMembershipRepository
        extends JpaRepository<MembershipJpaEntity, UUID>, JpaSpecificationExecutor<MembershipJpaEntity> {

    Optional<MembershipJpaEntity> findByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);

    boolean existsByWorkspaceIdAndUserId(UUID workspaceId, UUID userId);
}
