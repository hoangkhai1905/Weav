package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.infrastructure.persistence.entity.UserJpaEntity;
import jakarta.persistence.LockModeType;
import com.weav.identity.domain.valueobject.UserStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataUserRepository extends JpaRepository<UserJpaEntity, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select user from UserJpaEntity user where user.id = :id")
    Optional<UserJpaEntity> findByIdForUpdate(@Param("id") UUID id);

    @Query("select user from UserJpaEntity user "
            + "where lower(trim(user.email)) = lower(trim(:canonicalEmail))")
    Optional<UserJpaEntity> findByCanonicalEmail(@Param("canonicalEmail") String canonicalEmail);

    @Query("select case when count(user) > 0 then true else false end "
            + "from UserJpaEntity user "
            + "where lower(trim(user.email)) = lower(trim(:canonicalEmail))")
    boolean existsByCanonicalEmail(@Param("canonicalEmail") String canonicalEmail);

    @Query("select user from UserJpaEntity user "
            + "where (:search = '' or "
            + "lower(user.email) like lower(concat('%', :search, '%')) "
            + "or lower(coalesce(user.displayName, '')) like lower(concat('%', :search, '%'))) "
            + "and (:status is null or user.status = :status)")
    Page<UserJpaEntity> search(
            @Param("search") String search,
            @Param("status") UserStatus status,
            Pageable pageable);
}
