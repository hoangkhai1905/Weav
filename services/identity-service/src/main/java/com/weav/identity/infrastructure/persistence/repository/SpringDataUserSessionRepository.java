package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.infrastructure.persistence.entity.UserSessionJpaEntity;
import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataUserSessionRepository extends JpaRepository<UserSessionJpaEntity, UUID> {

    Optional<UserSessionJpaEntity> findByRefreshTokenHash(String refreshTokenHash);

    Page<UserSessionJpaEntity> findByUserIdAndRevokedAtIsNullAndExpiresAtAfter(
            UUID userId,
            Instant now,
            Pageable pageable);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from UserSessionJpaEntity session where session.id = :id")
    Optional<UserSessionJpaEntity> findByIdForUpdate(@Param("id") UUID id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select session from UserSessionJpaEntity session "
            + "where session.refreshTokenHash = :refreshTokenHash")
    Optional<UserSessionJpaEntity> findByRefreshTokenHashForUpdate(
            @Param("refreshTokenHash") String refreshTokenHash);

    @Modifying
    @Query("update UserSessionJpaEntity session set session.revokedAt = :revokedAt "
            + "where session.userId = :userId and session.revokedAt is null")
    int revokeAllByUserId(@Param("userId") UUID userId, @Param("revokedAt") Instant revokedAt);
}
