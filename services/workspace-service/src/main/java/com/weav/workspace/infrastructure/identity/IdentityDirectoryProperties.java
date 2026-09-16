package com.weav.workspace.infrastructure.identity;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "weav.identity")
public record IdentityDirectoryProperties(
        URI baseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        String internalServiceKey) {

    public IdentityDirectoryProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        Objects.requireNonNull(connectTimeout, "connectTimeout must not be null");
        Objects.requireNonNull(readTimeout, "readTimeout must not be null");
        if (!baseUrl.isAbsolute()) {
            throw new IllegalArgumentException("baseUrl must be absolute");
        }
        requirePositive(connectTimeout, "connectTimeout");
        requirePositive(readTimeout, "readTimeout");
    }

    public boolean hasServiceKey() {
        return internalServiceKey != null && !internalServiceKey.isBlank();
    }

    private static void requirePositive(Duration value, String name) {
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
