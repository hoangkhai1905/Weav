package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.infrastructure.persistence.mapper.UserSessionPersistenceMapper;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Repository;

@Repository
public class UserSessionRepositoryAdapter implements UserSessionRepository {

    private final SpringDataUserSessionRepository repository;
    private final UserSessionPersistenceMapper mapper;

    public UserSessionRepositoryAdapter(SpringDataUserSessionRepository repository) {
        this.repository = repository;
        this.mapper = new UserSessionPersistenceMapper();
    }

    @Override
    public UserSession save(UserSession session) {
        return mapper.toDomain(repository.saveAndFlush(mapper.toEntity(session)));
    }

    @Override
    public Optional<UserSession> findById(UUID id) {
        return repository.findById(id).map(mapper::toDomain);
    }

    @Override
    public Optional<UserSession> findByRefreshTokenHash(String refreshTokenHash) {
        return repository.findByRefreshTokenHash(refreshTokenHash).map(mapper::toDomain);
    }

    @Override
    public Optional<UserSession> findByRefreshTokenHashForUpdate(String refreshTokenHash) {
        return repository.findByRefreshTokenHashForUpdate(refreshTokenHash).map(mapper::toDomain);
    }
}
