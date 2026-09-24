package com.weav.workflow.infrastructure.workspace;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "weav.workspace")
public record WorkspaceClientProperties(
        URI baseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        String internalServiceKey) {

    private static final int MAX_BASE_URL_LENGTH = 2048;
    private static final int MAX_SERVICE_KEY_LENGTH = 4096;
    private static final Duration MAX_TIMEOUT = Duration.ofSeconds(60);

    public WorkspaceClientProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        requireTimeout(connectTimeout, "connectTimeout");
        requireTimeout(readTimeout, "readTimeout");
        if (!baseUrl.isAbsolute()
                || baseUrl.getHost() == null
                || baseUrl.getUserInfo() != null
                || baseUrl.getRawQuery() != null
                || baseUrl.getRawFragment() != null
                || (!"http".equalsIgnoreCase(baseUrl.getScheme())
                && !"https".equalsIgnoreCase(baseUrl.getScheme()))) {
            throw new IllegalArgumentException("baseUrl must be an HTTP or HTTPS URL without credentials or query");
        }
        if (baseUrl.toString().length() > MAX_BASE_URL_LENGTH) {
            throw new IllegalArgumentException("baseUrl is too long");
        }
        if (internalServiceKey != null && internalServiceKey.length() > MAX_SERVICE_KEY_LENGTH) {
            throw new IllegalArgumentException("internalServiceKey is too long");
        }
    }

    public boolean hasServiceKey() {
        return internalServiceKey != null && !internalServiceKey.isBlank();
    }

    @Override
    public String toString() {
        return "WorkspaceClientProperties[baseUrl=" + baseUrl
                + ", connectTimeout=" + connectTimeout
                + ", readTimeout=" + readTimeout
                + ", internalServiceKey=<redacted>]";
    }

    private static void requireTimeout(Duration value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isZero() || value.isNegative() || value.compareTo(MAX_TIMEOUT) > 0) {
            throw new IllegalArgumentException(name + " must be positive and at most 60 seconds");
        }
    }
}
