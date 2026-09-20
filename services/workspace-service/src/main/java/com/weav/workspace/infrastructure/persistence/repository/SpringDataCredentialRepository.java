package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.infrastructure.persistence.entity.CredentialJpaEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;
import java.util.UUID;

public interface SpringDataCredentialRepository extends JpaRepository<CredentialJpaEntity, UUID> {

    Optional<CredentialJpaEntity> findByConnectionId(UUID connectionId);

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("delete from CredentialJpaEntity credential where credential.connectionId = :connectionId")
    void deleteByConnectionId(@Param("connectionId") UUID connectionId);
}
