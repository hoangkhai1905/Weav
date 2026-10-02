package com.weav.identity.application.dto;

import com.weav.identity.domain.model.User;
import com.weav.identity.domain.valueobject.UserStatus;

import java.util.UUID;

public record UserDirectorySummary(
        UUID userId,
        String email,
        String displayName,
        boolean active) {

    public static UserDirectorySummary from(User user) {
        return new UserDirectorySummary(
                user.getId(),
                user.getEmail(),
                user.getDisplayName(),
                user.getStatus() == UserStatus.ACTIVE);
    }
}
