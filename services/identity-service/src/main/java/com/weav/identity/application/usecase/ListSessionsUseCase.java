package com.weav.identity.application.usecase;

import com.weav.identity.application.dto.SessionPageResult;
import com.weav.identity.application.dto.SessionResult;
import com.weav.identity.application.security.CurrentIdentityGuard;
import com.weav.identity.domain.exception.BadRequestException;
import com.weav.identity.domain.model.UserSession;
import com.weav.identity.domain.model.UserSessionPage;
import com.weav.identity.domain.port.out.UserSessionRepository;

import java.time.Clock;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class ListSessionsUseCase {

    private final CurrentIdentityGuard identityGuard;
    private final UserSessionRepository sessionRepository;
    private final Clock clock;

    public ListSessionsUseCase(
            CurrentIdentityGuard identityGuard,
            UserSessionRepository sessionRepository,
            Clock clock
    ) {
        this.identityGuard = Objects.requireNonNull(identityGuard);
        this.sessionRepository = Objects.requireNonNull(sessionRepository);
        this.clock = Objects.requireNonNull(clock);
    }

    public SessionPageResult execute(UUID userId, UUID sessionId, int page, int size) {
        Objects.requireNonNull(userId, "userId must not be null");
        Objects.requireNonNull(sessionId, "sessionId must not be null");
        if (page < 0) {
            throw new BadRequestException("page must not be negative");
        }
        if (size < 1 || size > 100) {
            throw new BadRequestException("size must be between 1 and 100");
        }

        identityGuard.requireActiveUser(userId, sessionId);
        UserSessionPage result = sessionRepository.findActiveByUserId(userId, clock.instant(), page, size);

        List<SessionResult> items = result.items().stream()
                .map(session -> toResult(session, sessionId))
                .toList();

        return new SessionPageResult(items, result.page(), result.size(), result.totalItems(), result.totalPages());
    }

    private static SessionResult toResult(UserSession session, UUID currentSessionId) {
        return new SessionResult(
                session.getId(),
                session.getCreatedAt(),
                session.getLastUsedAt(),
                session.getExpiresAt(),
                session.getId().equals(currentSessionId),
                session.getUserAgent()
        );
    }
}
