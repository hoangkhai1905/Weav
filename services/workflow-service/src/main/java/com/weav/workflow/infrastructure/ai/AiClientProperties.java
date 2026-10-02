package com.weav.workflow.infrastructure.ai;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "weav.workflow.ai")
public record AiClientProperties(
        boolean enabled,
        boolean generationEnabled,
        URI baseUrl,
        String keyId,
        String privateKeyLocation,
        Duration connectTimeout,
        Duration readTimeout,
        Duration tokenLifetime,
        int maxResponseBytes) {

    public static final int MAX_RESPONSE_BYTES = 1_048_576;
    private static final Duration MAX_CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration MAX_READ_TIMEOUT = Duration.ofSeconds(70);
    private static final Duration MAX_TOKEN_LIFETIME = Duration.ofSeconds(120);

    public AiClientProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        Objects.requireNonNull(connectTimeout, "connectTimeout must not be null");
        Objects.requireNonNull(readTimeout, "readTimeout must not be null");
        Objects.requireNonNull(tokenLifetime, "tokenLifetime must not be null");
        validateBaseUrl(baseUrl);
        validateTimeout(connectTimeout, MAX_CONNECT_TIMEOUT, "connectTimeout");
        validateTimeout(readTimeout, MAX_READ_TIMEOUT, "readTimeout");
        if (tokenLifetime.isZero() || tokenLifetime.isNegative()
                || tokenLifetime.compareTo(MAX_TOKEN_LIFETIME) > 0
                || tokenLifetime.compareTo(readTimeout) < 0) {
            throw new IllegalArgumentException("tokenLifetime must be at least readTimeout and at most 120 seconds");
        }
        if (maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) {
            throw new IllegalArgumentException("maxResponseBytes must be between 1 and 1048576");
        }
    }

    private static void validateBaseUrl(URI value) {
        String scheme = value.getScheme();
        if (scheme == null || !(scheme.equalsIgnoreCase("http") || scheme.equalsIgnoreCase("https"))
                || value.getHost() == null || value.getHost().isBlank()
                || value.getUserInfo() != null || value.getQuery() != null || value.getFragment() != null
                || value.getPath() != null && !value.getPath().isEmpty() && !"/".equals(value.getPath())) {
            throw new IllegalArgumentException("baseUrl must be a private HTTP(S) service origin without a path");
        }
    }

    private static void validateTimeout(Duration value, Duration maximum, String name) {
        if (value.isZero() || value.isNegative() || value.compareTo(maximum) > 0) {
            throw new IllegalArgumentException(name + " must be positive and at most " + maximum.toSeconds() + " seconds");
        }
    }

    @Override
    public String toString() {
        return "AiClientProperties[enabled=" + enabled
                + ", generationEnabled=" + generationEnabled
                + ", baseUrl=" + baseUrl
                + ", keyId=" + (keyId == null || keyId.isBlank() ? "<unset>" : "<configured>")
                + ", privateKeyLocation=<redacted>, connectTimeout=" + connectTimeout
                + ", readTimeout=" + readTimeout + ", tokenLifetime=" + tokenLifetime
                + ", maxResponseBytes=" + maxResponseBytes + "]";
    }
}
