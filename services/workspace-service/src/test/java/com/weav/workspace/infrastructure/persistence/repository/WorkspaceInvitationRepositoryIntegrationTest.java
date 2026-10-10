package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.TestcontainersConfiguration;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.domain.exception.InvitationExistsException;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.model.WorkspaceInvitation;
import com.weav.workspace.domain.port.out.WorkspaceInvitationRepository;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Import(TestcontainersConfiguration.class)
@SpringBootTest
class WorkspaceInvitationRepositoryIntegrationTest {

    @Autowired
    private WorkspaceRepository workspaceRepository;
    @Autowired
    private WorkspaceInvitationRepository invitations;
    @Autowired
    private TransactionRunner transactionRunner;

    @Test
    void roundTripCountsListsAndRejectsASecondPendingRowForTheSameEmail() {
        UUID owner = UUID.randomUUID();
        Workspace workspace = transactionRunner.required(
                () -> workspaceRepository.save(Workspace.createNew("Invites", owner)));
        Instant now = Instant.now();

        WorkspaceInvitation first = transactionRunner.required(() -> invitations.save(
                WorkspaceInvitation.pending(workspace.getId(), "a@example.com", owner, now)));

        assertThat(invitations.findById(first.getId())).isPresent();
        assertThat(invitations.findPendingByWorkspaceAndEmail(workspace.getId(), "a@example.com")).isPresent();
        assertThat(invitations.countLivePendingByWorkspace(workspace.getId(), now)).isEqualTo(1);
        assertThat(invitations.countLivePendingByWorkspace(workspace.getId(), now.plus(java.time.Duration.ofDays(8)))).isZero();
        assertThat(invitations.countCreatedSince(workspace.getId(), now.minusSeconds(60))).isEqualTo(1);
        assertThat(invitations.countCreatedSince(workspace.getId(), now.plusSeconds(60))).isZero();
        assertThat(invitations.listLivePendingByEmail("a@example.com", now, 50)).extracting(WorkspaceInvitation::getId)
                .contains(first.getId());

        assertThatThrownBy(() -> transactionRunner.requiresNew(() -> invitations.save(
                WorkspaceInvitation.pending(workspace.getId(), "a@example.com", owner, now))))
                .isInstanceOf(InvitationExistsException.class);

        transactionRunner.required(() -> {
            WorkspaceInvitation stored = invitations.findById(first.getId()).orElseThrow();
            stored.revoke(now);
            invitations.save(stored);
            return invitations.save(WorkspaceInvitation.pending(workspace.getId(), "a@example.com", owner, now));
        });
        assertThat(invitations.countLivePendingByWorkspace(workspace.getId(), now)).isEqualTo(1);
        List<WorkspaceInvitation> listed = invitations.listPendingByWorkspace(workspace.getId(), 50);
        assertThat(listed).hasSize(1);
    }
}
