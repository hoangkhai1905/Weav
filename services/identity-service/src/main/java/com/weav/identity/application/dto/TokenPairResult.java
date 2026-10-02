package com.weav.identity.application.dto;

import java.time.Instant;

public record TokenPairResult(
        String accessToken,
        String refreshToken,
        String tokenType,
        long expiresIn,
        Instant refreshExpiresAt,
        AuthenticatedUserResult user
) {
}
