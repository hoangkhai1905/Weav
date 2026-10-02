package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.WorkspaceAccessSnapshot;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

public interface WorkspaceAuthorizationCache {

    Optional<WorkspaceAccessSnapshot> get(UUID workspaceId, UUID userId);

    void put(WorkspaceAccessSnapshot snapshot, Duration ttl);

    void evict(UUID workspaceId, UUID userId);

    /**
     * Reads or creates the current cache generation for one authorization subject.
     * Implementations must treat an unavailable cache as a miss.
     */
    Optional<String> readGeneration(UUID workspaceId, UUID userId, Duration ttl);

    /**
     * Publishes a snapshot only while the expected generation is current.
     * A fenced or unavailable cache must return {@code false}.
     */
    boolean putIfGenerationMatches(
            WorkspaceAccessSnapshot snapshot,
            Duration ttl,
            String expectedGeneration);
}
