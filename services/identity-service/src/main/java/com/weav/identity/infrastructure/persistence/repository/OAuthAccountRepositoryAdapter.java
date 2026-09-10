package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.model.OAuthAccount;
import com.weav.identity.domain.port.out.OAuthAccountRepository;
import com.weav.identity.domain.valueobject.OAuthProvider;
import com.weav.identity.infrastructure.persistence.mapper.OAuthAccountPersistenceMapper;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.stereotype.Repository;

@Repository
public class OAuthAccountRepositoryAdapter implements OAuthAccountRepository {

    private static final String PROVIDER_USER_CONSTRAINT = "uk_oauth_account_provider_user";
    private static final String USER_PROVIDER_CONSTRAINT = "uk_oauth_account_user_provider";

    private final SpringDataOAuthAccountRepository repository;
    private final OAuthAccountPersistenceMapper mapper;

    public OAuthAccountRepositoryAdapter(SpringDataOAuthAccountRepository repository) {
        this.repository = repository;
        this.mapper = new OAuthAccountPersistenceMapper();
    }

    @Override
    public OAuthAccount save(OAuthAccount account) {
        try {
            return mapper.toDomain(repository.saveAndFlush(mapper.toEntity(account)));
        } catch (RuntimeException exception) {
            ConstraintViolationException constraintViolation = findConstraintViolation(exception);
            if (constraintViolation != null && isOAuthAccountConstraint(constraintViolation.getConstraintName())) {
                throw new ConflictException("A resource conflict occurred");
            }
            throw exception;
        }
    }

    @Override
    public Optional<OAuthAccount> findById(UUID id) {
        return repository.findById(id).map(mapper::toDomain);
    }

    @Override
    public Optional<OAuthAccount> findByProviderAndProviderUserId(
            OAuthProvider provider,
            String providerUserId) {
        return repository.findByProviderAndProviderUserId(provider, providerUserId).map(mapper::toDomain);
    }

    @Override
    public Optional<OAuthAccount> findByIdAndUserId(UUID id, UUID userId) {
        return repository.findByIdAndUserId(id, userId).map(mapper::toDomain);
    }

    @Override
    public List<OAuthAccount> findAllByUserId(UUID userId) {
        return repository.findByUserIdOrderByCreatedAtAscIdAsc(userId).stream()
                .map(mapper::toDomain)
                .toList();
    }

    @Override
    public boolean deleteByIdAndUserId(UUID id, UUID userId) {
        return repository.deleteByIdAndUserId(id, userId) == 1;
    }

    private ConstraintViolationException findConstraintViolation(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof ConstraintViolationException constraintViolation) {
                return constraintViolation;
            }
            current = current.getCause();
        }
        return null;
    }

    private boolean isOAuthAccountConstraint(String constraintName) {
        return PROVIDER_USER_CONSTRAINT.equals(constraintName)
                || USER_PROVIDER_CONSTRAINT.equals(constraintName);
    }
}
