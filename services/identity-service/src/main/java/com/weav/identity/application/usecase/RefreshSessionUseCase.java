package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.RefreshTokenCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;

public final class RefreshSessionUseCase {

    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final RefreshTokenGenerator refreshTokenGenerator;
    private final AccessTokenIssuer accessTokenIssuer;
    private final TransactionRunner transactionRunner;
    private final Clock clock;

    public RefreshSessionUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.refreshTokenGenerator = Objects.requireNonNull(refreshTokenGenerator);
        this.accessTokenIssuer = Objects.requireNonNull(accessTokenIssuer);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.clock = Objects.requireNonNull(clock);
    }

    public TokenPairResult execute(RefreshTokenCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String submittedHash = refreshTokenGenerator.hash(command.refreshToken());
        Instant now = clock.instant();

        return transactionRunner.required(() -> {
            UserSession session = sessionRepository.findByRefreshTokenHashForUpdate(submittedHash)
                    .filter(value -> value.isActive(now))
                    .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
            User user = userRepository.findById(session.getUserId())
                    .filter(value -> value.getStatus() == UserStatus.ACTIVE)
                    .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));

            GeneratedRefreshToken replacement = refreshTokenGenerator.generate();
            session.rotateRefreshToken(replacement.hash(), now);
            UserSession saved = sessionRepository.save(session);
            IssuedAccessToken accessToken = accessTokenIssuer.issue(
                    user.getId(),
                    saved.getId(),
                    user.getSystemRole(),
                    user.getStatus()
            );
            return new TokenPairResult(
                    accessToken.value(),
                    replacement.value(),
                    "Bearer",
                    Duration.between(now, accessToken.expiresAt()).toSeconds(),
                    saved.getExpiresAt(),
                    AuthenticatedUserResult.from(user)
            );
        });
    }
}
