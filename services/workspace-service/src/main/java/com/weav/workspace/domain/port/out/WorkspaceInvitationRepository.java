package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.WorkspaceInvitation;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceInvitationRepository {
    /** Throws InvitationExistsException when a second PENDING row for (workspace, email) is inserted. */
    WorkspaceInvitation save(WorkspaceInvitation invitation);

    Optional<WorkspaceInvitation> findById(UUID id);

    Optional<WorkspaceInvitation> findPendingByWorkspaceAndEmail(UUID workspaceId, String canonicalEmail);

    /** PENDING rows that have not expired yet. */
    long countLivePendingByWorkspace(UUID workspaceId, Instant now);

    /** Invitations created (any status) at or after {@code since}; the abuse cap counts these. */
    long countCreatedSince(UUID workspaceId, Instant since);

    /** PENDING rows (live or expired), newest first. */
    List<WorkspaceInvitation> listPendingByWorkspace(UUID workspaceId, int limit);

    /** Live PENDING invitations for an e-mail, newest first. */
    List<WorkspaceInvitation> listLivePendingByEmail(String canonicalEmail, Instant now, int limit);
}
