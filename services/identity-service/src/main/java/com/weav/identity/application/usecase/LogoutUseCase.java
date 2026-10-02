package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;

public final class LogoutUseCase {

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final RefreshTokenGenerator refreshTokenGenerator;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public LogoutUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.refreshTokenGenerator = Objects.requireNonNull(refreshTokenGenerator);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public void execute(RefreshTokenCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String submittedHash = refreshTokenGenerator.hash(command.refreshToken());
        UserSession candidate = sessionRepository.findByRefreshTokenHash(submittedHash).orElse(null);
        if (candidate == null) {
            return;
        }
        Instant now = clock.instant();
        transactionRunner.required(() -> {
            if (userRepository.findByIdForUpdate(candidate.getUserId()).isEmpty()) {
                return null;
            }
            sessionRepository.findByRefreshTokenHashForUpdate(submittedHash).ifPresent(session -> {
                if (!session.getUserId().equals(candidate.getUserId())) {
                    return;
                }
                session.revoke(now);
                sessionRepository.save(session);
            });
            return null;
        });
    }
}
