package com.weav.identity.application.dto;

import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Instant;
import java.util.UUID;

public record AdminUserResult(
        UUID id,
        String email,
        String displayName,
        SystemRole systemRole,
        UserStatus status,
        Instant createdAt,
        Instant updatedAt,
        Instant emailVerifiedAt,
        boolean avatarPresent
) {
    public static AdminUserResult from(User user) {
        return new AdminUserResult(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getSystemRole(),
                user.getStatus(),
                user.getCreatedAt(),
                user.getUpdatedAt(),
                user.getEmailVerifiedAt(),
                user.getAvatarStorageKey() != null && !user.getAvatarStorageKey().isBlank());
    }
}
