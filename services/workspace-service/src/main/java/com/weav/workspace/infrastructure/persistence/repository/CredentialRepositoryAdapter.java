package com.weav.workspace.infrastructure.persistence.repository;

import com.weav.workspace.domain.model.Credential;
import com.weav.workspace.domain.port.out.CredentialRepository;
import com.weav.workspace.infrastructure.persistence.entity.CredentialJpaEntity;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public class CredentialRepositoryAdapter implements CredentialRepository {

    private final SpringDataCredentialRepository repository;

    public CredentialRepositoryAdapter(SpringDataCredentialRepository repository) {
        this.repository = repository;
    }

    @Override
    public Credential save(Credential credential) {
        CredentialJpaEntity entity = new CredentialJpaEntity(
                credential.getId(),
                credential.getConnectionId(),
                credential.getEncryptedPayload(),
                credential.getEncryptionKeyVersion(),
                credential.getExpiresAt(),
                credential.getCreatedAt(),
                credential.getUpdatedAt());
        return toDomain(repository.saveAndFlush(entity));
    }

    @Override
    public Optional<Credential> findByConnectionId(UUID connectionId) {
        return repository.findByConnectionId(connectionId).map(this::toDomain);
    }

    @Override
    public void deleteByConnectionId(UUID connectionId) {
        repository.deleteByConnectionId(connectionId);
    }

    private Credential toDomain(CredentialJpaEntity entity) {
        return new Credential(
                entity.getId(),
                entity.getConnectionId(),
                entity.getEncryptedPayload(),
                entity.getEncryptionKeyVersion(),
                entity.getExpiresAt(),
                entity.getCreatedAt(),
                entity.getUpdatedAt());
    }
}
