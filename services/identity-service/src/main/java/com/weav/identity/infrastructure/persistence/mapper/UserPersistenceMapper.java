package com.weav.identity.infrastructure.persistence.mapper;

import com.weav.identity.domain.model.User;
import com.weav.identity.infrastructure.persistence.entity.UserJpaEntity;

public class UserPersistenceMapper {

    public UserJpaEntity toEntity(User user) {
        return new UserJpaEntity(
                user.getId(),
                user.getEmail(),
                user.getPasswordHash(),
                user.getDisplayName(),
                user.getAvatarStorageKey(),
                user.getSystemRole(),
                user.getStatus(),
                user.getCreatedAt(),
                user.getUpdatedAt());
    }

    public User toDomain(UserJpaEntity entity) {
        return new User(
                entity.getId(),
                entity.getEmail(),
                entity.getPasswordHash(),
                entity.getDisplayName(),
                entity.getAvatarStorageKey(),
                entity.getSystemRole(),
                entity.getStatus(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }
}
