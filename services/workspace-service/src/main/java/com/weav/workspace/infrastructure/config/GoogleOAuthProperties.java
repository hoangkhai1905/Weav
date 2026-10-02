package com.weav.workspace.infrastructure.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

@ConfigurationProperties(prefix = "weav.google.oauth")
public record GoogleOAuthProperties(
        String clientId,
        String clientSecret,
        URI redirectUri,
        URI frontendReturnUrl,
        Duration stateTtl) {

    private static final int MAX_CLIENT_ID_LENGTH = 512;
    private static final int MAX_CLIENT_SECRET_LENGTH = 4096;
    private static final int MAX_URI_LENGTH = 2048;
    private static final Duration MAX_STATE_TTL = Duration.ofHours(1);

    public GoogleOAuthProperties {
        clientId = clientId == null ? "" : clientId;
        clientSecret = clientSecret == null ? "" : clientSecret;
        if (clientId.length() > MAX_CLIENT_ID_LENGTH || containsControl(clientId)
                || clientSecret.length() > MAX_CLIENT_SECRET_LENGTH || containsControl(clientSecret)) {
            throw new IllegalArgumentException("Google OAuth client configuration is invalid");
        }
        validateConfiguredUri(redirectUri, "redirectUri");
        validateConfiguredUri(frontendReturnUrl, "frontendReturnUrl");
        Objects.requireNonNull(stateTtl, "stateTtl must not be null");
        if (stateTtl.compareTo(Duration.ofSeconds(1)) < 0 || stateTtl.compareTo(MAX_STATE_TTL) > 0) {
            throw new IllegalArgumentException("Google OAuth state TTL must be between one second and one hour");
        }
    }

    public boolean isConfigured() {
        return !clientId.isBlank() && !clientSecret.isBlank();
    }

    @Override
    public String toString() {
        return "GoogleOAuthProperties[clientId=<redacted>, clientSecret=<redacted>, redirectUri="
                + redirectUri + ", frontendReturnUrl=" + frontendReturnUrl
                + ", stateTtl=" + stateTtl + "]";
    }

    private static void validateConfiguredUri(URI uri, String fieldName) {
        Objects.requireNonNull(uri, fieldName + " must not be null");
        String scheme = uri.getScheme();
        if (!uri.isAbsolute()
                || uri.getHost() == null
                || uri.getUserInfo() != null
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null
                || uri.toString().length() > MAX_URI_LENGTH
                || containsControl(uri.toString())
                || (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme))
                || ("http".equalsIgnoreCase(scheme) && !isLoopbackHost(uri.getHost()))) {
            throw new IllegalArgumentException("Google OAuth " + fieldName + " is invalid");
        }
    }

    private static boolean isLoopbackHost(String host) {
        return "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equals(host)
                || "::1".equals(host)
                || "[::1]".equalsIgnoreCase(host);
    }

    private static boolean containsControl(String value) {
        return value.codePoints().anyMatch(Character::isISOControl);
    }
}
