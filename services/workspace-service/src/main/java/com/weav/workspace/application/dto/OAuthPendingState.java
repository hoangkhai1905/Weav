package com.weav.workspace.application.dto;

import com.weav.workspace.domain.valueobject.ConnectionProvider;

import java.util.Objects;
import java.util.UUID;

/** The non-secret state bound to a single Google OAuth callback. */
public record OAuthPendingState(
        UUID workspaceId,
        UUID connectionId,
        UUID userId,
        ConnectionProvider provider) {

    public OAuthPendingState {
        Objects.requireNonNull(workspaceId, "workspaceId must not be null");
        Objects.requireNonNull(connectionId, "connectionId must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        if (provider != ConnectionProvider.GMAIL && provider != ConnectionProvider.GOOGLE_SHEETS) {
            throw new IllegalArgumentException("OAuth provider is not supported");
        }
    }
}
