package com.weav.identity.presentation.http.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RefreshTokenRequest(
        @NotBlank(message = "Refresh token is required")
        @Size(min = 43, max = 43, message = "Refresh token must contain 43 characters")
        @Pattern(regexp = "^[A-Za-z0-9_-]{43}$", message = "Refresh token is malformed")
        String refreshToken
) {

    @Override
    public String toString() {
        return "RefreshTokenRequest[refreshToken=[REDACTED]]";
    }
}
