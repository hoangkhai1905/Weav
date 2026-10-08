package com.weav.workspace.application.usecase;

import com.weav.workspace.application.notification.WorkspaceNotificationEvent;
import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.AfterCommitExecutor;
import com.weav.workspace.application.port.out.TransactionRunner;
import com.weav.workspace.application.port.out.WorkflowShutdownPort;
import com.weav.workspace.domain.exception.BadRequestException;
import com.weav.workspace.domain.exception.DependencyUnavailableException;
import com.weav.workspace.domain.exception.ForbiddenException;
import com.weav.workspace.domain.exception.ResourceNotFoundException;
import com.weav.workspace.domain.model.Membership;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.ConnectionRepository;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.domain.port.out.MembershipRepository;
import com.weav.workspace.domain.port.out.WorkspaceAuthorizationCache;
import com.weav.workspace.domain.port.out.WorkspaceRepository;
import com.weav.workspace.domain.valueobject.WorkspaceStatus;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DeleteWorkspaceUseCaseTest {

    private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-0000000000a1");
    private static final UUID MEMBER = UUID.fromString("00000000-0000-0000-0000-0000000000a2");
    private static final UUID MEMBER_2 = UUID.fromString("00000000-0000-0000-0000-0000000000a3");
    private static final UUID WORKSPACE_ID = UUID.fromString("10000000-0000-0000-0000-0000000000a1");
    private static final Instant NOW = Instant.parse("2026-10-08T00:00:00Z");

    private final WorkspaceRepository workspaces = mock(WorkspaceRepository.class);
    private final MembershipRepository memberships = mock(MembershipRepository.class);
    private final ConnectionRepository connections = mock(ConnectionRepository.class);
    private final CredentialRepository credentials = mock(CredentialRepository.class);
    private final WorkflowShutdownPort shutdown = mock(WorkflowShutdownPort.class);
    private final WorkspaceAuthorizationCache cache = mock(WorkspaceAuthorizationCache.class);
    private final List<WorkspaceNotificationEvent> events = new ArrayList<>();
    private final List<Runnable> afterCommit = new ArrayList<>();
    private DeleteWorkspaceUseCase useCase;
    private Workspace workspace;

    @BeforeEach
    void setUp() {
        workspace = new Workspace(WORKSPACE_ID, "Acme Corp", OWNER, NOW, NOW);
        when(workspaces.findById(WORKSPACE_ID)).thenReturn(Optional.of(workspace));
        when(workspaces.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, OWNER))
                .thenReturn(Optional.of(Membership.owner(WORKSPACE_ID, OWNER)));
        when(memberships.findByWorkspaceIdAndUserId(WORKSPACE_ID, MEMBER))
                .thenReturn(Optional.of(Membership.member(WORKSPACE_ID, MEMBER)));
        when(memberships.findUserIdsByWorkspaceId(WORKSPACE_ID)).thenReturn(List.of(OWNER, MEMBER, MEMBER_2));
        when(shutdown.pauseAll(WORKSPACE_ID)).thenReturn(new WorkflowShutdownPort.PauseAllResult(2, 0, 0, 0));
        AfterCommitExecutor afterCommitExecutor = afterCommit::add;
        TransactionRunner transactions = new TransactionRunner() {
            @Override
            public <T> T required(Supplier<T> work) {
                return work.get();
            }

            @Override
            public <T> T requiresNew(Supplier<T> work) {
                return work.get();
            }
        };
        useCase = new DeleteWorkspaceUseCase(workspaces, memberships, connections, credentials, transactions,
                workspaceId -> { },
                new WorkspaceNotificationRecorder(events::add, Clock.fixed(NOW, ZoneOffset.UTC)),
                shutdown, afterCommitExecutor, cache);
    }

    @Test
    void ownerDeletesWithTheTypedNameAfterPausingWorkflowsAndNotifiesOnlyTheOtherMembers() {
        useCase.execute(OWNER, WORKSPACE_ID, "  acme CORP ");

        InOrder order = inOrder(shutdown, workspaces, connections, credentials);
        order.verify(shutdown).pauseAll(WORKSPACE_ID);
        order.verify(workspaces).save(workspace);
        order.verify(connections).disableAllByWorkspaceId(WORKSPACE_ID);
        order.verify(credentials).deleteAllByWorkspaceId(WORKSPACE_ID);
        assertEquals(WorkspaceStatus.DELETED, workspace.getStatus());
        assertEquals(OWNER, workspace.getDeletedBy());
        assertEquals(1, events.size());
        assertEquals("workspace.deleted", events.getFirst().eventType());
        assertEquals(List.of(MEMBER, MEMBER_2), events.getFirst().recipientUserIds());
        assertTrue(!events.getFirst().recipientUserIds().contains(OWNER));

        verify(cache, never()).evict(any(), any());
        verify(shutdown, times(1)).pauseAll(WORKSPACE_ID); // the second call waits for the commit
        afterCommit.forEach(Runnable::run);
        verify(shutdown, times(2)).pauseAll(WORKSPACE_ID);
        verify(cache).evict(WORKSPACE_ID, OWNER);
        verify(cache).evict(WORKSPACE_ID, MEMBER);
        verify(cache).evict(WORKSPACE_ID, MEMBER_2);
    }

    @Test
    void wrongNameIsBadRequestAndNothingIsStopped() {
        assertThrows(BadRequestException.class, () -> useCase.execute(OWNER, WORKSPACE_ID, "Acme"));
        assertThrows(BadRequestException.class, () -> useCase.execute(OWNER, WORKSPACE_ID, "   "));

        verifyNoInteractions(shutdown, connections, credentials);
        verify(workspaces, never()).save(any());
    }

    @Test
    void nonOwnerIsForbiddenAndNonMemberIsNotFound() {
        assertThrows(ForbiddenException.class, () -> useCase.execute(MEMBER, WORKSPACE_ID, "Acme Corp"));
        assertThrows(ResourceNotFoundException.class,
                () -> useCase.execute(UUID.randomUUID(), WORKSPACE_ID, "Acme Corp"));

        verifyNoInteractions(shutdown, connections, credentials);
    }

    @Test
    void aFailingSecondPauseAfterCommitIsOnlyLoggedAndTheDeleteStands() {
        when(shutdown.pauseAll(WORKSPACE_ID))
                .thenReturn(new WorkflowShutdownPort.PauseAllResult(2, 0, 0, 0))
                .thenThrow(new DependencyUnavailableException());

        useCase.execute(OWNER, WORKSPACE_ID, "Acme Corp");
        afterCommit.forEach(Runnable::run); // must not throw

        verify(shutdown, times(2)).pauseAll(WORKSPACE_ID);
        assertEquals(WorkspaceStatus.DELETED, workspace.getStatus());
        verify(cache).evict(WORKSPACE_ID, MEMBER);
    }

    @Test
    void aWorkflowThatCouldNotBePausedAbortsTheDeleteBeforeAnyChange() {
        when(shutdown.pauseAll(WORKSPACE_ID)).thenReturn(new WorkflowShutdownPort.PauseAllResult(1, 0, 0, 1));

        assertThrows(DependencyUnavailableException.class, () -> useCase.execute(OWNER, WORKSPACE_ID, "Acme Corp"));

        verify(workspaces, never()).save(any());
        verifyNoInteractions(connections, credentials);
        assertTrue(afterCommit.isEmpty());
    }

    @Test
    void whenPausingWorkflowsFailsNothingIsChanged() {
        when(shutdown.pauseAll(WORKSPACE_ID)).thenThrow(new DependencyUnavailableException());

        assertThrows(DependencyUnavailableException.class, () -> useCase.execute(OWNER, WORKSPACE_ID, "Acme Corp"));

        verify(workspaces, never()).save(any());
        verifyNoInteractions(connections, credentials);
        assertEquals(WorkspaceStatus.ACTIVE, workspace.getStatus());
        assertTrue(events.isEmpty());
        assertTrue(afterCommit.isEmpty());
    }
}
