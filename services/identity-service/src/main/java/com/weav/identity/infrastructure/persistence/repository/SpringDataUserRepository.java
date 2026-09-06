package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.infrastructure.persistence.entity.UserJpaEntity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataUserRepository extends JpaRepository<UserJpaEntity, UUID> {

    @Query("select user from UserJpaEntity user "
            + "where lower(trim(user.email)) = lower(trim(:canonicalEmail))")
    Optional<UserJpaEntity> findByCanonicalEmail(@Param("canonicalEmail") String canonicalEmail);

    @Query("select case when count(user) > 0 then true else false end "
            + "from UserJpaEntity user "
            + "where lower(trim(user.email)) = lower(trim(:canonicalEmail))")
    boolean existsByCanonicalEmail(@Param("canonicalEmail") String canonicalEmail);
}
