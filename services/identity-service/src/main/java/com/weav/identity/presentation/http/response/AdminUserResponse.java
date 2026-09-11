package com.weav.identity.presentation.http.response;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Instant;
import java.util.UUID;

public record AdminUserResponse(
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
}
