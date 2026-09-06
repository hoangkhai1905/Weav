package com.weav.identity.application.dto;

import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Instant;
import java.util.UUID;

public record AuthenticatedUserResult(
        UUID id,
        String email,
        String displayName,
        String avatarStorageKey,
        SystemRole systemRole,
        UserStatus status,
        Instant createdAt,
        Instant updatedAt
) {
    public static AuthenticatedUserResult from(User user) {
        return new AuthenticatedUserResult(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getAvatarStorageKey(),
                user.getSystemRole(),
                user.getStatus(),
                user.getCreatedAt(),
                user.getUpdatedAt()
        );
    }
}
