package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.infrastructure.persistence.entity.UserSessionJpaEntity;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataUserSessionRepository extends JpaRepository<UserSessionJpaEntity, UUID> {

    Optional<UserSessionJpaEntity> findByRefreshTokenHash(String refreshTokenHash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from UserSessionJpaEntity session "
            + "where session.refreshTokenHash = :refreshTokenHash")
    Optional<UserSessionJpaEntity> findByRefreshTokenHashForUpdate(
            @Param("refreshTokenHash") String refreshTokenHash);
}
