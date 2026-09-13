package com.weav.workspace.domain.model;

import java.util.Objects;
import java.util.UUID;

/**
 * The small Identity-owned profile shape needed by Workspace boundaries.
 * Workspace deliberately does not persist any of these fields.
 */
public record IdentityUserSummary(
        UUID userId,
        String email,
        String displayName,
        boolean active) {

    public IdentityUserSummary {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(email, "email must not be null");
    }
}
