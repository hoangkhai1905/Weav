package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.persistence.entity.OAuthAccountJpaEntity;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpringDataOAuthAccountRepository extends JpaRepository<OAuthAccountJpaEntity, UUID> {

    Optional<OAuthAccountJpaEntity> findByProviderAndProviderUserId(
            OAuthProvider provider,
            String providerUserId);

    Optional<OAuthAccountJpaEntity> findByIdAndUserId(UUID id, UUID userId);

    List<OAuthAccountJpaEntity> findByUserIdOrderByCreatedAtAscIdAsc(UUID userId);

    @Modifying
    @Query("delete from OAuthAccountJpaEntity account "
            + "where account.id = :id and account.userId = :userId")
    int deleteByIdAndUserId(@Param("id") UUID id, @Param("userId") UUID userId);
}
