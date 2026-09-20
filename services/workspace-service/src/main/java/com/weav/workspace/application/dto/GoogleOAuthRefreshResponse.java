package com.weav.workspace.application.dto;

import java.util.HashSet;
import java.util.List;
import java.util.Objects;

/** Validated Google refresh response; Google may omit the optional replacement refresh token. */
public record GoogleOAuthRefreshResponse(
        String accessToken,
        String refreshToken,
        String tokenType,
        List<String> grantedScopes,
        long expiresInSeconds) {

    private static final int MAX_TOKEN_LENGTH = 16 * 1024;
    private static final int MAX_SCOPE_COUNT = 64;
    private static final int MAX_SCOPE_LENGTH = 1024;
    private static final long MAX_ACCESS_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60;

    public GoogleOAuthRefreshResponse {
        accessToken = requireToken(accessToken);
        refreshToken = optionalToken(refreshToken);
        if (tokenType == null || !"Bearer".equalsIgnoreCase(tokenType)) {
            throw new IllegalArgumentException("Google token type is invalid");
        }
        tokenType = "Bearer";
        Objects.requireNonNull(grantedScopes, "grantedScopes must not be null");
        if (grantedScopes.isEmpty() || grantedScopes.size() > MAX_SCOPE_COUNT) {
            throw new IllegalArgumentException("Google granted scopes are invalid");
        }
        List<String> copiedScopes = List.copyOf(grantedScopes);
        if (copiedScopes.stream().anyMatch(scope -> scope.isBlank()
                || scope.length() > MAX_SCOPE_LENGTH
                || scope.codePoints().anyMatch(Character::isISOControl))
                || new HashSet<>(copiedScopes).size() != copiedScopes.size()) {
            throw new IllegalArgumentException("Google granted scopes are invalid");
        }
        grantedScopes = copiedScopes;
        if (expiresInSeconds <= 0 || expiresInSeconds > MAX_ACCESS_TOKEN_LIFETIME_SECONDS) {
            throw new IllegalArgumentException("Google token lifetime is invalid");
        }
    }

    @Override
    public String toString() {
        return "GoogleOAuthRefreshResponse[accessToken=<redacted>, refreshToken=<redacted>, tokenType="
                + tokenType + ", grantedScopeCount=" + grantedScopes.size()
                + ", expiresInSeconds=" + expiresInSeconds + "]";
    }

    private static String requireToken(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_TOKEN_LENGTH
                || value.codePoints().anyMatch(Character::isISOControl)) {
            throw new IllegalArgumentException("Google token is invalid");
        }
        return value;
    }

    private static String optionalToken(String value) {
        return value == null ? null : requireToken(value);
    }
}
