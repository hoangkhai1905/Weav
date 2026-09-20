package com.weav.workspace.application.service;

import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/** Exact, provider-specific V1 Google OAuth scope allow-list. */
public final class GoogleOAuthScopePolicy {

    private static final String EMAIL_SCOPE = "email";
    private static final String USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
    private static final List<String> GMAIL_SCOPES = List.of(
            "openid",
            EMAIL_SCOPE,
            "https://www.googleapis.com/auth/gmail.metadata");
    private static final List<String> SHEETS_SCOPES = List.of(
            "openid",
            EMAIL_SCOPE,
            "https://www.googleapis.com/auth/spreadsheets");

    public List<String> requiredScopes(ConnectionProvider provider) {
        if (provider == ConnectionProvider.GMAIL) {
            return GMAIL_SCOPES;
        }
        if (provider == ConnectionProvider.GOOGLE_SHEETS) {
            return SHEETS_SCOPES;
        }
        throw new BadRequestException("Google OAuth provider is not supported");
    }

    public boolean containsRequiredScopes(ConnectionProvider provider, Collection<String> grantedScopes) {
        if (grantedScopes == null) {
            return false;
        }
        try {
            Set<String> normalizedGrantedScopes = new HashSet<>();
            for (String scope : grantedScopes) {
                if (scope != null) {
                    normalizedGrantedScopes.add(normalizeGrantedScope(scope));
                }
            }
            return normalizedGrantedScopes.containsAll(requiredScopes(provider));
        } catch (BadRequestException exception) {
            return false;
        }
    }

    private String normalizeGrantedScope(String scope) {
        return USERINFO_EMAIL_SCOPE.equals(scope) ? EMAIL_SCOPE : scope;
    }

    public void requireRequiredScopes(ConnectionProvider provider, Collection<String> grantedScopes) {
        Objects.requireNonNull(provider, "provider must not be null");
        if (!containsRequiredScopes(provider, grantedScopes)) {
            throw new BadRequestException("Google did not grant the required access");
        }
    }
}
