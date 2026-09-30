package com.weav.workspace.application.usecase;

import com.weav.workspace.application.notification.WorkspaceNotificationRecorder;
import com.weav.workspace.application.port.out.WorkspaceMutationLock;
import com.weav.workspace.domain.model.Workspace;
import com.weav.workspace.domain.port.out.WorkspaceRepository;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** Explicit test-only fakes for usecase tests that are not exercising persistence or outbox behavior. */
final class WorkspaceNotificationTestFixtures {
    private static final Instant NOW = Instant.parse("2026-01-02T03:04:05Z");

    private WorkspaceNotificationTestFixtures() {}

    static WorkspaceNotificationRecorder recorder() {
        return new WorkspaceNotificationRecorder(event -> {}, Clock.fixed(NOW, ZoneOffset.UTC));
    }

    static WorkspaceMutationLock unlocked() {
        return workspaceId -> {};
    }

    static WorkspaceRepository workspaceRepository(UUID workspaceId, UUID ownerId) {
        WorkspaceRepository repository = mock(WorkspaceRepository.class);
        Workspace workspace = new Workspace(workspaceId, "Test workspace", ownerId, NOW, NOW);
        when(repository.findById(workspaceId)).thenReturn(Optional.of(workspace));
        return repository;
    }
}
