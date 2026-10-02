package com.weav.identity.infrastructure.persistence.mapper;

import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.infrastructure.persistence.entity.OAuthAccountJpaEntity;

public class OAuthAccountPersistenceMapper {

    public OAuthAccountJpaEntity toEntity(OAuthAccount account) {
        return new OAuthAccountJpaEntity(
                account.getId(),
                account.getUserId(),
                account.getProvider(),
                account.getProviderUserId(),
                account.getProviderEmail(),
                account.getCreatedAt(),
                account.getUpdatedAt());
    }

    public OAuthAccount toDomain(OAuthAccountJpaEntity entity) {
        return new OAuthAccount(
                entity.getId(),
                entity.getUserId(),
                entity.getProvider(),
                entity.getProviderUserId(),
                entity.getProviderEmail(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }
}
