package com.weav.workspace.application.dto;

import com.weav.workspace.domain.model.WorkspaceInvitation;

import java.time.Instant;
import java.util.UUID;

/** JSON shape {@code OwnerInvitation}; status is PENDING, EXPIRED, ACCEPTED, DECLINED or REVOKED. */
public record OwnerInvitationView(
        UUID id,
        UUID workspaceId,
        String email,
        String status,
        UUID invitedBy,
        Instant createdAt,
        Instant expiresAt,
        Instant lastSentAt) {

    public static OwnerInvitationView from(WorkspaceInvitation invitation, Instant now) {
        return new OwnerInvitationView(
                invitation.getId(),
                invitation.getWorkspaceId(),
                invitation.getEmail(),
                invitation.viewStatus(now),
                invitation.getInvitedBy(),
                invitation.getCreatedAt(),
                invitation.getExpiresAt(),
                invitation.getLastSentAt());
    }
}
