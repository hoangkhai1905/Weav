package com.weav.identity.infrastructure.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.util.Locale;

/**
 * Asymmetric access-token signing settings (ID-6). {@code alg} is HS256 (default) or RS256.
 * Key paths and ids are blank when unused; {@link JwtSigningKeys} validates them.
 */
@ConfigurationProperties(prefix = "weav.jwt-signing")
public record JwtSigningProperties(
        String alg,
        String keyLocation,
        String keyId,
        String previousPublicKeyLocation,
        String previousKeyId
) {
    public JwtSigningProperties {
        alg = alg == null || alg.isBlank() ? "HS256" : alg.trim().toUpperCase(Locale.ROOT);
        if (!alg.equals("HS256") && !alg.equals("RS256")) {
            throw new IllegalArgumentException("JWT_ACCESS_ALG must be HS256 or RS256");
        }
    }

    public boolean rs256() {
        return "RS256".equals(alg);
    }
}
