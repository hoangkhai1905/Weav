package com.weav.workspace.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "weav.workflow")
public record WorkflowServiceProperties(
        URI baseUrl,
        Duration connectTimeout,
        Duration readTimeout,
        String internalServiceKey) {

    private static final int MAX_BASE_URL_LENGTH = 2048;
    private static final int MAX_SERVICE_KEY_LENGTH = 4096;

    public WorkflowServiceProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        Objects.requireNonNull(connectTimeout, "connectTimeout must not be null");
        Objects.requireNonNull(readTimeout, "readTimeout must not be null");
        if (!baseUrl.isAbsolute()
                || baseUrl.getHost() == null
                || baseUrl.getUserInfo() != null
                || baseUrl.getRawQuery() != null
                || baseUrl.getRawFragment() != null
                || (!"http".equalsIgnoreCase(baseUrl.getScheme())
                && !"https".equalsIgnoreCase(baseUrl.getScheme()))) {
            throw new IllegalArgumentException("baseUrl must be an HTTP or HTTPS origin without credentials or query");
        }
        if (baseUrl.toString().length() > MAX_BASE_URL_LENGTH) {
            throw new IllegalArgumentException("baseUrl is too long");
        }
        requirePositive(connectTimeout, "connectTimeout");
        requirePositive(readTimeout, "readTimeout");
        if (internalServiceKey != null && internalServiceKey.length() > MAX_SERVICE_KEY_LENGTH) {
            throw new IllegalArgumentException("internalServiceKey is too long");
        }
    }

    public boolean hasServiceKey() {
        return internalServiceKey != null && !internalServiceKey.isBlank();
    }

    @Override
    public String toString() {
        return "WorkflowServiceProperties[baseUrl=" + baseUrl
                + ", connectTimeout=" + connectTimeout
                + ", readTimeout=" + readTimeout
                + ", internalServiceKey=<redacted>]";
    }

    private static void requirePositive(Duration value, String name) {
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
