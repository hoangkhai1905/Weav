package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.ConnectionJpaEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SpringDataConnectionRepository extends JpaRepository<ConnectionJpaEntity, UUID> {

    Optional<ConnectionJpaEntity> findByWorkspaceIdAndId(UUID workspaceId, UUID connectionId);

    List<ConnectionJpaEntity> findAllByWorkspaceId(UUID workspaceId);

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
