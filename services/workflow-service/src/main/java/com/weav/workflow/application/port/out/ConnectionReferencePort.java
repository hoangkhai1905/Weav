package com.weav.workflow.application.port.out;

import java.util.Set;
import java.util.UUID;

/** Transactional projection of draft and immutable-version connection references. */
public interface ConnectionReferencePort {

    void replaceDraft(UUID workflowId, Set<UUID> connections);

    /** Appends references for a published snapshot; existing versions must remain untouched. */
    void appendVersion(UUID workflowId, UUID versionId, Set<UUID> connections);

    /** Returns whether this workspace has any non-deleted draft or stored-version reference. */
    boolean inUse(UUID workspaceId, UUID connectionId);
}
