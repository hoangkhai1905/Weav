package com.weav.workspace.application.dto;

import java.time.Instant;
import java.util.UUID;

/** JSON shape {@code MyInvitation}: what the invitee sees; never exposes other e-mail addresses. */
public record MyInvitationView(
        UUID id,
        UUID workspaceId,
        String workspaceName,
        String invitedByName,
        Instant expiresAt) {
}
