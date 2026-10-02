package com.weav.identity.application.usecase;

import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

public final class RevokeAllSessionsUseCase {

    private final CurrentIdentityGuard identityGuard;
    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public RevokeAllSessionsUseCase(
            CurrentIdentityGuard identityGuard,
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public void execute(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");

        identityGuard.requireActiveUser(userId, sessionId);
        transactionRunner.required(() -> {
            User user = userRepository.findByIdForUpdate(userId)
                    .orElseThrow(() -> new IllegalStateException("Active user disappeared during session revocation"));
            identityGuard.requireActiveSessionForLockedUser(user, userId, sessionId);

            sessionRepository.revokeAllForUser(userId, clock.instant());
            return null;
        });
    }
}
