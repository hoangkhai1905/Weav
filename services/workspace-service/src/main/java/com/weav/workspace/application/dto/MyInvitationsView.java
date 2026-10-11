package com.weav.workspace.application.dto;

import java.util.List;

/** Response of {@code GET /workspaces/invitations}. */
public record MyInvitationsView(List<MyInvitationView> items, boolean emailVerified) {
}
