package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Credential;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface CredentialRepository {
    Credential save(Credential credential);

    Optional<Credential> findByConnectionId(UUID connectionId);

    List<Credential> findAllByConnectionIdIn(Collection<UUID> connectionIds);

    /** Same read with a row lock held until the surrounding transaction ends. */
    Optional<Credential> findByConnectionIdForUpdate(UUID connectionId);

    void deleteByConnectionId(UUID connectionId);

    /** Deletes every credential of the workspace's connections (workspace delete); returns the rows removed. */
    int deleteAllByWorkspaceId(UUID workspaceId);
}
