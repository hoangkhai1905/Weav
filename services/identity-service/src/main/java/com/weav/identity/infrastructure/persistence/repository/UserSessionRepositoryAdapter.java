package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.model.UserSessionPage;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.infrastructure.persistence.entity.UserSessionJpaEntity;
import com.weav.identity.infrastructure.persistence.mapper.UserSessionPersistenceMapper;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
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
    public Optional<UserSession> findByIdForUpdate(UUID id) {
        return repository.findByIdForUpdate(id).map(mapper::toDomain);
    }

    @Override
    public Optional<UserSession> findByRefreshTokenHash(String refreshTokenHash) {
        return repository.findByRefreshTokenHash(refreshTokenHash).map(mapper::toDomain);
    }

    @Override
    public Optional<UserSession> findByRefreshTokenHashForUpdate(String refreshTokenHash) {
        return repository.findByRefreshTokenHashForUpdate(refreshTokenHash).map(mapper::toDomain);
    }

    @Override
    public UserSessionPage findActiveByUserId(UUID userId, Instant now, int page, int size) {
        Page<UserSessionJpaEntity> result = repository.findByUserIdAndRevokedAtIsNullAndExpiresAtAfter(
                userId,
                now,
                PageRequest.of(page, size, Sort.by(
                        Sort.Order.desc("createdAt"),
                        Sort.Order.asc("id"))));
        return new UserSessionPage(
                result.getContent().stream().map(mapper::toDomain).toList(),
                result.getNumber(),
                result.getSize(),
                result.getTotalElements(),
                result.getTotalPages());
    }

    @Override
    public int revokeAllForUser(UUID userId, Instant revokedAt) {
        return repository.revokeAllByUserId(userId, revokedAt);
    }
}
