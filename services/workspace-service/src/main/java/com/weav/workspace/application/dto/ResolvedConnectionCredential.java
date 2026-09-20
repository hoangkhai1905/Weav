package com.weav.workspace.application.dto;

import com.weav.workspace.domain.valueobject.ConnectionAuthType;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Minimum internal runtime credential shape; Google refresh tokens are never included. */
public record ResolvedConnectionCredential(
        ConnectionProvider provider,
        ConnectionAuthType authType,
        Map<String, String> auth) {

    public ResolvedConnectionCredential {
        Objects.requireNonNull(provider, "provider must not be null");
        Objects.requireNonNull(authType, "authType must not be null");
        auth = Map.copyOf(Objects.requireNonNull(auth, "auth must not be null"));
        Set<String> expectedAuthKeys = switch (authType) {
            case NONE -> Set.of();
            case TOKEN -> Set.of("token");
            case API_KEY -> Set.of("apiKey");
            case BASIC -> Set.of("username", "password");
            case OAUTH2 -> Set.of("accessToken");
        };
        boolean validProvider = switch (authType) {
            case NONE, API_KEY, BASIC -> provider == ConnectionProvider.HTTP;
            case TOKEN -> provider == ConnectionProvider.HTTP || provider == ConnectionProvider.TELEGRAM;
            case OAUTH2 -> provider == ConnectionProvider.GMAIL || provider == ConnectionProvider.GOOGLE_SHEETS;
        };
        if (!auth.keySet().equals(expectedAuthKeys) || !validProvider) {
            throw new IllegalArgumentException("Resolved credential shape is invalid");
        }
    }

    @Override
    public String toString() {
        return "ResolvedConnectionCredential[provider=" + provider
                + ", authType=" + authType + ", auth=<redacted>]";
    }
}
