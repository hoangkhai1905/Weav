package com.weav.workspace.infrastructure.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JwtAccessTokenValidatorTest {

    private static final Instant NOW = Instant.parse("2026-09-13T12:00:00Z");
    private static final UUID USER_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID SESSION_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID TOKEN_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");

    private final JwtProperties properties = new JwtProperties(
            "weav-test-access-secret-0123456789abcdef",
            "weav-test-refresh-secret-0123456789abcdef",
            "weav-identity",
            "weav-api",
            Duration.ofMinutes(15),
            Duration.ofDays(7),
            Duration.ofSeconds(30));

    private final JwtAccessTokenValidator validator = new JwtAccessTokenValidator(
            properties,
            Clock.fixed(NOW, ZoneOffset.UTC));

    @Test
    void acceptsIdentityAccessClaims() {
        assertFalse(validator.validate(token("access", USER_ID.toString(), NOW.minusSeconds(1), NOW.plusSeconds(60)))
                .hasErrors());
    }

    @Test
    void rejectsRefreshUseExpiredAndNonUuidSubjects() {
        assertTrue(validator.validate(token("refresh", USER_ID.toString(), NOW.minusSeconds(1), NOW.plusSeconds(60)))
                .hasErrors());
        assertTrue(validator.validate(token("access", USER_ID.toString(), NOW.minusSeconds(120), NOW.minusSeconds(31)))
                .hasErrors());
        assertTrue(validator.validate(token("access", "not-a-uuid", NOW.minusSeconds(1), NOW.plusSeconds(60)))
                .hasErrors());
        assertTrue(validator.validate(token(
                "access", USER_ID.toString(), NOW.minusSeconds(1), NOW.plusSeconds(60), "SUPERUSER", "ACTIVE"))
                .hasErrors());
    }

    private Jwt token(String tokenUse, String subject, Instant issuedAt, Instant expiresAt) {
        return token(tokenUse, subject, issuedAt, expiresAt, "USER", "ACTIVE");
    }

    private Jwt token(
            String tokenUse,
            String subject,
            Instant issuedAt,
            Instant expiresAt,
            String systemRole,
            String userStatus) {
        return Jwt.withTokenValue("test-token")
                .header("alg", "HS256")
                .issuer(properties.issuer())
                .subject(subject)
                .audience(List.of(properties.audience()))
                .issuedAt(issuedAt)
                .notBefore(issuedAt)
                .expiresAt(expiresAt)
                .jti(TOKEN_ID.toString())
                .claim(JwtAccessTokenValidator.SESSION_ID_CLAIM, SESSION_ID.toString())
                .claim(JwtAccessTokenValidator.SYSTEM_ROLE_CLAIM, systemRole)
                .claim(JwtAccessTokenValidator.USER_STATUS_CLAIM, userStatus)
                .claim(JwtAccessTokenValidator.TOKEN_USE_CLAIM, tokenUse)
                .build();
    }
}
