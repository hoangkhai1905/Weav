package com.weav.workspace.application.usecase;

import com.weav.workspace.application.dto.MyInvitationView;
import com.weav.workspace.application.dto.MyInvitationsView;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.validation.IdentityEmailNormalizer;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.UserInactiveException;
import com.weav.workspace.domain.model.IdentityUserSummary;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.IdentityDirectoryPort;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public final class ListMyInvitationsUseCase {

    private final WorkspaceInvitationRepository invitations;
    private final WorkspaceRepository workspaces;
    private final IdentityDirectoryPort identityDirectory;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public ListMyInvitationsUseCase(
            WorkspaceInvitationRepository invitations,
            WorkspaceRepository workspaces,
            IdentityDirectoryPort identityDirectory,
            TransactionRunner transactionRunner,
            Clock clock) {
        this.invitations = Objects.requireNonNull(invitations);
        this.workspaces = Objects.requireNonNull(workspaces);
        this.identityDirectory = Objects.requireNonNull(identityDirectory);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    private static final int LIMIT = 50;

    public MyInvitationsView execute(UUID callerId) {
        List<IdentityUserSummary> found = identityDirectory.getUsersByIds(List.of(callerId));
        if (found.isEmpty()) {
            return new MyInvitationsView(List.of(), false);
        }
        if (!found.get(0).active()) {
            throw new UserInactiveException();
        }
        if (!found.get(0).emailVerified()) {
            return new MyInvitationsView(List.of(), false);
        }
        String email;
        try {
            email = IdentityEmailNormalizer.canonicalize(found.get(0).email());
        } catch (BadRequestException exception) {
            return new MyInvitationsView(List.of(), true);
        }
        Instant now = clock.instant();
        // One transaction, two queries: live invitations, then their active workspaces in a single lookup.
        record Loaded(List<WorkspaceInvitation> live, Map<UUID, Workspace> workspaceById) {}
        Loaded loaded = transactionRunner.required(() -> {
            List<WorkspaceInvitation> live = invitations.listLivePendingByEmail(email, now, LIMIT);
            Map<UUID, Workspace> byId = workspaces.findAllByIds(
                            live.stream().map(WorkspaceInvitation::getWorkspaceId).distinct().toList())
                    .stream()
                    .collect(Collectors.toMap(Workspace::getId, Function.identity(), (a, b) -> a));
            return new Loaded(live, byId);
        });
        if (loaded.live().isEmpty()) {
            return new MyInvitationsView(List.of(), true);
        }
        Map<UUID, IdentityUserSummary> inviters = identityDirectory
                .getUsersByIds(loaded.live().stream().map(WorkspaceInvitation::getInvitedBy).distinct().toList())
                .stream()
                .collect(Collectors.toMap(IdentityUserSummary::userId, Function.identity(), (a, b) -> a));
        List<MyInvitationView> items = new ArrayList<>();
        for (WorkspaceInvitation invitation : loaded.live()) {
            // A soft-deleted workspace is absent from the map, so its invitations stay hidden.
            Workspace workspace = loaded.workspaceById().get(invitation.getWorkspaceId());
            if (workspace == null) {
                continue;
            }
            IdentityUserSummary inviter = inviters.get(invitation.getInvitedBy());
            String inviterName = inviter == null ? "Weav"
                    : inviter.displayName() != null && !inviter.displayName().isBlank()
                    ? inviter.displayName() : inviter.email();
            items.add(new MyInvitationView(invitation.getId(), invitation.getWorkspaceId(),
                    workspace.getName(), inviterName, invitation.getExpiresAt()));
        }
        return new MyInvitationsView(items, true);
    }
}
