package com.weav.identity.presentation.http;

import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.presentation.http.request.LoginRequest;
import com.weav.identity.presentation.http.request.ChangePasswordRequest;
import com.weav.identity.presentation.http.request.ForgotPasswordRequest;
import com.weav.identity.presentation.http.request.OtpRequest;
import com.weav.identity.presentation.http.request.RefreshTokenRequest;
import com.weav.identity.presentation.http.request.RegisterUserRequest;
import com.weav.identity.presentation.http.request.ResetPasswordRequest;
import com.weav.identity.presentation.http.request.VerifyOtpRequest;
import com.weav.identity.presentation.http.response.TokenResponse;
import com.weav.identity.presentation.http.response.UserResponse;
import com.weav.identity.application.port.out.OtpChallengeStore;
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
        String otpCode = "123456";
        String resetGrant = "a".repeat(43);
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
                + new ChangePasswordRequest(password, "replacement-secret-password")
                + new RefreshTokenRequest(refreshToken)
                + new ForgotPasswordRequest(email)
                + new ResetPasswordRequest(resetGrant, password)
                + new VerifyOtpRequest(resetGrant, otpCode)
                + otpRequest(email)
                + new TokenResponse(accessToken, refreshToken, "Bearer", 900, now, user);

        assertTrue(combined.contains("[REDACTED]"));
        assertFalse(combined.contains(email));
        assertFalse(combined.contains(password));
        assertFalse(combined.contains("replacement-secret-password"));
        assertFalse(combined.contains(refreshToken));
        assertFalse(combined.contains(accessToken));
        assertFalse(combined.contains(otpCode));
        assertFalse(combined.contains(resetGrant));
        assertFalse(combined.contains("Private Name"));
    }

    private static OtpRequest otpRequest(String email) {
        OtpRequest request = new OtpRequest();
        request.setPurpose(OtpChallengeStore.Purpose.PASSWORD_RESET);
        request.setEmail(email);
        return request;
    }
}
