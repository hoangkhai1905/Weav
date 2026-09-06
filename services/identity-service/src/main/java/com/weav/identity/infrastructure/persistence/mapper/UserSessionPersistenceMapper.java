package com.weav.identity.infrastructure.persistence.mapper;

import com.weav.identity.domain.model.UserSession;
import com.weav.identity.infrastructure.persistence.entity.UserSessionJpaEntity;

public class UserSessionPersistenceMapper {

    public UserSessionJpaEntity toEntity(UserSession session) {
        return new UserSessionJpaEntity(
                session.getId(),
                session.getUserId(),
                session.getRefreshTokenHash(),
                session.getUserAgent(),
                session.getIpAddress(),
                session.getExpiresAt(),
                session.getRevokedAt(),
                session.getLastUsedAt(),
                session.getCreatedAt());
    }

    public UserSession toDomain(UserSessionJpaEntity entity) {
        return new UserSession(
                entity.getId(),
                entity.getUserId(),
                entity.getRefreshTokenHash(),
                entity.getUserAgent(),
                entity.getIpAddress(),
                entity.getExpiresAt(),
                entity.getRevokedAt(),
                entity.getLastUsedAt(),
                entity.getCreatedAt());
    }
}
