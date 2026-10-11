package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.valueobject.InvitationStatus;
import com.weav.workspace.infrastructure.persistence.entity.WorkspaceInvitationJpaEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SpringDataWorkspaceInvitationRepository
        extends JpaRepository<WorkspaceInvitationJpaEntity, UUID> {

    Optional<WorkspaceInvitationJpaEntity> findByWorkspaceIdAndEmailAndStatus(
            UUID workspaceId, String email, InvitationStatus status);

    long countByWorkspaceIdAndStatusAndExpiresAtAfter(
            UUID workspaceId, InvitationStatus status, Instant now);

    long countByWorkspaceIdAndCreatedAtGreaterThanEqual(UUID workspaceId, Instant since);

    List<WorkspaceInvitationJpaEntity> findByWorkspaceIdAndStatusOrderByCreatedAtDesc(
            UUID workspaceId, InvitationStatus status, Pageable pageable);

    List<WorkspaceInvitationJpaEntity> findByEmailAndStatusAndExpiresAtAfterOrderByCreatedAtDesc(
            String email, InvitationStatus status, Instant now, Pageable pageable);
}
