package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.dto.GeneratedRefreshToken;
import com.weav.identity.application.dto.IssuedAccessToken;
import com.weav.identity.application.dto.LoginCommand;
import com.weav.identity.application.dto.TokenPairResult;
import com.weav.identity.application.port.out.AccessTokenIssuer;
import com.weav.identity.application.port.out.PasswordHasher;
import com.weav.identity.application.port.out.RefreshTokenGenerator;
import com.weav.identity.application.port.out.TransactionRunner;
import com.weav.identity.application.validation.AuthInputPolicy;
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
import java.util.UUID;

public final class LoginUseCase {

    private static final String DUMMY_BCRYPT_HASH =
            "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final PasswordHasher passwordHasher;
    private final RefreshTokenGenerator refreshTokenGenerator;
    private final AccessTokenIssuer accessTokenIssuer;
    private final TransactionRunner transactionRunner;
    private final AuthInputPolicy inputPolicy;
    private final Clock clock;
    private final Duration sessionLifetime;

    public LoginUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            PasswordHasher passwordHasher,
            RefreshTokenGenerator refreshTokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            TransactionRunner transactionRunner,
            AuthInputPolicy inputPolicy,
            Clock clock,
            Duration sessionLifetime
    ) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.passwordHasher = Objects.requireNonNull(passwordHasher);
        this.refreshTokenGenerator = Objects.requireNonNull(refreshTokenGenerator);
        this.accessTokenIssuer = Objects.requireNonNull(accessTokenIssuer);
        this.transactionRunner = Objects.requireNonNull(transactionRunner);
        this.inputPolicy = Objects.requireNonNull(inputPolicy);
        this.clock = Objects.requireNonNull(clock);
        this.sessionLifetime = Objects.requireNonNull(sessionLifetime);
        if (sessionLifetime.isZero() || sessionLifetime.isNegative()) {
            throw new IllegalArgumentException("sessionLifetime must be positive");
        }
    }

    public TokenPairResult execute(LoginCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        String email = inputPolicy.canonicalizeEmail(command.email());
        inputPolicy.validatePassword(command.password());

        Optional<User> candidate = userRepository.findByEmail(email);
        String storedHash = candidate.map(User::getPasswordHash)
                .filter(hash -> !hash.isBlank())
                .orElse(DUMMY_BCRYPT_HASH);
        boolean passwordMatches = passwordHasher.matches(command.password(), storedHash);

        User user = candidate.orElse(null);
        if (!passwordMatches
                || user == null
                || user.getPasswordHash() == null
                || user.getPasswordHash().isBlank()
                || user.getStatus() != UserStatus.ACTIVE) {
            throw new UnauthorizedException(AUTHENTICATION_FAILED);
        }

        GeneratedRefreshToken refreshToken = refreshTokenGenerator.generate();
        Instant now = clock.instant();
        Instant refreshExpiresAt = now.plus(sessionLifetime);
        UserSession session = new UserSession(
                UUID.randomUUID(),
                user.getId(),
                refreshToken.hash(),
                null,
                null,
                refreshExpiresAt,
                now
        );

        return transactionRunner.required(() -> {
            UserSession savedSession = sessionRepository.save(session);
            IssuedAccessToken accessToken = accessTokenIssuer.issue(
                    user.getId(),
                    savedSession.getId(),
                    user.getSystemRole(),
                    user.getStatus()
            );
            return new TokenPairResult(
                    accessToken.value(),
                    refreshToken.value(),
                    "Bearer",
                    Duration.between(now, accessToken.expiresAt()).toSeconds(),
                    savedSession.getExpiresAt(),
                    AuthenticatedUserResult.from(user)
            );
        });
    }
}
