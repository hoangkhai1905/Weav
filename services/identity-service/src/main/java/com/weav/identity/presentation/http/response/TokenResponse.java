package com.weav.identity.presentation.http.response;

import java.time.Instant;

public record TokenResponse(
        String accessToken,
        String refreshToken,
        String tokenType,
        long expiresIn,
        Instant refreshExpiresAt,
        UserResponse user
) {

    @Override
    public String toString() {
        return "TokenResponse[tokens=[REDACTED], userId="
                + (user == null ? "[NONE]" : user.id())
                + "]";
    }
}
