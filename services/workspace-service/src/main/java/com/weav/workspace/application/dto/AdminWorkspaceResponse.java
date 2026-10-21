package com.weav.workspace.application.dto;

import com.weav.workspace.domain.model.AdminWorkspaceRow;
import com.weav.workspace.domain.model.IdentityUserSummary;

import java.time.Instant;
import java.util.UUID;

/** Owner email/display name come from Identity and are null when the lookup fails or the user is unknown. */
public record AdminWorkspaceResponse(
        UUID id,
        String name,
        UUID ownerId,
        String ownerEmail,
        String ownerDisplayName,
        long memberCount,
        Instant createdAt) {

    public static AdminWorkspaceResponse from(AdminWorkspaceRow row, IdentityUserSummary owner) {
        return new AdminWorkspaceResponse(
                row.workspace().getId(),
                row.workspace().getName(),
                row.workspace().getCreatedBy(),
                owner == null ? null : owner.email(),
                owner == null ? null : owner.displayName(),
                row.memberCount(),
                row.workspace().getCreatedAt());
    }
}
