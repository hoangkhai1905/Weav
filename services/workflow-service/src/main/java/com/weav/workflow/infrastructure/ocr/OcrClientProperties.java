package com.weav.workflow.infrastructure.ocr;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

/** Configuration for the private OCR adapter. Every source and remote-security gate defaults closed. */
@ConfigurationProperties(prefix = "weav.workflow.ocr")
public record OcrClientProperties(
        boolean enabled,
        boolean urlSourceEnabled,
        boolean artifactSourceEnabled,
        boolean serviceClaimsVerified,
        boolean urlAllowlistVerified,
        boolean artifactResolverVerified,
        URI baseUrl,
        String keyId,
        String privateKeyLocation,
        Duration connectTimeout,
        Duration readTimeout,
        Duration tokenLifetime,
        int maxResponseBytes) {

    public static final int MAX_RESPONSE_BYTES = 1_048_576;
    private static final Duration MAX_CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final Duration MAX_READ_TIMEOUT = Duration.ofSeconds(30);
    private static final Duration MAX_TOKEN_LIFETIME = Duration.ofSeconds(120);

    public OcrClientProperties {
        Objects.requireNonNull(baseUrl, "baseUrl must not be null");
        Objects.requireNonNull(connectTimeout, "connectTimeout must not be null");
        Objects.requireNonNull(readTimeout, "readTimeout must not be null");
        Objects.requireNonNull(tokenLifetime, "tokenLifetime must not be null");
        validateBaseUrl(baseUrl);
        validateTimeout(connectTimeout, MAX_CONNECT_TIMEOUT, "connectTimeout");
        validateTimeout(readTimeout, MAX_READ_TIMEOUT, "readTimeout");
        if (tokenLifetime.isZero() || tokenLifetime.isNegative()
                || tokenLifetime.compareTo(MAX_TOKEN_LIFETIME) > 0) {
            throw new IllegalArgumentException("tokenLifetime must be positive and at most 120 seconds");
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
        return "OcrClientProperties[enabled=" + enabled
                + ", urlSourceEnabled=" + urlSourceEnabled
                + ", artifactSourceEnabled=" + artifactSourceEnabled
                + ", serviceClaimsVerified=" + serviceClaimsVerified
                + ", urlAllowlistVerified=" + urlAllowlistVerified
                + ", artifactResolverVerified=" + artifactResolverVerified
                + ", baseUrl=" + baseUrl
                + ", keyId=" + (keyId == null || keyId.isBlank() ? "<unset>" : "<configured>")
                + ", privateKeyLocation=<redacted>, connectTimeout=" + connectTimeout
                + ", readTimeout=" + readTimeout + ", tokenLifetime=" + tokenLifetime
                + ", maxResponseBytes=" + maxResponseBytes + "]";
    }
}
