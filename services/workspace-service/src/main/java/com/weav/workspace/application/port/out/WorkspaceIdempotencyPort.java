package com.weav.workspace.application.port.out;

import java.util.Optional;
import java.util.UUID;

/** WS-8: remembers which workspace a (user, Idempotency-Key) pair created. Joins the caller transaction. */
public interface WorkspaceIdempotencyPort {

    record Entry(UUID workspaceId, String requestHash) {
    }

    Optional<Entry> find(UUID userId, String key);

    /** Inserts the key; returns false when it already exists (a concurrent winner has committed). */
    boolean claim(UUID userId, String key, UUID workspaceId, String requestHash);
}
