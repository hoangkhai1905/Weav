package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Credential;
import java.util.Optional;
import java.util.UUID;

public interface CredentialRepository {
    Credential save(Credential credential);

    Optional<Credential> findByConnectionId(UUID connectionId);

    /** Same read with a row lock held until the surrounding transaction ends. */
    Optional<Credential> findByConnectionIdForUpdate(UUID connectionId);

    void deleteByConnectionId(UUID connectionId);
}
