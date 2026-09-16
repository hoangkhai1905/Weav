package com.weav.identity.application.security;

import com.weav.identity.domain.exception.UnauthorizedException;
import com.weav.identity.domain.exception.ForbiddenException;
import com.weav.identity.domain.model.User;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.port.out.UserRepository;
import com.weav.identity.domain.port.out.UserSessionRepository;
import com.weav.identity.domain.valueobject.UserStatus;
import com.weav.identity.domain.valueobject.SystemRole;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public final class CurrentIdentityGuard {

    private static final String AUTHENTICATION_FAILED = "Authentication failed";

    private final UserRepository userRepository;
    private final UserSessionRepository sessionRepository;
    private final Clock clock;

    public CurrentIdentityGuard(
            UserRepository userRepository,
            UserSessionRepository sessionRepository,
            Clock clock
    ) {
        this.userRepository = Objects.requireNonNull(userRepository);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.clock = Objects.requireNonNull(clock);
    }

    public User requireActiveUser(UUID userId, UUID sessionId) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        Instant now = clock.instant();

        UserSession session = sessionRepository.findById(sessionId)
                .filter(value -> value.getUserId().equals(userId))
                .filter(value -> value.isActive(now))
                .orElseThrow(CurrentIdentityGuard::unauthorized);

        return userRepository.findById(session.getUserId())
                .filter(value -> value.getStatus() == UserStatus.ACTIVE)
                .orElseThrow(CurrentIdentityGuard::unauthorized);
    }

    public User requireActiveAdmin(UUID userId, UUID sessionId) {
        User user = requireActiveUser(userId, sessionId);
        if (user.getSystemRole() != SystemRole.ADMIN) {
            throw new ForbiddenException();
        }
        return user;
    }

    /**
     * Rechecks authorization after the caller has acquired the user lock.
     * Mutations lock user before session, so a concurrent revoke cannot commit
     * between this check and the mutation while that lock is held.
     */
    public void requireActiveSessionForLockedUser(User lockedUser, UUID userId, UUID sessionId) {
        Objects.requireNonNull(lockedUser, "lockedUser must not be null");
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        if (!lockedUser.getId().equals(userId) || lockedUser.getStatus() != UserStatus.ACTIVE) {
            throw unauthorized();
        }
        Instant now = clock.instant();
        sessionRepository.findById(sessionId)
                .filter(value -> value.getUserId().equals(userId))
                .filter(value -> value.isActive(now))
                .orElseThrow(CurrentIdentityGuard::unauthorized);
    }

    public void requireActiveAdminForLockedUser(User lockedUser, UUID userId, UUID sessionId) {
        if (lockedUser == null) {
            throw unauthorized();
        }
        requireActiveSessionForLockedUser(lockedUser, userId, sessionId);
        if (lockedUser.getSystemRole() != SystemRole.ADMIN) {
            throw new ForbiddenException();
        }
    }

    private static UnauthorizedException unauthorized() {
        return new UnauthorizedException(AUTHENTICATION_FAILED);
    }
}
