package com.weav.workspace.application.dto;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/** The non-secret state bound to a single Google OAuth callback. */
public record OAuthPendingState(
        UUID workspaceId,
        UUID connectionId,
        UUID userId,
        ConnectionProvider provider,
        @JsonInclude(JsonInclude.Include.NON_NULL) String codeVerifier) {

    /** PKCE verifier alphabet and length per RFC 7636; absent only for pre-PKCE states. */
    private static final Pattern VERIFIER_SHAPE = Pattern.compile("[A-Za-z0-9_-]{43,128}");

    public OAuthPendingState(UUID workspaceId, UUID connectionId, UUID userId, ConnectionProvider provider) {
        this(workspaceId, connectionId, userId, provider, null);
    }

    public OAuthPendingState {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        if (provider == null || !provider.isGoogleOAuth()) {
            throw new IllegalArgumentException("OAuth provider is not supported");
        }
        if (codeVerifier != null && !VERIFIER_SHAPE.matcher(codeVerifier).matches()) {
            throw new IllegalArgumentException("OAuth code verifier is invalid");
        }
    }

    /** The PKCE verifier is a secret and must never reach logs. */
    @Override
    public String toString() {
        return "OAuthPendingState[workspaceId=" + workspaceId + ", connectionId=" + connectionId
                + ", userId=" + userId + ", provider=" + provider + ", codeVerifier=<redacted>]";
    }
}
