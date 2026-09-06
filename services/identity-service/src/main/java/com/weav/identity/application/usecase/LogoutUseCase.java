package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.domain.port.out.UserSessionRepository;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;

public final class LogoutUseCase {

    private final UserSessionRepository sessionRepository;
    private final RefreshTokenGenerator refreshTokenGenerator;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public LogoutUseCase(
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.refreshTokenGenerator = Objects.requireNonNull(refreshTokenGenerator);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public void execute(RefreshTokenCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String submittedHash = refreshTokenGenerator.hash(command.refreshToken());
        Instant now = clock.instant();
        transactionRunner.required(() -> {
            sessionRepository.findByRefreshTokenHashForUpdate(submittedHash).ifPresent(session -> {
                session.revoke(now);
                sessionRepository.save(session);
            });
            return null;
        });
    }
}
