package com.weav.identity.infrastructure.persistence.repository;

import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.infrastructure.persistence.mapper.UserPersistenceMapper;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepositoryAdapter implements UserRepository {

    private static final String CANONICAL_EMAIL_CONSTRAINT = "uk_users_canonical_email";
    private static final String LEGACY_EMAIL_CONSTRAINT = "users_email_key";

    private final SpringDataUserRepository repository;
    private final UserPersistenceMapper mapper;

    public UserRepositoryAdapter(SpringDataUserRepository repository) {
        this.repository = repository;
        this.mapper = new UserPersistenceMapper();
    }

    @Override
    public User save(User user) {
        try {
            return mapper.toDomain(repository.saveAndFlush(mapper.toEntity(user)));
        } catch (RuntimeException exception) {
            ConstraintViolationException constraintViolation = findConstraintViolation(exception);
            if (constraintViolation != null && isEmailConstraint(constraintViolation.getConstraintName())) {
                throw new ConflictException("A resource conflict occurred");
            }
            throw exception;
        }
    }

    @Override
    public Optional<User> findById(UUID id) {
        return repository.findById(id).map(mapper::toDomain);
    }

    @Override
    public Optional<User> findByEmail(String email) {
        return repository.findByCanonicalEmail(email).map(mapper::toDomain);
    }

    @Override
    public boolean existsByEmail(String email) {
        return repository.existsByCanonicalEmail(email);
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

    private boolean isEmailConstraint(String constraintName) {
        return CANONICAL_EMAIL_CONSTRAINT.equals(constraintName)
                || LEGACY_EMAIL_CONSTRAINT.equals(constraintName);
    }
}
