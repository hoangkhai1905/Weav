package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.ChangePasswordCommand;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.application.validation.AuthInputPolicy;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public final class ChangePasswordUseCase {

    private static final String DUMMY_BCRYPT_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final PasswordHasher passwordHasher;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy inputPolicy;
    private final Clock clock;

    public ChangePasswordUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            PasswordHasher passwordHasher,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.passwordHasher = Objects.requireNonNull(passwordHasher);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.inputPolicy = Objects.requireNonNull(inputPolicy);
        this.clock = Objects.requireNonNull(clock);
    }

    public void execute(UUID userId, UUID sessionId, ChangePasswordCommand command) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Objects.requireNonNull(command, "command must not be null");
        inputPolicy.validatePassword(command.currentPassword());
        inputPolicy.validatePassword(command.newPassword());

        User candidate = identityGuard.requireActiveUser(userId, sessionId);
        String snapshotHash = snapshotHash(candidate);
        if (!passwordHasher.matches(command.currentPassword(), snapshotHash)
                || candidate.getPasswordHash() == null
                || candidate.getPasswordHash().isBlank()) {
            throw unauthorized();
        }
        String replacementHash = passwordHasher.hash(command.newPassword());

        transactionRunner.required(() -> {
            User lockedUser = userRepository.findByIdForUpdate(userId)
                    .orElseThrow(ChangePasswordUseCase::unauthorized);
            identityGuard.requireActiveSessionForLockedUser(lockedUser, userId, sessionId);
            if (!Objects.equals(lockedUser.getPasswordHash(), snapshotHash)
                    || lockedUser.getPasswordHash() == null
                    || lockedUser.getPasswordHash().isBlank()) {
                throw unauthorized();
            }
            Instant now = clock.instant();
            lockedUser.changePassword(replacementHash, now);
            userRepository.save(lockedUser);
            sessionRepository.revokeAllForUser(userId, now);
            return null;
        });
    }

    private static String snapshotHash(User user) {
        String passwordHash = user.getPasswordHash();
        return passwordHash == null || passwordHash.isBlank() ? DUMMY_BCRYPT_HASH : passwordHash;
    }

    private static UnauthorizedException unauthorized() {
        return new UnauthorizedException(AUTHENTICATION_FAILED);
    }
}
