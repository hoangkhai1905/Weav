package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.AuthenticatedUserResult;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

public final class GetCurrentUserUseCase {

    private final CurrentIdentityGuard identityGuard;

    public GetCurrentUserUseCase(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            Clock clock
    ) {
        this(new CurrentIdentityGuard(userRepository, sessionRepository, clock));
    }

    public GetCurrentUserUseCase(CurrentIdentityGuard identityGuard) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
    }

    public AuthenticatedUserResult execute(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        User user = identityGuard.requireActiveUser(userId, sessionId);
        return AuthenticatedUserResult.from(user);
    }
}
