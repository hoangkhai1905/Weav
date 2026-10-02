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
import java.util.Optional;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class RefreshSessionUseCase {

    private static final Logger log = LoggerFactory.getLogger(RefreshSessionUseCase.class);
    private static final Duration DEFAULT_REUSE_GRACE = Duration.ofSeconds(10);
    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final RefreshTokenGenerator refreshTokenGenerator;
    private final AccessTokenIssuer accessTokenIssuer;
    private final TransactionRunner transactionRunner;
    private final Clock clock;
    private final Duration reuseGrace;

    public RefreshSessionUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            Clock clock
    ) {
        this(userRepository, sessionRepository, refreshTokenGenerator, accessTokenIssuer,
                transactionRunner, clock, DEFAULT_REUSE_GRACE);
    }

    public RefreshSessionUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            Clock clock,
            Duration reuseGrace
    ) {
        this.reuseGrace = Objects.requireNonNull(reuseGrace);
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
        UserSession candidate = sessionRepository.findByRefreshTokenHash(submittedHash)
                .or(() -> sessionRepository.findByPreviousRefreshTokenHash(submittedHash))
                .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));

        TokenPairResult result = transactionRunner.required(() -> {
            User user = userRepository.findByIdForUpdate(candidate.getUserId())
                    .filter(value -> value.getStatus() == UserStatus.ACTIVE)
                    .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
            Optional<UserSession> current = sessionRepository.findByRefreshTokenHashForUpdate(submittedHash);
            boolean viaPrevious = current.isEmpty();
            UserSession session = current
                    .or(() -> sessionRepository.findByPreviousRefreshTokenHashForUpdate(submittedHash))
                    .filter(value -> value.getUserId().equals(user.getId()))
                    .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
            Instant now = clock.instant();
            if (!session.isActive(now)) {
                throw new UnauthorizedException(AUTHENTICATION_FAILED);
            }
            if (viaPrevious && !withinGrace(session, now)) {
                // Reuse of an already-rotated token outside the retry window: assume theft and kill the session.
                // The revoke must commit, so signal failure by returning null and throw after the transaction.
                session.revoke(now);
                sessionRepository.save(session);
                log.warn("Refresh token reuse detected; session {} revoked", session.getId());
                return null;
            }

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
        if (result == null) {
            throw new UnauthorizedException(AUTHENTICATION_FAILED);
        }
        return result;
    }

    // A retry of the request that already rotated the token (lost response) is accepted for a short window.
    private boolean withinGrace(UserSession session, Instant now) {
        Instant rotatedAt = session.getRotatedAt();
        return rotatedAt != null && rotatedAt.plus(reuseGrace).isAfter(now);
    }
}
