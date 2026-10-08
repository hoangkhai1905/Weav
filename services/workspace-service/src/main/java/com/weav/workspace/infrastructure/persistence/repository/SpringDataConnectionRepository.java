package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.ConnectionJpaEntity;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SpringDataConnectionRepository extends JpaRepository<ConnectionJpaEntity, UUID> {

    // W6-D2: connections of a DELETED workspace are not found (internal resolve / auth-failure routes).
    @Query("select c from ConnectionJpaEntity c where c.workspaceId = :workspaceId and c.id = :connectionId "
            + "and exists (select 1 from WorkspaceJpaEntity w where w.id = c.workspaceId "
            + "and w.status = com.weav.workspace.domain.valueobject.WorkspaceStatus.ACTIVE)")
    Optional<ConnectionJpaEntity> findByWorkspaceIdAndId(
            @Param("workspaceId") UUID workspaceId, @Param("connectionId") UUID connectionId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("update ConnectionJpaEntity c set c.status = com.weav.workspace.domain.valueobject.ConnectionStatus.DISABLED, "
            + "c.updatedAt = :now where c.workspaceId = :workspaceId "
            + "and c.status <> com.weav.workspace.domain.valueobject.ConnectionStatus.DISABLED")
    int disableAllByWorkspaceId(@Param("workspaceId") UUID workspaceId, @Param("now") java.time.Instant now);

    List<ConnectionJpaEntity> findAllByWorkspaceId(UUID workspaceId);

    List<ConnectionJpaEntity> findByWorkspaceIdOrderByCreatedAtAscIdAsc(UUID workspaceId, Pageable pageable);

    @Query("select case when count(connection) > 0 then true else false end "
            + "from ConnectionJpaEntity connection "
            + "where connection.workspaceId = :workspaceId "
            + "and connection.nameNormalized = :normalizedName "
            + "and (:excludingConnectionId is null or connection.id <> :excludingConnectionId)")
    boolean existsByWorkspaceIdAndNameNormalized(
            @Param("workspaceId") UUID workspaceId,
            @Param("normalizedName") String normalizedName,
            @Param("excludingConnectionId") UUID excludingConnectionId);
}
