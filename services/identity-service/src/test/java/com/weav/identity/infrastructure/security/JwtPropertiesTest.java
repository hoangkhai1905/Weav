package com.weav.identity.infrastructure.security;

import org.junit.jupiter.api.Test;

import java.time.Duration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JwtPropertiesTest {

    private static final String VALID_ACCESS_SECRET = "0123456789abcdef0123456789abcdef";
    private static final String VALID_REFRESH_SECRET = "refresh-secret";

    @Test
    void rejectsAccessSecretShorterThanThirtyTwoUtf8Bytes() {
        assertThrows(IllegalArgumentException.class, () -> properties(
                "short-secret",
                Duration.ofMinutes(15),
                Duration.ofDays(7),
                Duration.ofSeconds(30)
        ));
    }

    @Test
    void rejectsNonPositiveTokenDurations() {
        assertThrows(IllegalArgumentException.class, () -> properties(
                VALID_ACCESS_SECRET,
                Duration.ZERO,
                Duration.ofDays(7),
                Duration.ofSeconds(30)
        ));
        assertThrows(IllegalArgumentException.class, () -> properties(
                VALID_ACCESS_SECRET,
                Duration.ofMinutes(15),
                Duration.ofSeconds(-1),
                Duration.ofSeconds(30)
        ));
    }

    @Test
    void rejectsNegativeClockSkew() {
        assertThrows(IllegalArgumentException.class, () -> properties(
                VALID_ACCESS_SECRET,
                Duration.ofMinutes(15),
                Duration.ofDays(7),
                Duration.ofMillis(-1)
        ));
    }

    @Test
    void acceptsValidConfigurationIncludingZeroClockSkew() {
        JwtProperties properties = properties(
                VALID_ACCESS_SECRET,
                Duration.ofMinutes(15),
                Duration.ofDays(7),
                Duration.ZERO
        );

        assertEquals(VALID_ACCESS_SECRET, properties.accessSecret());
        assertEquals(VALID_REFRESH_SECRET, properties.refreshSecret());
        assertEquals("weav-identity", properties.issuer());
        assertEquals("weav-clients", properties.audience());
        assertEquals(Duration.ofMinutes(15), properties.accessExpiresIn());
        assertEquals(Duration.ofDays(7), properties.refreshExpiresIn());
        assertEquals(Duration.ZERO, properties.clockSkew());
    }

    private static JwtProperties properties(
            String accessSecret,
            Duration accessExpiresIn,
            Duration refreshExpiresIn,
            Duration clockSkew
    ) {
        return new JwtProperties(
                accessSecret,
                VALID_REFRESH_SECRET,
                "weav-identity",
                "weav-clients",
                accessExpiresIn,
                refreshExpiresIn,
                clockSkew
        );
    }
}
