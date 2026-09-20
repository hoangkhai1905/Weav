package com.weav.workspace.domain.port.out;

import com.weav.workspace.domain.model.Credential;
import java.util.Optional;
import java.util.UUID;

public interface CredentialRepository {
    Credential save(Credential credential);

    Optional<Credential> findByConnectionId(UUID connectionId);

    void deleteByConnectionId(UUID connectionId);
}
