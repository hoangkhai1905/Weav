package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.UserStatus;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public final class GetCurrentUserUseCase {

    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final Clock clock;

    public GetCurrentUserUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.clock = Objects.requireNonNull(clock);
    }

    public AuthenticatedUserResult execute(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Instant now = clock.instant();

        UserSession session = sessionRepository.findById(sessionId)
                .filter(value -> value.getUserId().equals(userId))
                .filter(value -> value.isActive(now))
                .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));

        User user = userRepository.findById(session.getUserId())
                .filter(value -> value.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(() -> new UnauthorizedException(AUTHENTICATION_FAILED));
        return AuthenticatedUserResult.from(user);
    }
}
