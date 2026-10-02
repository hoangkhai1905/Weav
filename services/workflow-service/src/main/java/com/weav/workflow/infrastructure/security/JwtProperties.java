package com.weav.workflow.infrastructure.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.nio.charset.StandardCharsets;
import java.time.Duration;

@ConfigurationProperties(prefix = "weav.jwt")
public record JwtProperties(String accessSecret, String issuer, String audience, Duration clockSkew) {

    private static final int MINIMUM_HS256_KEY_BYTES = 32;

    public JwtProperties {
        requireText(accessSecret, "accessSecret");
        requireText(issuer, "issuer");
        requireText(audience, "audience");
        if (accessSecret.getBytes(StandardCharsets.UTF_8).length < MINIMUM_HS256_KEY_BYTES) {
            throw new IllegalArgumentException("accessSecret must contain at least 32 UTF-8 bytes");
        }
        if (clockSkew == null || clockSkew.isNegative()) {
            throw new IllegalArgumentException("clockSkew must not be negative or null");
        }
    }

    private static void requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
    }

    @Override
    public String toString() {
        return "JwtProperties[accessSecret=<redacted>, issuer=" + issuer
                + ", audience=" + audience + ", clockSkew=" + clockSkew + "]";
    }
}
