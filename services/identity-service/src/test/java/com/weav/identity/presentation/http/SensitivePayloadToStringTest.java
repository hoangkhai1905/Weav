package com.weav.identity.presentation.http;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.presentation.http.request.LoginRequest;
import com.weav.identity.presentation.http.request.RefreshTokenRequest;
import com.weav.identity.presentation.http.request.RegisterUserRequest;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SensitivePayloadToStringTest {

    @Test
    void redactsCredentialsAndTokensFromRecordStringRepresentations() {
        String email = "secret-account@example.com";
        String password = "secret-password";
        String refreshToken = "secret-refresh-token";
        String accessToken = "secret-access-token";
        Instant now = Instant.parse("2026-09-05T10:00:00Z");
        UserResponse user = new UserResponse(
                UUID.randomUUID(),
                email,
                "Private Name",
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                now,
                now
        );

        String combined = new RegisterUserRequest(email, password, "Private Name")
                + new LoginRequest(email, password).toString()
                + new RefreshTokenRequest(refreshToken)
                + new TokenResponse(accessToken, refreshToken, "Bearer", 900, now, user);

        assertTrue(combined.contains("[REDACTED]"));
        assertFalse(combined.contains(email));
        assertFalse(combined.contains(password));
        assertFalse(combined.contains(refreshToken));
        assertFalse(combined.contains(accessToken));
        assertFalse(combined.contains("Private Name"));
    }
}
