package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.RegisterUserCommand;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.ConflictException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.valueobject.SystemRole;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public final class RegisterUserUseCase {

    private final UserRepository userRepository;
    private final PasswordHasher passwordHasher;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy inputPolicy;
    private final Clock clock;

    public RegisterUserUseCase(
            UserRepository userRepository,
            PasswordHasher passwordHasher,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.passwordHasher = Objects.requireNonNull(passwordHasher);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.inputPolicy = Objects.requireNonNull(inputPolicy);
        this.clock = Objects.requireNonNull(clock);
    }

    public AuthenticatedUserResult execute(RegisterUserCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String email = inputPolicy.canonicalizeEmail(command.email());
        inputPolicy.validatePassword(command.password());

        if (userRepository.existsByEmail(email)) {
            throw new ConflictException("Resource state conflicts with existing data");
        }

        String passwordHash = passwordHasher.hash(command.password());
        Instant now = clock.instant();
        User user = new User(
                UUID.randomUUID(),
                email,
                passwordHash,
                command.displayName(),
                null,
                SystemRole.USER,
                UserStatus.ACTIVE,
                now,
                now
        );
        User saved = transactionRunner.required(() -> userRepository.save(user));
        return AuthenticatedUserResult.from(saved);
    }
}
