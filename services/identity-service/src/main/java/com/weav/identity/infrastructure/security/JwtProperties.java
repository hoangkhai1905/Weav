package com.weav.identity.infrastructure.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "weav.jwt")
public record JwtProperties(
        String accessSecret,
        String refreshSecret,
        String issuer,
        String audience,
        Duration accessExpiresIn,
        Duration refreshExpiresIn,
        Duration clockSkew
) {
    private static final int MINIMUM_HS256_KEY_BYTES = 32;

    public JwtProperties {
        requireText(accessSecret, "accessSecret");
        requireText(refreshSecret, "refreshSecret");
        requireText(issuer, "issuer");
        requireText(audience, "audience");
        requirePositive(accessExpiresIn, "accessExpiresIn");
        requirePositive(refreshExpiresIn, "refreshExpiresIn");
        Objects.requireNonNull(clockSkew, "clockSkew must not be null");
        if (clockSkew.isNegative()) {
            throw new IllegalArgumentException("clockSkew must not be negative");
        }
        if (accessSecret.getBytes(StandardCharsets.UTF_8).length < MINIMUM_HS256_KEY_BYTES) {
            throw new IllegalArgumentException("accessSecret must contain at least 32 UTF-8 bytes");
        }
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }

    private static void requirePositive(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
